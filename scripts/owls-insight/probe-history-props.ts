/**
 * Strictly capped /history/props feasibility probe.
 * Never paginates. Never calls /history/player-props.
 *
 *   npx tsx scripts/owls-insight/probe-history-props.ts --select-only
 *   npx tsx scripts/owls-insight/probe-history-props.ts --execute --yes
 */
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { FileCheckpointStore, type CheckpointState } from '@/lib/providers/owls-insight/checkpoint';
import {
  buildOwlsArchiveKey,
  buildOwlsEnvelope,
  entityForEndpoint,
  gzipJson,
  writeOwlsArchiveObject,
} from '@/lib/providers/owls-insight/archive';
import { OwlsInsightClient, extractRows, readOwlsApiKey } from '@/lib/providers/owls-insight/client';
import { parseOwlsCliArgs, requireExecutePreconditions } from '@/lib/providers/owls-insight/cli';
import {
  OWLS_PATHS,
  OWLS_SNAPSHOT_ARCHIVE_SCHEMA,
  OWLS_SNAPSHOT_PROBE_CAPS,
} from '@/lib/providers/owls-insight/contract';
import { asRecord } from '@/lib/providers/owls-insight/normalize';
import { OwlsS3Store } from '@/lib/providers/owls-insight/s3-store';
import { SnapshotProbeBudget, snapshotArchiveSlug } from '@/lib/providers/owls-insight/snapshot-probe';
import { classifyGamePhase } from '@/lib/providers/owls-insight/universe';
import { gunzipSync } from 'node:zlib';
import type { OwlsArchiveEnvelope, OwlsPage, OwlsRequest } from '@/lib/providers/owls-insight/types';

const RUN_ID = 'owls-2026-09-14-props-probe';
const BOOKS = ['draftkings', 'betmgm', 'caesars', 'espnbet'] as const;
const CORE_PROPS = ['points', 'rebounds', 'assists', 'threes'] as const;
const POSITIVE_CONTROL_ID = '1037995';
const PREFERRED_EMPTY: Record<string, string> = {
  '2023': '1038155',
  '2024': '15907966',
  '2025': '18447233',
};
type Candidate = {
  cc: string;
  season: string;
  date: string;
  eventId: string | null;
  phase: 'regular' | 'play_in' | 'playoff';
  playerPropsState: string;
  gamesKey: string | null;
  propsSnapshots: number | null;
};

