/**
 * Read-only pre-trial / trial-step storage checkpoint.
 *
 * Captures live Postgres size, schema/relation breakdown, season serving
 * row-state, reclaimable cold-storage estimates, freeze flags, and optional
 * approximate S3 archive totals. Never writes S3, never DELETE/VACUUM/prune.
 *
 * Usage:
 *   npx tsx scripts/ops/storage-checkpoint.ts --label=pre-trial
 *   npx tsx scripts/ops/storage-checkpoint.ts --label=after-2024 --out=reports/storage/after-2024.json
 *   npx tsx scripts/ops/storage-checkpoint.ts --label=pre-trial --skip-s3
 */

import 'dotenv/config';

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

const BUDGET_BYTES = 500 * 1024 * 1024;
const SOFT_WARN_BYTES = 400 * 1024 * 1024;
const STRONG_WARN_BYTES = 425 * 1024 * 1024;
const HARD_STOP_BYTES = 450 * 1024 * 1024;
const EMPTY_DISK_MEANINGFUL_BYTES = 64 * 1024;
const WP71_LEAN_MB = 17;
const WP71_CONSERVATIVE_MB = 25;
const LIVE_RESERVE_ASSUMPTION_MB = 80;
const HIST_LOW_MB = 17;
const HIST_HIGH_MB = 25;

const HIGHLIGHT_RELATIONS = [
  'raw.player_game_stats',
  'raw.odds_snapshots',
  'raw.player_injuries',
  'analytics.player_game_logs',
  'analytics.game_odds_history',
  'analytics.player_prop_history',
  'research.prop_decision_lines',
  'public.scraped_boxscores',
  'public.player_game_stats',
] as const;

const COMPACT_SERVING = [
  'analytics.games',
  'analytics.player_game_logs',
  'analytics.team_game_stats',
  'analytics.player_season_averages',
  'analytics.team_season_averages',
  'analytics.player_team_stints',
] as const;

const CLASSIFICATION: Record<string, string> = {
  'analytics.games': 'serving',
  'analytics.player_game_logs': 'historical compact',
  'analytics.team_game_stats': 'historical compact',
  'analytics.player_season_averages': 'historical compact',
  'analytics.team_season_averages': 'historical compact',
  'analytics.player_team_stints': 'historical compact',
  'analytics.players': 'fixed/reference',
  'analytics.teams': 'fixed/reference',
  'analytics.game_odds_history': 'serving',
  'analytics.game_odds_current': 'current-only',
  'analytics.player_prop_history': 'serving',
  'analytics.player_props_current': 'current-only',
  'analytics.player_prop_current': 'current-only',
  'analytics.player_injury_status_current': 'current-only',
  'analytics.player_injury_status_history': 'serving',
  'raw.player_game_stats': 'raw/archive candidate',
  'raw.odds_snapshots': 'raw/archive candidate',
  'raw.player_injuries': 'raw/archive candidate',
  'raw.player_prop_snapshots_v2': 'current-only',
  'raw.player_prop_snapshots': 'raw/archive candidate',
  'raw.games': 'raw/archive candidate',
  'raw.players': 'fixed/reference',
  'raw.teams': 'fixed/reference',
  'research.prop_decision_lines': 'serving',
  'public.scraped_boxscores': 'dead/empty leftover',
  'public.player_game_stats': 'dead/empty leftover',
};

type SizeRow = {
  schema: string;
  table_name: string;
  kind: string;
  rows_est: string | number | null;
  live_est: string | number | null;
  dead_est: string | number | null;
  heap_bytes: string | number;
  index_bytes: string | number;
  toast_bytes: string | number;
  total_bytes: string | number;
};

function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function bytesToMb(bytes: number): number {
  return bytes / (1024 * 1024);
}

