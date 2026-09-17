/**
 * READ-ONLY Owls Insight S3 inventory. No Owls API calls. No writes.
 *
 *   npx tsx tmp/owl-final-trial-inventory.ts
 */
import 'dotenv/config';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type _Object,
} from '@aws-sdk/client-s3';
import { extractRows } from '../lib/providers/owls-insight/client';
import { asRecord, pickString } from '../lib/providers/owls-insight/normalize';

const BUCKET = process.env.NBA_DATA_BUCKET?.trim() || 'nba-analytics-data-260029269390';
const PREFIXES = [
  'raw/source=owls_insight/',
  'raw/source=owls_insight_fixture/',
];
const BDL_PLAYS_PREFIX = 'raw/source=balldontlie/league=nba/season=2025/entity=plays/';

type Envelope = {
  schema?: string;
  provider?: string;
  backfill_run_id?: string;
  requested_at?: string;
  archived_at?: string;
  fetched_at?: string;
  request?: { method?: string; path?: string; query?: Record<string, unknown> };
  response_metadata?: { status?: number; headers?: Record<string, string> };
  row_count?: number;
  checksum?: string;
  page_index?: number;
  offset?: number;
  limit?: number;
  provider_game_id?: string | null;
  court_context_game_id?: string | null;
  season?: string | null;
  game_date?: string | null;
  fixture?: boolean;
  payload?: unknown;
};

function entityFromKey(key: string): string {
  const m = key.match(/\/entity=([^/]+)\//);
  return m?.[1] ?? 'unknown';
}
function seasonFromKey(key: string): string {
  const m = key.match(/\/season=([^/]+)\//);
  return m?.[1] ?? 'unknown';
}

async function listAll(client: S3Client, prefix: string): Promise<_Object[]> {
  const out: _Object[] = [];
  let token: string | undefined;
  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token })
    );
    out.push(...(res.Contents ?? []));
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function getJsonGz(client: S3Client, key: string): Promise<Envelope | { error: string; key: string }> {
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    if (!res.Body) return { error: 'empty_body', key };
    const buf = Buffer.from(await res.Body.transformToByteArray());
    return JSON.parse(gunzipSync(buf).toString('utf8')) as Envelope;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), key };
  }
}