function readSnapshots(game: Record<string, unknown> | null): number | null {
  if (!game) return null;
  const v = game.propsSnapshots ?? game.propSnapshots ?? game.props_snapshots;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

async function loadSeason(season: string, runId: string): Promise<{ state: CheckpointState; candidates: Candidate[] }> {
  const store = new FileCheckpointStore('data/owls-insight/runs');
  const state = await store.load(runId);
  if (!state) throw new Error(`missing checkpoint ${runId}`);
  const gamesKeyByCc = new Map<string, string>();
  for (const unit of Object.values(state.units)) {
    if (unit.endpoint === 'history_games' && unit.court_context_game_id && unit.archive_key) {
      gamesKeyByCc.set(unit.court_context_game_id, unit.archive_key);
    }
  }
  const candidates: Candidate[] = [];
  for (const [cc, acq] of Object.entries(state.game_acquisition ?? {})) {
    if (OWLS_SNAPSHOT_PROBE_CAPS.bannedGameIds.includes(cc)) continue;
    const date = acq.event_id?.slice(-8);
    const gameDate =
      Object.values(state.units).find((u) => u.court_context_game_id === cc)?.game_date ??
      (date && date.length === 8 ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : null);
    if (!gameDate) continue;
    const phase = classifyGamePhase(season, `${gameDate}T17:00:00.000Z`);
    candidates.push({
      cc,
      season,
      date: gameDate,
      eventId: acq.event_id,
      phase,
      playerPropsState: acq.state,
      gamesKey: gamesKeyByCc.get(cc) ?? null,
      propsSnapshots: null,
    });
  }
  return { state, candidates };
}

async function attachSnapshotCounts(s3: OwlsS3Store, list: Candidate[]): Promise<void> {
  const cache = new Map<string, OwlsArchiveEnvelope>();
  for (const c of list) {
    if (!c.gamesKey || !c.eventId) continue;
    let env = cache.get(c.gamesKey);
    if (!env) {
      const obj = await s3.get(c.gamesKey);
      if (!obj) continue;
      env = JSON.parse(gunzipSync(obj.body).toString('utf8')) as OwlsArchiveEnvelope;
      cache.set(c.gamesKey, env);
    }
    const rows = extractRows(env.payload).map(asRecord);
    const match = rows.find((r) => r && String(r.eventId) === c.eventId) ?? null;
    c.propsSnapshots = readSnapshots(match);
  }
}

function pickEmpty(list: Candidate[]): Candidate | null {
  const regularEmpty = list.filter(
    (c) =>
      c.phase === 'regular' &&
      c.playerPropsState === 'EMPTY_PROVIDER_HISTORY' &&
      c.eventId &&
      c.propsSnapshots != null &&
      c.propsSnapshots <= OWLS_SNAPSHOT_PROBE_CAPS.maxPropsSnapshotsToProbe
  );
  const preferredId = list[0] ? PREFERRED_EMPTY[list[0].season] : undefined;
  const preferred = preferredId ? regularEmpty.find((c) => c.cc === preferredId) : undefined;
  if (preferred) return preferred;
  regularEmpty.sort((a, b) => (a.propsSnapshots ?? 0) - (b.propsSnapshots ?? 0) || a.date.localeCompare(b.date));
  return regularEmpty[0] ?? null;
}

function sampleForCounts(list: Candidate[]): Candidate[] {
  const empty = list.filter(
    (c) => c.phase === 'regular' && c.playerPropsState === 'EMPTY_PROVIDER_HISTORY' && c.eventId
  );
  const byMonth = new Map<string, Candidate[]>();
  for (const c of empty) {
    const month = c.date.slice(0, 7);
    const slot = byMonth.get(month) ?? [];
    slot.push(c);
    byMonth.set(month, slot);
  }
  const sampled: Candidate[] = [];
  for (const [, monthGames] of [...byMonth.entries()].sort()) {
    sampled.push(...monthGames.slice(0, 3));
  }
  return sampled.slice(0, 24);
}

async function selectGames() {
  const s3 = new OwlsS3Store(process.env.NBA_DATA_BUCKET?.trim() || '');
  const seasons = [
    { season: '2023', runId: 'owls-2026-09-14-season-2023' },
    { season: '2024', runId: 'owls-2026-09-14-season-2024' },
    { season: '2025', runId: 'owls-2026-09-14-season-2025' },
  ];
  const selected: Candidate[] = [];
  const inspect: Record<string, unknown> = {};
  for (const { season, runId } of seasons) {
    const { candidates } = await loadSeason(season, runId);
    const sample = sampleForCounts(candidates);
    const preferred = candidates.find((c) => c.cc === PREFERRED_EMPTY[season]);
    if (preferred && !sample.some((c) => c.cc === preferred.cc)) sample.unshift(preferred);
    await attachSnapshotCounts(s3, sample);
    const picked = pickEmpty(sample);
    inspect[season] = {
      sampled: sample.length,
      withCounts: sample.filter((c) => c.propsSnapshots != null).length,
      minPositive: sample
        .filter((c) => (c.propsSnapshots ?? 0) > 0)
        .sort((a, b) => (a.propsSnapshots ?? 0) - (b.propsSnapshots ?? 0))
        .slice(0, 5)
        .map((c) => ({ cc: c.cc, date: c.date, eventId: c.eventId, propsSnapshots: c.propsSnapshots })),
      picked,
    };
    if (picked) selected.push(picked);
  }
  const { candidates: c2023 } = await loadSeason('2023', 'owls-2026-09-14-season-2023');
  const control = c2023.find((c) => c.cc === POSITIVE_CONTROL_ID);
  if (control) {
    await attachSnapshotCounts(s3, [control]);
    selected.push(control);
  }
  return { selected, inspect };
}

function schemaSketch(body: unknown): Record<string, unknown> {
  const rec = asRecord(body);
  const nested = rec?.data && typeof rec.data === 'object' && !Array.isArray(rec.data) ? asRecord(rec.data) : null;
  const rows = extractRows(body);
  const first = asRecord(rows[0]);
  return {
    topKeys: rec ? Object.keys(rec) : [],
    dataIsArray: Array.isArray(rec?.data),
    nestedKeys: nested ? Object.keys(nested) : [],
    pagination: nested?.pagination ?? rec?.pagination ?? rec?.meta ?? null,
    rowCountExtracted: rows.length,
    firstRowKeys: first ? Object.keys(first) : [],
    firstRow: first,
  };
}

function summarizeRow(row: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    player: row.playerName ?? row.player ?? row.name ?? null,
    propType: row.propType ?? row.prop_type ?? null,
    book: row.book ?? null,
    line: row.line ?? row.points ?? row.value ?? null,
    overPrice: row.overPrice ?? row.over_price ?? null,
    underPrice: row.underPrice ?? row.under_price ?? null,
    americanPrice: row.americanPrice ?? row.price ?? row.odds ?? null,
    side: row.side ?? row.outcome ?? null,
    timestamp: row.snapshotAt ?? row.snapshot_at ?? row.timestamp ?? row.ts ?? row.createdAt ?? null,
    eventId: row.eventId ?? row.event_id ?? null,
    snapshotId: row.snapshotId ?? row.id ?? row.snapshot_id ?? null,
  };
}