function roundMb(bytes: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(bytesToMb(bytes) * f) / f;
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function classify(schema: string, table: string, exactRows: number | null, totalBytes: number): string {
  const key = `${schema}.${table}`;
  if (CLASSIFICATION[key]) return CLASSIFICATION[key];
  if ((exactRows === 0 || exactRows == null) && totalBytes >= EMPTY_DISK_MEANINGFUL_BYTES && exactRows === 0) {
    return 'dead/empty leftover';
  }
  if (schema === 'auth' || schema === 'storage' || schema === 'extensions') return 'fixed/reference';
  if (schema === 'raw') return 'raw/archive candidate';
  if (schema === 'paper') return 'serving';
  if (schema === 'analytics') return 'serving';
  return 'fixed/reference';
}

function parseArg(argv: string[], name: string): string | null {
  const prefix = `--${name}=`;
  const hit = argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function seasonKey(raw: unknown): string {
  if (raw == null) return '(null)';
  const s = String(raw).trim();
  const hyphen = s.match(/^(\d{4})-\d{2}$/);
  if (hyphen) return hyphen[1];
  return s;
}

async function listCommonPrefixes(client: S3Client, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        Delimiter: '/',
        ContinuationToken: token,
      })
    );
    for (const p of res.CommonPrefixes ?? []) {
      if (p.Prefix) out.push(p.Prefix);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function sumPrefix(
  client: S3Client,
  bucket: string,
  prefix: string
): Promise<{ bytes: number; objects: number; keysSample: string[] }> {
  let bytes = 0;
  let objects = 0;
  const keysSample: string[] = [];
  let token: string | undefined;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      })
    );
    for (const obj of res.Contents ?? []) {
      bytes += obj.Size ?? 0;
      objects += 1;
      if (obj.Key && keysSample.length < 8) keysSample.push(obj.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return { bytes, objects, keysSample };
}

function entityFamily(key: string): string {
  const lower = key.toLowerCase();
  if (lower.startsWith('research/')) return 'research';
  if (lower.startsWith('curated/')) return 'curated';
  if (lower.startsWith('features/')) return 'features';
  if (lower.includes('prop')) return 'props';
  if (lower.includes('odds')) return 'odds';
  if (lower.includes('injur')) return 'injuries';
  if (
    lower.includes('entity=games') ||
    lower.includes('entity=player_stats') ||
    lower.includes('entity=player_game') ||
    lower.includes('entity=team_game')
  ) {
    return 'games/stats';
  }
  if (lower.includes('lineup')) return 'lineups';
  return 'other';
}

function extractSeason(key: string): string | null {
  const m = key.match(/season=(\d{4})/);
  return m ? m[1] : null;
}

async function scanS3(label: string): Promise<Record<string, unknown>> {
  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) {
    return { status: 'UNKNOWN', reason: 'NBA_DATA_BUCKET not set', approximate: true };
  }
  const client = new S3Client({ region: process.env.AWS_REGION?.trim() || 'us-east-1' });
  const top = await listCommonPrefixes(client, bucket, '');
  const classified: Record<string, { bytes: number; objects: number }> = {};
  const seasonPrefixes = new Set<string>();
  const bdlSeasons = new Set<string>();
  const existingSeasons = new Set<string>();
  let totalBytes = 0;
  let totalObjects = 0;
  let token: string | undefined;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: token,
      })
    );
    for (const obj of res.Contents ?? []) {
      const key = obj.Key ?? '';
      const size = obj.Size ?? 0;
      totalBytes += size;
      totalObjects += 1;
      const family = entityFamily(key);
      classified[family] = classified[family] ?? { bytes: 0, objects: 0 };
      classified[family].bytes += size;
      classified[family].objects += 1;
      const season = extractSeason(key);
      if (season) {
        const src = key.includes('source=balldontlie')
          ? 'balldontlie'
          : key.includes('source=existing_ingestion')
            ? 'existing_ingestion'
            : 'other';
        seasonPrefixes.add(`${src}/season=${season}`);
        if (src === 'balldontlie') bdlSeasons.add(season);
        if (src === 'existing_ingestion') existingSeasons.add(season);
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  const bdl2024 = await sumPrefix(client, bucket, 'raw/source=balldontlie/league=nba/season=2024/');
  const bdl2025 = await sumPrefix(client, bucket, 'raw/source=balldontlie/league=nba/season=2025/');
  const bdl2023 = await sumPrefix(client, bucket, 'raw/source=balldontlie/league=nba/season=2023/');
  const bdl2022 = await sumPrefix(client, bucket, 'raw/source=balldontlie/league=nba/season=2022/');

  return {
    status: 'OK',
    label,
    approximate: true,
    note: 'ListObjectsV2 size sums only. No writes. Bucket name omitted.',
    totalBytes,
    totalPretty: prettyBytes(totalBytes),
    objectCount: totalObjects,
    topLevelPrefixes: top,
    byFamily: Object.fromEntries(
      Object.entries(classified)
        .sort((a, b) => b[1].bytes - a[1].bytes)
        .map(([k, v]) => [k, { ...v, pretty: prettyBytes(v.bytes) }])
    ),
    seasonPrefixesPresent: [...seasonPrefixes].sort(),
    existingIngestionSeasons: [...existingSeasons].sort(),
    balldontlieSeasons: [...bdlSeasons].sort(),
    bdlSeason2024RawAbsent: bdl2024.objects === 0,
    bdlRawSeasonBytes: {
      '2022': { bytes: bdl2022.bytes, objects: bdl2022.objects, pretty: prettyBytes(bdl2022.bytes) },
      '2023': { bytes: bdl2023.bytes, objects: bdl2023.objects, pretty: prettyBytes(bdl2023.bytes) },
      '2024': { bytes: bdl2024.bytes, objects: bdl2024.objects, pretty: prettyBytes(bdl2024.bytes) },
      '2025': { bytes: bdl2025.bytes, objects: bdl2025.objects, pretty: prettyBytes(bdl2025.bytes) },
    },
  };
}

async function exactCount(db: PoolClient, rel: string): Promise<number | null> {
  try {
    const res = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${rel}`);
    return Number(res.rows[0]?.n ?? 0);
  } catch {
    return null;
  }
}

async function seasonCounts(
  db: PoolClient,
  sql: string
): Promise<Array<{ season: string; rows: number }>> {
  try {
    const res = await db.query<{ season: unknown; rows: string | number }>(sql);
    return res.rows.map((r) => ({ season: seasonKey(r.season), rows: num(r.rows) }));
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const label = parseArg(argv, 'label') || 'pre-trial';
  const outPath = parseArg(argv, 'out');
  const skipS3 = argv.includes('--skip-s3');
  const capturedAt = new Date().toISOString();
  const mode = readIngestionMode(process.env);
  const analyticsSeason = getAnalyticsSeason();

  const db = await pool.connect();
  const query = async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
    const res = await db.query<T>(sql, params);
    return res.rows;
  };
  const queryOne = async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
    const rows = await query<T>(sql, params);
    return rows[0] ?? null;
  };

  try {
  await db.query(`SET statement_timeout = '120s'`);

  const dbSize = await queryOne<{ pretty: string; bytes: string; datname: string }>(
    `SELECT current_database() AS datname,
            pg_size_pretty(pg_database_size(current_database())) AS pretty,
            pg_database_size(current_database())::text AS bytes`
  );
  const databaseBytes = num(dbSize?.bytes);
  const databasePretty = dbSize?.pretty ?? prettyBytes(databaseBytes);

  const schemas = await query<{
    schema: string;
    tables: string | number;
    indexes: string | number;
    matviews: string | number;
    heap_bytes: string | number | null;
    index_bytes: string | number | null;
    total_bytes: string | number | null;
  }>(
    `SELECT
       n.nspname AS schema,
       count(*) FILTER (WHERE c.relkind = 'r') AS tables,
       count(*) FILTER (WHERE c.relkind = 'i') AS indexes,
       count(*) FILTER (WHERE c.relkind = 'm') AS matviews,
       coalesce(sum(pg_relation_size(c.oid)) FILTER (WHERE c.relkind = 'r'), 0) AS heap_bytes,
       coalesce(sum(pg_indexes_size(c.oid)) FILTER (WHERE c.relkind = 'r'), 0) AS index_bytes,
       coalesce(sum(pg_total_relation_size(c.oid)) FILTER (WHERE c.relkind IN ('r', 'm')), 0) AS total_bytes
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND n.nspname NOT LIKE 'pg_temp%'
       AND n.nspname NOT LIKE 'pg_toast%'
     GROUP BY n.nspname
     ORDER BY total_bytes DESC NULLS LAST`
  );

  const largest = await query<SizeRow>(
    `SELECT
       n.nspname AS schema,
       c.relname AS table_name,
       c.relkind AS kind,
       c.reltuples::bigint AS rows_est,
       s.n_live_tup AS live_est,
       s.n_dead_tup AS dead_est,
       pg_relation_size(c.oid) AS heap_bytes,
       pg_indexes_size(c.oid) AS index_bytes,
       coalesce(pg_relation_size(c.reltoastrelid), 0) AS toast_bytes,
       pg_total_relation_size(c.oid) AS total_bytes
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND n.nspname NOT LIKE 'pg_toast%'
       AND c.relkind IN ('r', 'm', 'p')
     ORDER BY pg_total_relation_size(c.oid) DESC
     LIMIT 20`
  );

  const emptyDisk = await query<SizeRow>(
    `SELECT
       n.nspname AS schema,
       c.relname AS table_name,
       c.relkind AS kind,
       c.reltuples::bigint AS rows_est,
       s.n_live_tup AS live_est,
       s.n_dead_tup AS dead_est,
       pg_relation_size(c.oid) AS heap_bytes,
       pg_indexes_size(c.oid) AS index_bytes,
       coalesce(pg_relation_size(c.reltoastrelid), 0) AS toast_bytes,
       pg_total_relation_size(c.oid) AS total_bytes
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
     WHERE n.nspname IN ('raw', 'analytics', 'public', 'research', 'paper')
       AND c.relkind = 'r'
       AND coalesce(s.n_live_tup, 0) = 0
       AND pg_total_relation_size(c.oid) >= $1
     ORDER BY pg_total_relation_size(c.oid) DESC`,
    [EMPTY_DISK_MEANINGFUL_BYTES]
  );

  const highlightCounts: Record<string, number | null> = {};
  for (const rel of HIGHLIGHT_RELATIONS) {
    highlightCounts[rel] = await exactCount(db, rel);
  }

  const compactSizes = await query<{ name: string; total_bytes: string | number; heap_bytes: string | number; index_bytes: string | number; toast_bytes: string | number }>(
    `SELECT n.nspname || '.' || c.relname AS name,
            pg_total_relation_size(c.oid) AS total_bytes,
            pg_relation_size(c.oid) AS heap_bytes,
            pg_indexes_size(c.oid) AS index_bytes,
            coalesce(pg_relation_size(c.reltoastrelid), 0) AS toast_bytes
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE (n.nspname || '.' || c.relname) = ANY($1::text[])`,
    [COMPACT_SERVING as unknown as string[]]
  );

  const liveRelated = await query<{ name: string; total_bytes: string | number }>(
    `SELECT n.nspname || '.' || c.relname AS name,
            pg_total_relation_size(c.oid) AS total_bytes
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE (n.nspname || '.' || c.relname) = ANY($1::text[])`,
    [
      [
        'analytics.player_game_logs',
        'analytics.team_game_stats',
        'analytics.player_props_current',
        'analytics.game_odds_current',
        'analytics.game_odds_history',
        'analytics.player_injury_status_current',
        'analytics.player_injury_status_history',
        'raw.player_prop_snapshots_v2',
        'raw.odds_snapshots',
        'raw.player_injuries',
      ],
    ]
  );

  const oddsRetention = await queryOne<{
    total: string;
    older_than_30d: string;
    last_30d: string;
    oldest: string | null;
    newest: string | null;
  }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (
              WHERE (created_at AT TIME ZONE 'America/New_York')::date
                < (now() AT TIME ZONE 'America/New_York')::date - 30
            )::text AS older_than_30d,
            count(*) FILTER (
              WHERE (created_at AT TIME ZONE 'America/New_York')::date
                >= (now() AT TIME ZONE 'America/New_York')::date - 30
            )::text AS last_30d,
            min(created_at)::text AS oldest,
            max(created_at)::text AS newest
     FROM raw.odds_snapshots`
  ).catch(() => null);

  const injuryRetention = await queryOne<{
    total: string;
    older_than_7d: string;
    last_7d: string;
    oldest: string | null;
    newest: string | null;
  }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (
              WHERE (created_at AT TIME ZONE 'America/New_York')::date
                < (now() AT TIME ZONE 'America/New_York')::date - 7
            )::text AS older_than_7d,
            count(*) FILTER (
              WHERE (created_at AT TIME ZONE 'America/New_York')::date
                >= (now() AT TIME ZONE 'America/New_York')::date - 7
            )::text AS last_7d,
            min(created_at)::text AS oldest,
            max(created_at)::text AS newest
     FROM raw.player_injuries`
  ).catch(() => null);

  const rawStatsBySeason = await seasonCounts(db,
    `SELECT g.season::text AS season, count(*)::text AS rows
     FROM raw.player_game_stats s
     LEFT JOIN raw.games g ON g.id = s.game_id
     GROUP BY g.season
     ORDER BY 1`
  );

  const seasonState = {
    games: await seasonCounts(
      db,
      `SELECT season::text AS season, count(*)::text AS rows FROM analytics.games GROUP BY 1 ORDER BY 1`
    ),
    player_game_logs: await seasonCounts(
      db,
      `SELECT season::text AS season, count(*)::text AS rows FROM analytics.player_game_logs GROUP BY 1 ORDER BY 1`
    ),
    team_game_stats: await seasonCounts(
      db,
      `SELECT season::text AS season, count(*)::text AS rows FROM analytics.team_game_stats GROUP BY 1 ORDER BY 1`
    ),
    player_season_averages: await seasonCounts(
      db,
      `SELECT season::text AS season, count(*)::text AS rows FROM analytics.player_season_averages GROUP BY 1 ORDER BY 1`
    ),
    team_season_averages: await seasonCounts(
      db,
      `SELECT season::text AS season, count(*)::text AS rows FROM analytics.team_season_averages GROUP BY 1 ORDER BY 1`
    ),
    player_team_stints: await seasonCounts(
      db,
      `SELECT season::text AS season, count(*)::text AS rows FROM analytics.player_team_stints GROUP BY 1 ORDER BY 1`
    ),
  };

  const highlightedSizes = await query<{ name: string; total_bytes: string | number; heap_bytes: string | number; index_bytes: string | number; toast_bytes: string | number }>(
    `SELECT n.nspname || '.' || c.relname AS name,
            pg_total_relation_size(c.oid) AS total_bytes,
            pg_relation_size(c.oid) AS heap_bytes,
            pg_indexes_size(c.oid) AS index_bytes,
            coalesce(pg_relation_size(c.reltoastrelid), 0) AS toast_bytes
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE (n.nspname || '.' || c.relname) = ANY($1::text[])`,
    [HIGHLIGHT_RELATIONS as unknown as string[]]
  );

  const exactForLargest: Record<string, number | null> = {};
  for (const row of largest) {
    const name = `${row.schema}.${row.table_name}`;
    if (HIGHLIGHT_RELATIONS.includes(name as (typeof HIGHLIGHT_RELATIONS)[number])) {
      exactForLargest[name] = highlightCounts[name] ?? null;
    } else {
      exactForLargest[name] = await exactCount(db, name);
    }
  }
  for (const row of emptyDisk) {
    const name = `${row.schema}.${row.table_name}`;
    if (exactForLargest[name] == null) exactForLargest[name] = await exactCount(db, name);
  }

  const sizeByName = (rows: Array<{ name: string; total_bytes: string | number }>, name: string) =>
    num(rows.find((r) => r.name === name)?.total_bytes);

  const oddsTotalBytes = sizeByName(highlightedSizes, 'raw.odds_snapshots');
  const injuryTotalBytes = sizeByName(highlightedSizes, 'raw.player_injuries');
  const rawStatsBytes = sizeByName(highlightedSizes, 'raw.player_game_stats');
  const scrapedBytes = sizeByName(highlightedSizes, 'public.scraped_boxscores');
  const publicPgsBytes = sizeByName(highlightedSizes, 'public.player_game_stats');

  const oddsTotalRows = num(oddsRetention?.total);
  const oddsOldRows = num(oddsRetention?.older_than_30d);
  const injuryTotalRows = num(injuryRetention?.total);
  const injuryOldRows = num(injuryRetention?.older_than_7d);
  const oddsOldBytesEst = oddsTotalRows > 0 ? Math.round((oddsOldRows / oddsTotalRows) * oddsTotalBytes) : oddsTotalBytes;
  const injuryOldBytesEst = injuryTotalRows > 0 ? Math.round((injuryOldRows / injuryTotalRows) * injuryTotalBytes) : injuryTotalBytes;

  const emptyLeftoverBytes = emptyDisk.reduce((sum, r) => {
    const name = `${r.schema}.${r.table_name}`;
    const rows = exactForLargest[name];
    if (rows === 0) return sum + num(r.total_bytes);
    return sum;
  }, 0);

  const definitelyReclaimableBytes = oddsOldBytesEst + injuryOldBytesEst + emptyLeftoverBytes;
  const potentiallyReclaimableBytes = rawStatsBytes;
  const compactServingBytes = compactSizes.reduce((s, r) => s + num(r.total_bytes), 0);

  const rowsForSeason = (rows: Array<{ season: string; rows: number }>, year: string) =>
    rows.filter((r) => r.season === year || r.season.startsWith(year)).reduce((s, r) => s + r.rows, 0);

  const seasonConfirmation = {
    '2025': {
      games: rowsForSeason(seasonState.games, '2025'),
      player_logs: rowsForSeason(seasonState.player_game_logs, '2025'),
      team_stats: rowsForSeason(seasonState.team_game_stats, '2025'),
      player_season_averages: rowsForSeason(seasonState.player_season_averages, '2025'),
      team_season_averages: rowsForSeason(seasonState.team_season_averages, '2025'),
      stints: rowsForSeason(seasonState.player_team_stints, '2025'),
    },
    '2024': {
      games: rowsForSeason(seasonState.games, '2024'),
      player_logs: rowsForSeason(seasonState.player_game_logs, '2024'),
      team_stats: rowsForSeason(seasonState.team_game_stats, '2024'),
      player_season_averages: rowsForSeason(seasonState.player_season_averages, '2024'),
      team_season_averages: rowsForSeason(seasonState.team_season_averages, '2024'),
      stints: rowsForSeason(seasonState.player_team_stints, '2024'),
    },
    '2023': {
      games: rowsForSeason(seasonState.games, '2023'),
      player_logs: rowsForSeason(seasonState.player_game_logs, '2023'),
      team_stats: rowsForSeason(seasonState.team_game_stats, '2023'),
      player_season_averages: rowsForSeason(seasonState.player_season_averages, '2023'),
      team_season_averages: rowsForSeason(seasonState.team_season_averages, '2023'),
      stints: rowsForSeason(seasonState.player_team_stints, '2023'),
    },
    '2022': {
      games: rowsForSeason(seasonState.games, '2022'),
      player_logs: rowsForSeason(seasonState.player_game_logs, '2022'),
      team_stats: rowsForSeason(seasonState.team_game_stats, '2022'),
      player_season_averages: rowsForSeason(seasonState.player_season_averages, '2022'),
      team_season_averages: rowsForSeason(seasonState.team_season_averages, '2022'),
      stints: rowsForSeason(seasonState.player_team_stints, '2022'),
    },
  };

  const headroomTo = (cap: number) => ({
    bytes: cap - databaseBytes,
    mb: roundMb(cap - databaseBytes),
    percentUsed: databaseBytes / cap * 100,
  });

  const measuredServingMb = roundMb(compactServingBytes);
  const histLowBytes = HIST_LOW_MB * 1024 * 1024;
  const histHighBytes = HIST_HIGH_MB * 1024 * 1024;
  const liveRelatedBytes = liveRelated.reduce((s, r) => s + num(r.total_bytes), 0);
  const logsBytes = sizeByName(liveRelated, 'analytics.player_game_logs');
  const teamStatsBytes = sizeByName(liveRelated, 'analytics.team_game_stats');
  const currentPropsBytes =
    sizeByName(liveRelated, 'raw.player_prop_snapshots_v2') +
    sizeByName(liveRelated, 'analytics.player_props_current');
  const currentOddsBytes =
    sizeByName(liveRelated, 'analytics.game_odds_current') +
    sizeByName(liveRelated, 'analytics.game_odds_history');
  const currentInjuriesBytes =
    sizeByName(liveRelated, 'analytics.player_injury_status_current') +
    sizeByName(liveRelated, 'analytics.player_injury_status_history');
  const suggestedLiveReserveMb = Math.max(
    LIVE_RESERVE_ASSUMPTION_MB,
    Math.ceil(
      bytesToMb(logsBytes + teamStatsBytes) +
        20 +
        bytesToMb(currentPropsBytes) * 0.15 +
        15
    )
  );

  const dbMb = roundMb(databaseBytes);
  const plus2024Low = roundMb(databaseBytes + histLowBytes);
  const plus2024High = roundMb(databaseBytes + histHighBytes);
  const plus2023Low = roundMb(databaseBytes + 2 * histLowBytes);
  const plus2023High = roundMb(databaseBytes + 2 * histHighBytes);
  const plus2022Low = roundMb(databaseBytes + 3 * histLowBytes);
  const plus2022High = roundMb(databaseBytes + 3 * histHighBytes);

  const s3 = skipS3 ? { status: 'SKIPPED', reason: '--skip-s3' } : await scanS3(label);

  const report = {
    capturedAt,
    label,
    readOnly: true,
    analyticsSeason,
    freeze: {
      dataMode: mode.dataMode || '(missing)',
      offseason: mode.offseason,
      cronDryRun: mode.cronDryRun,
      frozen: mode.shouldSkipMutations,
      pruneEnabled: process.env.PRUNE_ENABLED ?? '(unset)',
      note: 'Local/process env only. This script does not change Production freeze.',
    },
    postgres: {
      database: dbSize?.datname ?? null,
      bytes: databaseBytes,
      pretty: databasePretty,
      mb: dbMb,
      budgetMb: 500,
      percentOf500Mb: Math.round((databaseBytes / BUDGET_BYTES) * 10000) / 100,
      headroomTo500Mb: roundMb(BUDGET_BYTES - databaseBytes),
      headroomTo400MbSoft: roundMb(SOFT_WARN_BYTES - databaseBytes),
      thresholds: {
        softWarningMb: 400,
        strongWarningMb: 425,
        hardStopMb: 450,
        remainingToSoftMb: roundMb(SOFT_WARN_BYTES - databaseBytes),
        remainingToStrongMb: roundMb(STRONG_WARN_BYTES - databaseBytes),
        remainingToHardMb: roundMb(HARD_STOP_BYTES - databaseBytes),
        remainingTo500Mb: roundMb(BUDGET_BYTES - databaseBytes),
      },
    },
    schemas: schemas.map((s) => ({
      schema: s.schema,
      tables: num(s.tables),
      indexes: num(s.indexes),
      matviews: num(s.matviews),
      heapBytes: num(s.heap_bytes),
      indexBytes: num(s.index_bytes),
      totalBytes: num(s.total_bytes),
      pretty: prettyBytes(num(s.total_bytes)),
      mb: roundMb(num(s.total_bytes)),
    })),
    topRelations: largest.map((r) => {
      const name = `${r.schema}.${r.table_name}`;
      const rows = exactForLargest[name];
      return {
        relation: name,
        rows: rows ?? (num(r.live_est) || num(r.rows_est)),
        rowsExact: rows,
        heap: prettyBytes(num(r.heap_bytes)),
        indexes: prettyBytes(num(r.index_bytes)),
        toast: prettyBytes(num(r.toast_bytes)),
        total: prettyBytes(num(r.total_bytes)),
        totalBytes: num(r.total_bytes),
        classification: classify(r.schema, r.table_name, rows, num(r.total_bytes)),
        highlighted: HIGHLIGHT_RELATIONS.includes(name as (typeof HIGHLIGHT_RELATIONS)[number]),
      };
    }),
    highlighted: HIGHLIGHT_RELATIONS.map((name) => {
      const size = highlightedSizes.find((r) => r.name === name);
      return {
        relation: name,
        rows: highlightCounts[name],
        heap: size ? prettyBytes(num(size.heap_bytes)) : null,
        indexes: size ? prettyBytes(num(size.index_bytes)) : null,
        toast: size ? prettyBytes(num(size.toast_bytes)) : null,
        total: size ? prettyBytes(num(size.total_bytes)) : null,
        totalBytes: size ? num(size.total_bytes) : 0,
        classification: classify(name.split('.')[0], name.split('.')[1], highlightCounts[name], size ? num(size.total_bytes) : 0),
      };
    }),
    reclaimable: {
      deferredLifecycle: {
        raw_odds_snapshots: {
          totalRows: oddsTotalRows,
          olderThan30dRows: oddsOldRows,
          last30dRows: num(oddsRetention?.last_30d),
          oldest: oddsRetention?.oldest ?? null,
          newest: oddsRetention?.newest ?? null,
          tableBytes: oddsTotalBytes,
          estimatedOldBytes: oddsOldBytesEst,
          estimatedOldPretty: prettyBytes(oddsOldBytesEst),
        },
        raw_player_injuries: {
          totalRows: injuryTotalRows,
          olderThan7dRows: injuryOldRows,
          last7dRows: num(injuryRetention?.last_7d),
          oldest: injuryRetention?.oldest ?? null,
          newest: injuryRetention?.newest ?? null,
          tableBytes: injuryTotalBytes,
          estimatedOldBytes: injuryOldBytesEst,
          estimatedOldPretty: prettyBytes(injuryOldBytesEst),
        },
      },
      deadEmptyLeftovers: emptyDisk.map((r) => {
        const name = `${r.schema}.${r.table_name}`;
        return {
          relation: name,
          rowsExact: exactForLargest[name] ?? null,
          total: prettyBytes(num(r.total_bytes)),
          totalBytes: num(r.total_bytes),
        };
      }),
      historicalRawGameStats: {
        tableBytes: rawStatsBytes,
        pretty: prettyBytes(rawStatsBytes),
        bySeason: rawStatsBySeason,
        note: 'Do not classify current-season raw.player_game_stats as immediately reclaimable; nightly transform still reads it.',
      },
      definitelyReclaimableLaterBytes: definitelyReclaimableBytes,
      definitelyReclaimableLaterPretty: prettyBytes(definitelyReclaimableBytes),
      potentiallyReclaimableAfterDependencyChangeBytes: potentiallyReclaimableBytes,
      potentiallyReclaimableAfterDependencyChangePretty: prettyBytes(potentiallyReclaimableBytes),
      mustRetainForNow: [
        'analytics.* current 2025 serving set',
        'raw.player_game_stats (2025 transform dependency)',
        'raw.player_prop_snapshots_v2 current window',
        'research.prop_decision_lines',
        'auth / storage / reference dimensions',
      ],
    },
    compactServing: {
      relations: compactSizes.map((r) => ({
        name: r.name,
        totalBytes: num(r.total_bytes),
        pretty: prettyBytes(num(r.total_bytes)),
        mb: roundMb(num(r.total_bytes)),
      })),
      totalBytes: compactServingBytes,
      pretty: prettyBytes(compactServingBytes),
      mb: measuredServingMb,
      wp71LeanMb: WP71_LEAN_MB,
      wp71ConservativeMb: WP71_CONSERVATIVE_MB,
      vsWp71: measuredServingMb <= WP71_LEAN_MB ? 'at-or-below-lean' : measuredServingMb <= WP71_CONSERVATIVE_MB ? 'within-conservative' : 'above-conservative',
    },
    seasonRowState: seasonState,
    seasonConfirmation,
    liveReserve: {
      assumptionMb: LIVE_RESERVE_ASSUMPTION_MB,
      suggestedMb: suggestedLiveReserveMb,
      currentRelatedBytes: liveRelatedBytes,
      currentRelatedPretty: prettyBytes(liveRelatedBytes),
      componentsMb: {
        playerGameLogs: roundMb(logsBytes),
        teamGameStats: roundMb(teamStatsBytes),
        currentProps: roundMb(currentPropsBytes),
        currentOdds: roundMb(currentOddsBytes),
        currentInjuries: roundMb(currentInjuriesBytes),
      },
      projections: {
        plus2024: {
          dbLowMb: plus2024Low,
          dbHighMb: plus2024High,
          withLiveLowMb: roundMb(databaseBytes + histLowBytes + suggestedLiveReserveMb * 1024 * 1024),
          withLiveHighMb: roundMb(databaseBytes + histHighBytes + suggestedLiveReserveMb * 1024 * 1024),
        },
        plus2024_2023: {
          dbLowMb: plus2023Low,
          dbHighMb: plus2023High,
          withLiveLowMb: roundMb(databaseBytes + 2 * histLowBytes + suggestedLiveReserveMb * 1024 * 1024),
          withLiveHighMb: roundMb(databaseBytes + 2 * histHighBytes + suggestedLiveReserveMb * 1024 * 1024),
        },
        plus2024_2023_2022: {
          dbLowMb: plus2022Low,
          dbHighMb: plus2022High,
          withLiveLowMb: roundMb(databaseBytes + 3 * histLowBytes + suggestedLiveReserveMb * 1024 * 1024),
          withLiveHighMb: roundMb(databaseBytes + 3 * histHighBytes + suggestedLiveReserveMb * 1024 * 1024),
          recommendation: 'S3 archive only unless first two season deltas stay inside budget and DB remains comfortably below 350 MB',
        },
      },
    },
    hypotheticalCleanup: {
      currentDbMb: dbMb,
      reclaimableLaterMb: roundMb(definitelyReclaimableBytes),
      afterReclaimDbMb: roundMb(databaseBytes - definitelyReclaimableBytes),
      note: 'Row-fraction estimate for odds/injuries; empty leftovers use measured relation size. VACUUM FULL not applied; actual reclaim needs prune + vacuum.',
    },
    s3,
    checkpointCommands: {
      preTrial: 'npx tsx scripts/ops/storage-checkpoint.ts --label=pre-trial --out=reports/storage/pre-trial.json',
      after2025Repair: 'npx tsx scripts/ops/storage-checkpoint.ts --label=after-2025-repair --out=reports/storage/after-2025-repair.json',
      after2024: 'npx tsx scripts/ops/storage-checkpoint.ts --label=after-2024 --out=reports/storage/after-2024.json',
      after2023: 'npx tsx scripts/ops/storage-checkpoint.ts --label=after-2023 --out=reports/storage/after-2023.json',
      endOfTrial: 'npx tsx scripts/ops/storage-checkpoint.ts --label=end-of-trial --out=reports/storage/end-of-trial.json',
      companionHealth: 'npx tsx scripts/ops/platform-health-snapshot.ts --s3-bytes',
      companionHealthNpm: 'npm run ops:health-snapshot',
    },
    unused: { headroomTo500: headroomTo(BUDGET_BYTES) },
  };

  const json = JSON.stringify(report, null, 2);
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, json + '\n', 'utf8');
  }
  console.log(json);
  } finally {
    db.release();
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