function collectKeys(value: unknown, prefix = '', into: Set<string> = new Set(), depth = 0): Set<string> {
  if (depth > 4 || value == null) return into;
  if (Array.isArray(value)) {
    if (value[0]) collectKeys(value[0], `${prefix}[]`, into, depth + 1);
    return into;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      into.add(path);
      collectKeys(v, path, into, depth + 1);
    }
  }
  return into;
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function main() {
  const client = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
  const listed: Record<string, _Object[]> = {};
  for (const prefix of PREFIXES) {
    listed[prefix] = await listAll(client, prefix);
  }
  const bdlPlays = await listAll(client, BDL_PLAYS_PREFIX);

  const owls = listed['raw/source=owls_insight/'] ?? [];
  const fixture = listed['raw/source=owls_insight_fixture/'] ?? [];

  const byEntity: Record<string, Record<string, { objects: number; bytes: number; keys: string[] }>> = {};
  for (const obj of owls) {
    const key = obj.Key;
    if (!key) continue;
    const season = seasonFromKey(key);
    const entity = entityFromKey(key);
    byEntity[entity] ??= {};
    byEntity[entity][season] ??= { objects: 0, bytes: 0, keys: [] };
    byEntity[entity][season].objects += 1;
    byEntity[entity][season].bytes += obj.Size ?? 0;
    if (byEntity[entity][season].keys.length < 8) byEntity[entity][season].keys.push(key);
  }

  const sampleKeys: string[] = [];
  for (const entity of Object.keys(byEntity).sort()) {
    for (const season of Object.keys(byEntity[entity]).sort()) {
      const keys = byEntity[entity][season].keys;
      if (keys[0]) sampleKeys.push(keys[0]);
      const last = keys[keys.length - 1];
      if (last && last !== keys[0]) sampleKeys.push(last);
    }
  }

  const samples = await mapPool(sampleKeys, 8, async (key) => {
    const env = await getJsonGz(client, key);
    if ('error' in env) return { key, error: env.error };
    const rows = extractRows(env.payload);
    const first = asRecord(rows[0]);
    return {
      key,
      schema: env.schema,
      provider: env.provider,
      backfill_run_id: env.backfill_run_id,
      requested_at: env.requested_at,
      archived_at: env.archived_at,
      fetched_at: env.fetched_at,
      path: env.request?.path,
      query: env.request?.query,
      httpStatus: env.response_metadata?.status,
      rateLimitRemainingMonth: env.response_metadata?.headers?.['x-ratelimit-remaining-month'] ?? null,
      row_count: env.row_count,
      extracted_rows: rows.length,
      checksum: env.checksum ?? null,
      fixture: env.fixture,
      provider_game_id: env.provider_game_id,
      court_context_game_id: env.court_context_game_id,
      season: env.season,
      game_date: env.game_date,
      envelope_keys: Object.keys(env),
      payload_key_paths: [...collectKeys(env.payload)],
      first_row_keys: first ? Object.keys(first) : [],
      first_row_sample: first
        ? Object.fromEntries(
            Object.entries(first).map(([k, v]) => [
              k,
              v && typeof v === 'object' ? v : v,
            ])
          )
        : null,
    };
  });

  const propKeys = owls
    .filter((o) => o.Key?.includes('/entity=historical_player_props/') && o.Key.endsWith('.json.gz'))
    .map((o) => o.Key!)
    .sort();

  const playerScan = {
    objectsScanned: 0,
    objectsFailed: 0,
    checksumPresent: 0,
    emptyRowObjects: 0,
    populatedObjects: 0,
    rows: 0,
    players: new Set<string>(),
    playerIds: new Set<string>(),
    books: new Map<string, number>(),
    propTypes: new Map<string, number>(),
    timestampsPresent: 0,
    openingPresent: 0,
    closingPresent: 0,
    snapshotAtPresent: 0,
    earliestGameDate: null as string | null,
    latestGameDate: null as string | null,
    earliestRequestedAt: null as string | null,
    latestRequestedAt: null as string | null,
    seasons: new Map<string, { rows: number; games: Set<string>; players: Set<string> }>(),
  };

  const populatedPropKeys = owls
    .filter((o) => {
      const key = o.Key ?? '';
      if (!key.includes('/entity=historical_player_props/') || !key.endsWith('.json.gz')) return false;
      return (o.Size ?? 0) >= 1800;
    })
    .map((o) => o.Key!);

  await mapPool(populatedPropKeys, 12, async (key) => {
    const env = await getJsonGz(client, key);
    playerScan.objectsScanned += 1;
    if ('error' in env) {
      playerScan.objectsFailed += 1;
      return;
    }
    if (env.checksum) playerScan.checksumPresent += 1;
    const rows = extractRows(env.payload).map(asRecord).filter((x): x is Record<string, unknown> => x != null);
    if (rows.length === 0) {
      playerScan.emptyRowObjects += 1;
      return;
    }
    playerScan.populatedObjects += 1;
    playerScan.rows += rows.length;
    const season = String(env.season ?? seasonFromKey(key));
    const seasonSlot = playerScan.seasons.get(season) ?? { rows: 0, games: new Set<string>(), players: new Set<string>() };
    seasonSlot.rows += rows.length;
    if (env.provider_game_id) seasonSlot.games.add(env.provider_game_id);
    if (env.game_date) {
      if (!playerScan.earliestGameDate || env.game_date < playerScan.earliestGameDate) playerScan.earliestGameDate = env.game_date;
      if (!playerScan.latestGameDate || env.game_date > playerScan.latestGameDate) playerScan.latestGameDate = env.game_date;
    }
    if (env.requested_at) {
      if (!playerScan.earliestRequestedAt || env.requested_at < playerScan.earliestRequestedAt) {
        playerScan.earliestRequestedAt = env.requested_at;
      }
      if (!playerScan.latestRequestedAt || env.requested_at > playerScan.latestRequestedAt) {
        playerScan.latestRequestedAt = env.requested_at;
      }
    }
    for (const row of rows) {
      const player = pickString(row, ['player', 'playerName', 'player_name', 'name']);
      const playerId = pickString(row, ['playerId', 'player_id']);
      const book = pickString(row, ['book', 'sportsbook', 'bookmaker']) ?? 'unknown';
      const propType = pickString(row, ['propType', 'prop_type', 'category']) ?? 'unknown';
      if (player) {
        playerScan.players.add(player);
        seasonSlot.players.add(player);
      }
      if (playerId) playerScan.playerIds.add(playerId);
      playerScan.books.set(book, (playerScan.books.get(book) ?? 0) + 1);
      playerScan.propTypes.set(propType, (playerScan.propTypes.get(propType) ?? 0) + 1);
      const ts = pickString(row, ['snapshotAt', 'snapshot_at', 'timestamp', 'capturedAt', 'ts']);
      if (ts) playerScan.snapshotAtPresent += 1;
      if (row.opening != null) playerScan.openingPresent += 1;
      if (row.closing != null) playerScan.closingPresent += 1;
    }
    playerScan.seasons.set(season, seasonSlot);
  });

  const snapshotKeys = owls.filter((o) => o.Key?.includes('/entity=historical_prop_snapshots/')).map((o) => o.Key!);
  const snapshotSamples = await mapPool(snapshotKeys.slice(0, 6), 6, async (key) => {
    const env = await getJsonGz(client, key);
    if ('error' in env) return { key, error: env.error };
    return {
      key,
      schema: env.schema,
      path: env.request?.path,
      query: env.request?.query,
      row_count: env.row_count,
      extracted_rows: extractRows(env.payload).length,
      httpStatus: env.response_metadata?.status,
      payload_key_paths: [...collectKeys(env.payload)],
    };
  });

  const coverageKeys = owls.filter((o) => o.Key?.includes('/entity=historical_coverage/')).map((o) => o.Key!);
  const coverageSamples = await mapPool(coverageKeys, 4, async (key) => {
    const env = await getJsonGz(client, key);
    if ('error' in env) return { key, error: env.error };
    return { key, schema: env.schema, payload: env.payload, requested_at: env.requested_at };
  });

  const closingSampleKeys = (byEntity.historical_closing_odds?.['2023']?.keys ?? [])
    .concat(byEntity.historical_closing_odds?.['2025']?.keys ?? [])
    .slice(0, 2);
  const closingSamples = await mapPool(closingSampleKeys, 2, async (key) => {
    const env = await getJsonGz(client, key);
    if ('error' in env) return { key, error: env.error };
    const rows = extractRows(env.payload).map(asRecord);
    return {
      key,
      schema: env.schema,
      path: env.request?.path,
      extracted_rows: rows.length,
      first_row_keys: rows[0] ? Object.keys(rows[0]) : [],
      first_row: rows[0],
    };
  });

  const publicSampleKeys = Object.values(byEntity.historical_public_betting ?? {})
    .flatMap((s) => s.keys)
    .slice(0, 3);
  const publicSamples = await mapPool(publicSampleKeys, 3, async (key) => {
    const env = await getJsonGz(client, key);
    if ('error' in env) return { key, error: env.error };
    const rows = extractRows(env.payload).map(asRecord);
    return {
      key,
      schema: env.schema,
      path: env.request?.path,
      extracted_rows: rows.length,
      first_row_keys: rows[0] ? Object.keys(rows[0]) : [],
      first_row: rows[0],
    };
  });

  const inventory = {
    generated_at: new Date().toISOString(),
    bucket: BUCKET,
    method: 's3_list_and_sample_getobject_read_only',
    owlsApiCalls: 0,
    totals: {
      owls_insight_objects: owls.length,
      owls_insight_bytes: owls.reduce((s, o) => s + (o.Size ?? 0), 0),
      fixture_objects: fixture.length,
      fixture_bytes: fixture.reduce((s, o) => s + (o.Size ?? 0), 0),
      bdl_plays_2025_objects: bdlPlays.length,
      bdl_plays_2025_bytes: bdlPlays.reduce((s, o) => s + (o.Size ?? 0), 0),
      bdl_plays_game_objects: bdlPlays.filter((o) => /\/game_id=/.test(o.Key ?? '')).length,
    },
    entities: Object.fromEntries(
      Object.entries(byEntity).map(([entity, seasons]) => [
        entity,
        Object.fromEntries(
          Object.entries(seasons).map(([season, v]) => [
            season,
            { objects: v.objects, bytes: v.bytes, sample_keys: v.keys.slice(0, 3) },
          ])
        ),
      ])
    ),
    missing_entities_checked: {
      historical_odds: owls.filter((o) => o.Key?.includes('historical_odds') || o.Key?.includes('/history/odds')).length,
      historical_stats: owls.filter((o) => o.Key?.includes('historical_stats') || o.Key?.includes('entity=stats')).length,
      plays: owls.filter((o) => o.Key?.includes('entity=plays') || o.Key?.includes('play_by_play')).length,
      starters: owls.filter((o) => o.Key?.includes('starter') || o.Key?.includes('lineup')).length,
      season_2022: owls.filter((o) => o.Key?.includes('/season=2022/')).length,
    },
    samples,
    snapshot_probe_objects: snapshotKeys.length,
    snapshot_samples: snapshotSamples,
    coverage_objects: coverageKeys,
    coverage_samples: coverageSamples,
    closing_samples: closingSamples,
    public_betting_samples: publicSamples,
    player_prop_scan: {
      size_threshold_bytes: 1800,
      candidate_objects: populatedPropKeys.length,
      listed_player_prop_objects: propKeys.length,
      objectsScanned: playerScan.objectsScanned,
      objectsFailed: playerScan.objectsFailed,
      checksumPresent: playerScan.checksumPresent,
      emptyRowObjects: playerScan.emptyRowObjects,
      populatedObjects: playerScan.populatedObjects,
      rows: playerScan.rows,
      unique_player_names: playerScan.players.size,
      unique_player_ids: playerScan.playerIds.size,
      books: Object.fromEntries([...playerScan.books.entries()].sort((a, b) => b[1] - a[1])),
      propTypes: Object.fromEntries([...playerScan.propTypes.entries()].sort((a, b) => b[1] - a[1])),
      openingPresent: playerScan.openingPresent,
      closingPresent: playerScan.closingPresent,
      snapshotAtPresent: playerScan.snapshotAtPresent,
      earliestGameDate: playerScan.earliestGameDate,
      latestGameDate: playerScan.latestGameDate,
      earliestRequestedAt: playerScan.earliestRequestedAt,
      latestRequestedAt: playerScan.latestRequestedAt,
      seasons: Object.fromEntries(
        [...playerScan.seasons.entries()].map(([season, v]) => [
          season,
          { rows: v.rows, unique_games: v.games.size, unique_players: v.players.size },
        ])
      ),
    },
  };

  await mkdir('tmp/owls-probe', { recursive: true });
  await writeFile('tmp/owl-final-trial-inventory.json', `${JSON.stringify(inventory, null, 2)}\n`);
  const summary = {
    bucket: BUCKET,
    owlsObjects: owls.length,
    owlsBytes: inventory.totals.owls_insight_bytes,
    entities: inventory.entities,
    missing: inventory.missing_entities_checked,
    playerScan: inventory.player_prop_scan,
    coverageKeys,
    snapshotCount: snapshotKeys.length,
    bdlPlays: inventory.totals,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