async function archiveAndCount(args: {
  client: OwlsInsightClient;
  store: OwlsS3Store;
  budget: SnapshotProbeBudget;
  game: Candidate;
  book: string;
  propType: string;
  opening: boolean;
  limit: number;
}): Promise<{
  stopped: boolean;
  rows: unknown[];
  bytes: number;
  key: string | null;
  body: unknown;
  remainingMonth: string | null;
  paginationTotal: number | null;
  schema: Record<string, unknown>;
}> {
  if (!args.budget.canStartRequest()) {
    return {
      stopped: true,
      rows: [],
      bytes: 0,
      key: null,
      body: null,
      remainingMonth: null,
      paginationTotal: null,
      schema: { stopReason: args.budget.stopReason },
    };
  }
  const request: OwlsRequest = {
    method: 'GET',
    path: OWLS_PATHS.historyProps,
    query: {
      eventId: args.game.eventId!,
      propType: args.propType,
      book: args.book,
      opening: 'true',
      limit: args.limit,
      offset: 0,
    },
  };
  let res: { body: unknown; metadata: { status: number; headers: Record<string, string>; durationMs: number }; url: string };
  try {
    res = await args.client.request(request);
  } catch (err) {
    args.budget.recordPage({ rows: 0, compressedBytes: 0 });
    return {
      stopped: false,
      rows: [],
      bytes: 0,
      key: null,
      body: { error: err instanceof Error ? err.message : String(err) },
      remainingMonth: null,
      paginationTotal: null,
      schema: { error: err instanceof Error ? err.message : String(err) },
    };
  }
  const rows = extractRows(res.body);
  const page: OwlsPage = {
    request,
    url: res.url,
    body: res.body,
    metadata: res.metadata,
    rowCount: rows.length,
    pageIndex: 1,
    offset: 0,
    limit: args.limit,
    exhausted: true,
  };
  const envelope = buildOwlsEnvelope({
    page,
    backfillRunId: RUN_ID,
    requestedAt: new Date().toISOString(),
    providerGameId: args.game.eventId,
    season: args.game.season,
    gameDate: args.game.date,
    fixture: false,
    schema: OWLS_SNAPSHOT_ARCHIVE_SCHEMA,
  });
  const compressed = gzipJson(envelope);
  const key = buildOwlsArchiveKey({
    season: args.game.season,
    entity: entityForEndpoint('history_props'),
    gameDate: args.game.date,
    providerGameId: snapshotArchiveSlug({
      eventId: args.game.eventId!,
      book: args.book,
      propType: args.propType,
      opening: args.opening,
    }),
    pageIndex: 1,
  });
  await writeOwlsArchiveObject({ store: args.store, key, envelope });
  args.budget.recordPage({ rows: rows.length, compressedBytes: compressed.length });
  const nested = asRecord(asRecord(res.body)?.data);
  const pagination = asRecord(nested?.pagination) ?? asRecord(asRecord(res.body)?.pagination);
  const total =
    typeof pagination?.total === 'number'
      ? pagination.total
      : typeof nested?.count === 'number'
        ? nested.count
        : typeof pagination?.count === 'number'
          ? pagination.count
          : null;
  return {
    stopped: false,
    rows,
    bytes: compressed.length,
    key,
    body: res.body,
    remainingMonth: res.metadata.headers['x-ratelimit-remaining-month'] ?? null,
    paginationTotal: total,
    schema: schemaSketch(res.body),
  };
}

function classify(args: {
  propsSnapshots: number | null;
  existenceRows: number;
  triedBooks: string[];
  stopped: boolean;
}): 'SNAPSHOT_DATA_PRESENT' | 'SNAPSHOT_DATA_NOT_FOUND' | 'INCONCLUSIVE' | 'TOO_LARGE_TO_PROBE_SAFELY' {
  if ((args.propsSnapshots ?? 0) > OWLS_SNAPSHOT_PROBE_CAPS.maxPropsSnapshotsToProbe) return 'TOO_LARGE_TO_PROBE_SAFELY';
  if (args.stopped) return 'INCONCLUSIVE';
  if (args.existenceRows > 0) return 'SNAPSHOT_DATA_PRESENT';
  if (args.triedBooks.length >= BOOKS.length) return 'SNAPSHOT_DATA_NOT_FOUND';
  return 'INCONCLUSIVE';
}

async function probeGame(args: {
  client: OwlsInsightClient;
  store: OwlsS3Store;
  budget: SnapshotProbeBudget;
  game: Candidate;
  expand: boolean;
}) {
  if (!args.budget.canStartGame()) return { game: args.game, classification: 'INCONCLUSIVE' as const, stop: true };
  args.budget.recordGame();
  const existence: unknown[] = [];
  const booksHit: string[] = [];
  const tried: string[] = [];
  let lastSchema: Record<string, unknown> | null = null;
  let remainingMonth: string | null = null;
  let paginationTotal: number | null = null;
  for (const book of BOOKS) {
    const page = await archiveAndCount({
      client: args.client,
      store: args.store,
      budget: args.budget,
      game: args.game,
      book,
      propType: 'points',
      opening: true,
      limit: OWLS_SNAPSHOT_PROBE_CAPS.existenceLimit,
    });
    if (page.stopped) break;
    tried.push(book);
    lastSchema = page.schema;
    remainingMonth = page.remainingMonth ?? remainingMonth;
    paginationTotal = page.paginationTotal;
    if (page.rows.length > 0) {
      booksHit.push(book);
      existence.push({
        book,
        rows: page.rows.length,
        sample: summarizeRow(asRecord(page.rows[0])),
        bytes: page.bytes,
        key: page.key,
        paginationTotal: page.paginationTotal,
      });
      break;
    }
    existence.push({ book, rows: 0, sample: null, bytes: page.bytes, key: page.key, paginationTotal: page.paginationTotal });
  }

  const expandOut: unknown[] = [];
  const skipExpand = (paginationTotal ?? 0) > 50_000;
  if (args.expand && booksHit.length > 0 && !skipExpand) {
    for (const book of booksHit) {
      for (const propType of CORE_PROPS) {
        if (propType === 'points') continue;
        const page = await archiveAndCount({
          client: args.client,
          store: args.store,
          budget: args.budget,
          game: args.game,
          book,
          propType,
          opening: true,
          limit: OWLS_SNAPSHOT_PROBE_CAPS.expandLimit,
        });
        if (page.stopped) break;
        remainingMonth = page.remainingMonth ?? remainingMonth;
        expandOut.push({
          book,
          propType,
          rows: page.rows.length,
          sample: summarizeRow(asRecord(page.rows[0])),
          bytes: page.bytes,
          key: page.key,
          paginationTotal: page.paginationTotal,
        });
      }
    }
  }

  return {
    game: args.game,
    classification: classify({
      propsSnapshots: args.game.propsSnapshots,
      existenceRows: booksHit.length > 0 ? 1 : 0,
      triedBooks: tried,
      stopped: Boolean(args.budget.stopReason),
    }),
    triedBooks: tried,
    booksHit,
    existence,
    expand: expandOut,
    schema: lastSchema,
    remainingMonth,
    paginationTotal,
    stop: false,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const selectOnly = argv.includes('--select-only');
  const execute = argv.includes('--execute');
  const { selected, inspect } = await selectGames();
  console.log(JSON.stringify({ inspect, selected }, null, 2));
  if (selectOnly || !execute) return;
  requireExecutePreconditions(parseOwlsCliArgs(argv));
  const client = new OwlsInsightClient({
    mode: 'execute',
    apiKey: readOwlsApiKey(),
    historyConcurrency: OWLS_SNAPSHOT_PROBE_CAPS.maxConcurrency,
  });
  const store = new OwlsS3Store(process.env.NBA_DATA_BUCKET?.trim() || '');
  const budget = new SnapshotProbeBudget();
  const results = [];
  for (const game of selected.slice(0, OWLS_SNAPSHOT_PROBE_CAPS.maxGames)) {
    const isControl = game.cc === POSITIVE_CONTROL_ID;
    const result = await probeGame({
      client,
      store,
      budget,
      game,
      expand: !isControl,
    });
    results.push(result);
    if (result.stop && budget.stopReason) break;
  }
  const metrics = client.getMetrics();
  const out = {
    runId: RUN_ID,
    caps: OWLS_SNAPSHOT_PROBE_CAPS,
    budget: budget.snapshot(),
    clientMetrics: metrics,
    results,
  };
  await mkdir('tmp/owls-probe', { recursive: true });
  await writeFile('tmp/owls-probe/history-props-probe.json', `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
