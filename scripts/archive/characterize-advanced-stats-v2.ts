/**
 * Step 5A: characterize BALLDONTLIE Advanced Stats V2 (season 2024, ≤5 pages).
 * Does not crawl a full season. Does not write Advanced Stats to Postgres.
 * Does not start 2022, opening props, opening odds, or lineups.
 *
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/characterize-advanced-stats-v2.ts --dry-run
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/characterize-advanced-stats-v2.ts --execute
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import { ADVANCED_STATS_V2_PATH, planAdvancedStatsV2Archive } from '@/lib/archive/advanced-stats-v2';
import { parseExecuteFlag } from '@/lib/archive/trial-archive-plan';
import { acquireBdlAcquisitionLock, bdlAcquisitionLockStatus } from '@/lib/balldontlie/acquisition-lock';
import {
  BDL_NBA_BASE_URL,
  BdlArchiveClient,
  readBdlApiKey,
  type BdlEnvelope,
} from '@/lib/balldontlie/archive-client';
import {
  assertTrialExecuteAllowed,
  BDL_TRIAL_MIN_DELAY_MS,
  resolveBdlRequestDelayMs,
} from '@/lib/balldontlie/trial-limiter';
import pool from '@/lib/db';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

const SEASON = 2024;
const MAX_PAGES = 5;
const PER_PAGE = 100;
const OUT_JSON = 'reports/trial/advanced-stats-characterization.json';
const OUT_MD = 'reports/trial/advanced-stats-characterization.md';
const TRIAL_START = '2026-09-08T12:10:59.422Z';
const TRIAL_HOURS = 48;
const RESERVE_HOURS = 6;
const PRACTICAL_SPACING_SEC = 13.6;
const THEORETICAL_SPACING_SEC = 13.0;
const DB_MB_AFTER_2023 = 326.96;

const EXPECTED = {
  games2023: 1319,
  logs2023: 46090,
  tgs2023: 2638,
  psa2023: 595,
  tsa2023: 30,
  inferred2023: 695,
  games2024: 1321,
  logs2024: 46150,
  tgs2024: 2642,
  psa2024: 587,
  tsa2024: 30,
  inferred2024: 699,
  games2025: 1323,
  logs2025: 46056,
  tgs2025: 2644,
  games2026: 1200,
  logs2026: 0,
  tgs2026: 0,
  stints2026: 578,
  rawPgs: 46056,
  boxHome: 109,
  boxAway: 118,
};

const KNOWN_SEASON_LOGS: Record<number, number> = { 2023: 46090, 2024: 46150, 2025: 46056 };
const KNOWN_SEASON_GAMES: Record<number, number> = { 2023: 1319, 2024: 1321, 2025: 1322 };

const IDENTITY_KEYS = new Set(['id', 'period', 'player', 'team', 'game', 'min', 'minutes']);
const POSSESSION_KEYS = new Set([
  'possessions',
  'usage_percentage',
  'estimated_usage_percentage',
  'pace',
  'pace_per_40',
  'estimated_pace',
]);
const EFFICIENCY_KEYS = new Set([
  'true_shooting_percentage',
  'effective_field_goal_percentage',
  'offensive_rating',
  'defensive_rating',
  'net_rating',
  'estimated_offensive_rating',
  'estimated_defensive_rating',
  'estimated_net_rating',
  'pie',
]);
const REB_PASS_TOV_KEYS = new Set([
  'assist_percentage',
  'assist_ratio',
  'assist_to_turnover',
  'defensive_rebound_percentage',
  'offensive_rebound_percentage',
  'rebound_percentage',
  'turnover_ratio',
]);

type Snap = {
  dbBytes: number;
  dbMb: number;
  games_2023: number;
  logs_2023: number;
  tgs_2023: number;
  psa_2023: number;
  tsa_2023: number;
  inferred_2023: number;
  games_2024: number;
  logs_2024: number;
  tgs_2024: number;
  psa_2024: number;
  tsa_2024: number;
  inferred_2024: number;
  games_2025: number;
  logs_2025: number;
  tgs_2025: number;
  games_2026: number;
  logs_2026: number;
  tgs_2026: number;
  stints_2026: number;
  raw_pgs: number;
  advancedTable: string | null;
  box184: { home_score: number; away_score: number } | null;
};

type FieldQuality = {
  field: string;
  nonNull: number;
  nullCount: number;
  zeroCount: number;
  min: number | null;
  max: number | null;
  pctPopulated: number;
  uniqueNumericValues: number;
};

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function sid(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number') {
    const s = String(v).trim();
    return s ? s : null;
  }
  return null;
}

function nestedId(v: unknown): string | null {
  const direct = sid(v);
  if (direct) return direct;
  const o = rec(v);
  return o ? sid(o.id) : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function mb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

function avg(xs: number[]): number | null {
  if (!xs.length) return null;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
}

function hoursForRequests(requests: number, spacingSec: number): number {
  return Math.round(((requests * spacingSec) / 3600) * 100) / 100;
}

function categorize(key: string): 'identity' | 'possession_usage' | 'efficiency' | 'rebounding_passing_turnover' | 'tracking_advanced' {
  if (IDENTITY_KEYS.has(key)) return 'identity';
  if (POSSESSION_KEYS.has(key)) return 'possession_usage';
  if (EFFICIENCY_KEYS.has(key)) return 'efficiency';
  if (REB_PASS_TOV_KEYS.has(key)) return 'rebounding_passing_turnover';
  return 'tracking_advanced';
}

function writeStopped(payload: unknown, code: number): never {
  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + '\n');
  console.log(JSON.stringify(payload, null, 2));
  process.exit(code);
}

async function snapshot(client: Awaited<ReturnType<typeof pool.connect>>): Promise<Snap> {
  const r = await client.query(
    `select
       pg_database_size(current_database())::bigint as db_bytes,
       (select count(*)::int from analytics.games where season = '2023') as games_2023,
       (select count(*)::int from analytics.player_game_logs where season = '2023') as logs_2023,
       (select count(*)::int from analytics.team_game_stats where season = '2023') as tgs_2023,
       (select count(*)::int from analytics.player_season_averages where season = '2023') as psa_2023,
       (select count(*)::int from analytics.team_season_averages where season = '2023') as tsa_2023,
       (select count(*)::int from analytics.player_team_stints where season = '2023' and source = 'inferred_pgl') as inferred_2023,
       (select count(*)::int from analytics.games where season = '2024') as games_2024,
       (select count(*)::int from analytics.player_game_logs where season = '2024') as logs_2024,
       (select count(*)::int from analytics.team_game_stats where season = '2024') as tgs_2024,
       (select count(*)::int from analytics.player_season_averages where season = '2024') as psa_2024,
       (select count(*)::int from analytics.team_season_averages where season = '2024') as tsa_2024,
       (select count(*)::int from analytics.player_team_stints where season = '2024' and source = 'inferred_pgl') as inferred_2024,
       (select count(*)::int from analytics.games where season = '2025') as games_2025,
       (select count(*)::int from analytics.player_game_logs where season = '2025') as logs_2025,
       (select count(*)::int from analytics.team_game_stats where season = '2025') as tgs_2025,
       (select count(*)::int from analytics.games where season = '2026') as games_2026,
       (select count(*)::int from analytics.player_game_logs where season = '2026') as logs_2026,
       (select count(*)::int from analytics.team_game_stats where season = '2026') as tgs_2026,
       (select count(*)::int from analytics.player_team_stints where season = '2026') as stints_2026,
       (select count(*)::int from raw.player_game_stats) as raw_pgs,
       to_regclass('analytics.player_advanced_stats')::text as advanced_table`
  );
  const box = await client.query<{ home_score: number; away_score: number }>(
    `select home_score, away_score from analytics.games where game_id = '18447793'`
  );
  const n = (k: string) => Number(r.rows[0]![k]);
  const bytes = n('db_bytes');
  return {
    dbBytes: bytes,
    dbMb: mb(bytes),
    games_2023: n('games_2023'),
    logs_2023: n('logs_2023'),
    tgs_2023: n('tgs_2023'),
    psa_2023: n('psa_2023'),
    tsa_2023: n('tsa_2023'),
    inferred_2023: n('inferred_2023'),
    games_2024: n('games_2024'),
    logs_2024: n('logs_2024'),
    tgs_2024: n('tgs_2024'),
    psa_2024: n('psa_2024'),
    tsa_2024: n('tsa_2024'),
    inferred_2024: n('inferred_2024'),
    games_2025: n('games_2025'),
    logs_2025: n('logs_2025'),
    tgs_2025: n('tgs_2025'),
    games_2026: n('games_2026'),
    logs_2026: n('logs_2026'),
    tgs_2026: n('tgs_2026'),
    stints_2026: n('stints_2026'),
    raw_pgs: n('raw_pgs'),
    advancedTable: r.rows[0]!.advanced_table == null ? null : String(r.rows[0]!.advanced_table),
    box184: box.rows[0] ?? null,
  };
}

function isolationFailures(s: Snap): string[] {
  const f: string[] = [];
  if (s.games_2023 !== EXPECTED.games2023 || s.logs_2023 !== EXPECTED.logs2023 || s.tgs_2023 !== EXPECTED.tgs2023) {
    f.push('2023 serving');
  }
  if (s.psa_2023 !== EXPECTED.psa2023 || s.tsa_2023 !== EXPECTED.tsa2023 || s.inferred_2023 !== EXPECTED.inferred2023) {
    f.push('2023 averages/stints');
  }
  if (s.games_2024 !== EXPECTED.games2024 || s.logs_2024 !== EXPECTED.logs2024 || s.tgs_2024 !== EXPECTED.tgs2024) {
    f.push('2024 serving');
  }
  if (s.psa_2024 !== EXPECTED.psa2024 || s.tsa_2024 !== EXPECTED.tsa2024 || s.inferred_2024 !== EXPECTED.inferred2024) {
    f.push('2024 averages/stints');
  }
  if (s.games_2025 !== EXPECTED.games2025 || s.logs_2025 !== EXPECTED.logs2025 || s.tgs_2025 !== EXPECTED.tgs2025) {
    f.push('2025 serving');
  }
  if (!s.box184 || Number(s.box184.home_score) !== EXPECTED.boxHome || Number(s.box184.away_score) !== EXPECTED.boxAway) {
    f.push('18447793');
  }
  if (s.games_2026 !== EXPECTED.games2026 || s.logs_2026 !== 0 || s.tgs_2026 !== 0 || s.stints_2026 !== EXPECTED.stints2026) {
    f.push('2026');
  }
  if (s.raw_pgs !== EXPECTED.rawPgs) f.push('raw.player_game_stats');
  if (s.advancedTable) f.push(`advanced table exists ${s.advancedTable}`);
  return f;
}

async function main() {
  const argv = process.argv.slice(2);
  const { execute, dryRun } = parseExecuteFlag(argv);
  const generatedAt = new Date().toISOString();
  const plan = planAdvancedStatsV2Archive(['--season=2024', dryRun ? '--dry-run' : '--execute']);
  const mode = readIngestionMode();
  const pin = getAnalyticsSeason();
  const delay = resolveBdlRequestDelayMs();
  const lockIdle = bdlAcquisitionLockStatus();

  const unsafe: string[] = [];
  if (!delay.trialMode) unsafe.push('BDL_TRIAL_MODE is not 1');
  if (delay.delayMs < BDL_TRIAL_MIN_DELAY_MS) unsafe.push(`spacing ${delay.delayMs}ms < 12000`);
  if (delay.concurrency !== 1) unsafe.push(`concurrency=${delay.concurrency}`);
  if (mode.dataMode !== 'replay') unsafe.push(`DATA_MODE=${mode.dataMode || '(empty)'}`);
  if (!mode.offseason) unsafe.push('OFFSEASON_MODE not 1');
  if (!mode.cronDryRun) unsafe.push('CRON_DRY_RUN not 1');
  if (pin !== '2025') unsafe.push(`season pin=${pin}`);
  if (lockIdle.active) unsafe.push(`BDL lock already active pid=${lockIdle.pid}`);
  if (plan.postgresMaterialize !== false) unsafe.push('plan would materialize Postgres');
  if (plan.s3Prefix.includes('entity=games') || plan.s3Prefix.includes('entity=player_stats')) {
    unsafe.push('wrong S3 prefix');
  }

  const pg = await pool.connect();
  let before: Snap;
  try {
    await pg.query('begin read only');
    before = await snapshot(pg);
    await pg.query('commit');
  } finally {
    pg.release();
  }
  if (before.dbMb < 324 || before.dbMb > 330) unsafe.push(`db size ${before.dbMb} MB not ~${DB_MB_AFTER_2023}`);
  unsafe.push(...isolationFailures(before).map((x) => `preflight ${x}`));

  const safety = {
    trialMode: delay.trialMode,
    delayMs: delay.delayMs,
    delaySource: delay.source,
    minDelayMs: BDL_TRIAL_MIN_DELAY_MS,
    concurrency: delay.concurrency,
    lockActiveBefore: lockIdle.active,
    dataMode: mode.dataMode,
    offseasonMode: mode.offseason,
    cronDryRun: mode.cronDryRun,
    frozen: mode.shouldSkipMutations,
    currentAnalyticsSeason: pin,
    stagingMode: 'none',
    endpoint: plan.endpoint,
    s3Prefix: plan.s3Prefix,
    maxPages: MAX_PAGES,
    postgresMaterialize: false,
    dbMb: before.dbMb,
    dbBytes: before.dbBytes,
  };

  if (unsafe.length) {
    writeStopped(
      {
        generatedAt,
        step: '5A',
        stopped: true,
        reason: unsafe,
        safety,
        verdict: 'RED — do not spend trial time on full Advanced Stats archive',
      },
      2
    );
  }

  if (dryRun) {
    const payload = {
      generatedAt,
      step: '5A',
      dryRun: true,
      bdlHttpRequests: 0,
      postgresWrites: false,
      safety,
      plan,
      note: 'Safety GREEN. Rerun with --execute. Max 5 pages. No full-season crawl.',
    };
    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + '\n');
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  assertTrialExecuteAllowed();
  const lock = acquireBdlAcquisitionLock();
  const pages: Array<{
    pageIndex: number;
    recordCount: number;
    nextCursor: string | number | null;
    perPage: number | null;
    totalCount: unknown;
    totalPages: unknown;
    hasMore: boolean;
    bytes: number;
    metaKeys: string[];
  }> = [];
  const records: Record<string, unknown>[] = [];
  const cursors: Array<string | number | null> = [];
  let client: BdlArchiveClient | null = null;

  try {
    console.log('[5A] fetching ≤5 Advanced Stats V2 pages for 2024 (no Postgres writes)');
    const s3 = new S3Storage({ bucket: process.env.NBA_DATA_BUCKET!.trim() });
    client = new BdlArchiveClient({ apiKey: readBdlApiKey(), baseUrl: BDL_NBA_BASE_URL });
    for await (const page of client.paginate({
      path: ADVANCED_STATS_V2_PATH,
      params: { 'seasons[]': String(SEASON), period: 0 },
      paginationStyle: 'cursor',
      perPage: PER_PAGE,
    })) {
      const body = page.body as BdlEnvelope;
      const data = Array.isArray(body.data) ? body.data : [];
      const meta = body.meta ?? {};
      const nextCursor = (meta.next_cursor ?? null) as string | number | null;
      const serialized = JSON.stringify(body, null, 2) + '\n';
      const bytes = Buffer.byteLength(serialized);
      const key = `${plan.s3Prefix}/page=${page.pageIndex}.json`;
      await s3.putJson(key, body, { overwrite: true });
      pages.push({
        pageIndex: page.pageIndex,
        recordCount: data.length,
        nextCursor,
        perPage: typeof meta.per_page === 'number' ? meta.per_page : null,
        totalCount: meta.total_count ?? null,
        totalPages: meta.total_pages ?? null,
        hasMore: page.hasMore,
        bytes,
        metaKeys: Object.keys(meta),
      });
      cursors.push(nextCursor);
      for (const row of data) {
        const o = rec(row);
        if (o) records.push(o);
      }
      if (pages.length >= MAX_PAGES) break;
      if (!page.hasMore) break;
    }

    const sampleManifest = {
      schemaVersion: 1,
      source: 'balldontlie',
      entity: 'advanced_stats_v2',
      status: 'characterization_sample_not_complete',
      season: SEASON,
      endpoint: ADVANCED_STATS_V2_PATH,
      params: { 'seasons[]': String(SEASON), period: 0, per_page: PER_PAGE },
      pageCount: pages.length,
      recordCount: records.length,
      maxPages: MAX_PAGES,
      fetchedAt: generatedAt,
      note: 'Sample only. Do not treat as a complete season archive. Full crawl must write _manifest.json.',
    };
    await s3.putJson(`${plan.s3Prefix}/_characterization_5page_manifest.json`, sampleManifest, {
      overwrite: true,
    });
  } finally {
    lock.release();
  }

  const metrics = client?.getMetrics() ?? {
    httpAttempts: 0,
    httpSuccess: 0,
    status429: 0,
    status5xx: 0,
    retries: 0,
    retryAfterUsed: 0,
    spacingSamplesMs: [] as number[],
  };
  const avgSpacingMs = avg(metrics.spacingSamplesMs);

  const keys = new Set<string>();
  const nestedPlayerKeys = new Set<string>();
  const nestedTeamKeys = new Set<string>();
  const nestedGameKeys = new Set<string>();
  for (const row of records) {
    for (const k of Object.keys(row)) keys.add(k);
    const p = rec(row.player);
    const t = rec(row.team);
    const g = rec(row.game);
    if (p) for (const k of Object.keys(p)) nestedPlayerKeys.add(k);
    if (t) for (const k of Object.keys(t)) nestedTeamKeys.add(k);
    if (g) for (const k of Object.keys(g)) nestedGameKeys.add(k);
  }

  const inventory = {
    identity: [...keys].filter((k) => categorize(k) === 'identity').sort(),
    possession_usage: [...keys].filter((k) => categorize(k) === 'possession_usage').sort(),
    efficiency: [...keys].filter((k) => categorize(k) === 'efficiency').sort(),
    rebounding_passing_turnover: [...keys].filter((k) => categorize(k) === 'rebounding_passing_turnover').sort(),
    tracking_advanced: [...keys].filter((k) => categorize(k) === 'tracking_advanced').sort(),
    nested: {
      player: [...nestedPlayerKeys].sort(),
      team: [...nestedTeamKeys].sort(),
      game: [...nestedGameKeys].sort(),
    },
    allTopLevel: [...keys].sort(),
  };

  const periodValues = new Set<string>();
  const gameIds = new Set<string>();
  const playerIds = new Set<string>();
  const teamIds = new Set<string>();
  const gp = new Map<string, number>();
  const gpp = new Map<string, number>();
  const recordIds = new Set<string>();
  const gamesByPage: string[][] = pages.map(() => []);

  for (let i = 0; i < records.length; i++) {
    const row = records[i]!;
    const period = sid(row.period) ?? 'null';
    periodValues.add(period);
    const gameId = nestedId(row.game);
    const playerId = nestedId(row.player);
    const teamId = nestedId(row.team);
    if (gameId) gameIds.add(gameId);
    if (playerId) playerIds.add(playerId);
    if (teamId) teamIds.add(teamId);
    if (sid(row.id)) recordIds.add(sid(row.id)!);
    if (gameId && playerId) {
      const k = `${gameId}|${playerId}`;
      gp.set(k, (gp.get(k) ?? 0) + 1);
      gpp.set(`${k}|${period}`, (gpp.get(`${k}|${period}`) ?? 0) + 1);
    }
    let running = 0;
    let pageIdx = 0;
    for (const p of pages) {
      running += p.recordCount;
      if (i < running) {
        pageIdx = p.pageIndex - 1;
        break;
      }
    }
    if (gameId) gamesByPage[pageIdx]?.push(gameId);
  }

  const dupGp = [...gp.values()].filter((n) => n > 1).length;
  const naturalKey =
    gp.size === records.length && dupGp === 0
      ? '(game_id, player_id)'
      : gpp.size === records.length
        ? '(game_id, player_id, period)'
        : recordIds.size === records.length
          ? 'id'
          : 'undetermined';

  const numericFields = [...keys].filter((k) => {
    if (k === 'player' || k === 'team' || k === 'game') return false;
    return records.some((row) => asNumber(row[k]) != null);
  });

  const quality: FieldQuality[] = numericFields.sort().map((field) => {
    let nonNull = 0;
    let nullCount = 0;
    let zeroCount = 0;
    let min: number | null = null;
    let max: number | null = null;
    const uniq = new Set<number>();
    for (const row of records) {
      if (!(field in row) || row[field] == null) {
        nullCount += 1;
        continue;
      }
      const n = asNumber(row[field]);
      if (n == null) {
        nullCount += 1;
        continue;
      }
      nonNull += 1;
      uniq.add(n);
      if (n === 0) zeroCount += 1;
      min = min == null ? n : Math.min(min, n);
      max = max == null ? n : Math.max(max, n);
    }
    return {
      field,
      nonNull,
      nullCount,
      zeroCount,
      min,
      max,
      pctPopulated: records.length ? Math.round((nonNull / records.length) * 1000) / 10 : 0,
      uniqueNumericValues: uniq.size,
    };
  });

  const universallyPopulated = quality.filter((q) => q.pctPopulated >= 99).map((q) => q.field);
  const sparse = quality.filter((q) => q.pctPopulated > 0 && q.pctPopulated < 50).map((q) => q.field);
  const unusable = quality.filter((q) => q.pctPopulated === 0).map((q) => q.field);
  const suspiciousConstants = quality
    .filter((q) => q.uniqueNumericValues === 1 && q.nonNull === records.length && q.field !== 'period')
    .map((q) => ({ field: q.field, value: q.min }));
  const impossible: Array<{ field: string; issue: string; min: number | null; max: number | null }> = [];
  for (const q of quality) {
    if (q.field.endsWith('_percentage') && q.max != null && q.max > 1.5) {
      impossible.push({ field: q.field, issue: 'percentage_gt_1.5_check_scale', min: q.min, max: q.max });
    }
    if (q.field.endsWith('_percentage') && q.min != null && q.min < 0) {
      impossible.push({ field: q.field, issue: 'negative_percentage', min: q.min, max: q.max });
    }
    if ((q.field.includes('rating') || q.field === 'pace') && q.max != null && q.max > 250) {
      impossible.push({ field: q.field, issue: 'rating_or_pace_gt_250', min: q.min, max: q.max });
    }
    if (q.field === 'possessions' && q.min != null && q.min < 0) {
      impossible.push({ field: q.field, issue: 'negative_possessions', min: q.min, max: q.max });
    }
  }

  const lastPageGames = new Set(gamesByPage[pages.length - 1] ?? []);
  const earlierGames = new Set(gamesByPage.slice(0, -1).flat());
  const completeSampleGameIds = [...gameIds].filter((id) => earlierGames.has(id) && !lastPageGames.has(id));

  const idClient = await pool.connect();
  let identity = {
    mappedPlayers: 0,
    unmappedPlayers: 0,
    mappedGames: 0,
    unmappedGames: 0,
    mappedTeams: 0,
    unmappedTeams: 0,
    gamesWrongSeason: [] as string[],
    teamConflicts: 0,
  };
  let logMatch = {
    completeSampleGames: completeSampleGameIds.length,
    advancedKeys: 0,
    matchingLogs: 0,
    advancedOnly: 0,
    logOnly: 0,
    note: 'Match set excludes games present on the last sample page (likely truncated).',
  };
  let after: Snap = before;
  try {
    await idClient.query('begin read only');
    const pids = [...playerIds];
    const gids = [...gameIds];
    const tids = [...teamIds];
    const players = pids.length
      ? await idClient.query<{ player_id: string }>(
          `select player_id from analytics.players where player_id = any($1::text[])`,
          [pids]
        )
      : { rows: [] as Array<{ player_id: string }> };
    const providerPlayers = pids.length
      ? await idClient.query<{ provider_player_id: string }>(
          `select provider_player_id from analytics.player_provider_ids
           where provider = 'balldontlie' and provider_player_id = any($1::text[])`,
          [pids]
        )
      : { rows: [] as Array<{ provider_player_id: string }> };
    const mappedPlayerSet = new Set([
      ...players.rows.map((r) => String(r.player_id)),
      ...providerPlayers.rows.map((r) => String(r.provider_player_id)),
    ]);
    const games = gids.length
      ? await idClient.query<{ game_id: string; season: string }>(
          `select game_id, season from analytics.games where game_id = any($1::text[])`,
          [gids]
        )
      : { rows: [] as Array<{ game_id: string; season: string }> };
    const mappedGameSet = new Set(games.rows.map((r) => String(r.game_id)));
    const wrongSeason = games.rows.filter((r) => String(r.season) !== '2024').map((r) => String(r.game_id));
    const teams = tids.length
      ? await idClient.query<{ team_id: string }>(
          `select team_id from analytics.teams where team_id = any($1::text[])`,
          [tids]
        )
      : { rows: [] as Array<{ team_id: string }> };
    const mappedTeamSet = new Set(teams.rows.map((r) => String(r.team_id)));

    let teamConflicts = 0;
    if (completeSampleGameIds.length) {
      const logs = await idClient.query<{ game_id: string; player_id: string; team_id: string }>(
        `select game_id, player_id, team_id
         from analytics.player_game_logs
         where season = '2024' and game_id = any($1::text[])`,
        [completeSampleGameIds]
      );
      const logKey = new Set(logs.rows.map((r) => `${r.game_id}|${r.player_id}`));
      const logTeam = new Map(logs.rows.map((r) => [`${r.game_id}|${r.player_id}`, String(r.team_id)]));
      const advKey = new Set<string>();
      for (const row of records) {
        const gameId = nestedId(row.game);
        const playerId = nestedId(row.player);
        const teamId = nestedId(row.team);
        if (!gameId || !playerId || !completeSampleGameIds.includes(gameId)) continue;
        const k = `${gameId}|${playerId}`;
        advKey.add(k);
        if (teamId && logTeam.has(k) && logTeam.get(k) !== teamId) teamConflicts += 1;
      }
      let matching = 0;
      let advancedOnly = 0;
      for (const k of advKey) {
        if (logKey.has(k)) matching += 1;
        else advancedOnly += 1;
      }
      let logOnly = 0;
      for (const k of logKey) if (!advKey.has(k)) logOnly += 1;
      logMatch = {
        completeSampleGames: completeSampleGameIds.length,
        advancedKeys: advKey.size,
        matchingLogs: matching,
        advancedOnly,
        logOnly,
        note: 'Match set excludes games present on the last sample page (likely truncated).',
      };
    }

    identity = {
      mappedPlayers: [...playerIds].filter((id) => mappedPlayerSet.has(id)).length,
      unmappedPlayers: [...playerIds].filter((id) => !mappedPlayerSet.has(id)).length,
      mappedGames: [...gameIds].filter((id) => mappedGameSet.has(id)).length,
      unmappedGames: [...gameIds].filter((id) => !mappedGameSet.has(id)).length,
      mappedTeams: [...teamIds].filter((id) => mappedTeamSet.has(id)).length,
      unmappedTeams: [...teamIds].filter((id) => !mappedTeamSet.has(id)).length,
      gamesWrongSeason: wrongSeason,
      teamConflicts,
    };
    after = await snapshot(idClient);
    await idClient.query('commit');
  } finally {
    idClient.release();
  }

  const recordsPerPage = pages.map((p) => p.recordCount);
  const pageSize = pages.find((p) => p.perPage != null)?.perPage ?? PER_PAGE;
  const fullPages = recordsPerPage.filter((n) => n === pageSize).length;
  const grainFactor = gp.size ? records.length / gp.size : 1;
  const providerTotal = pages.map((p) => p.totalCount).find((v) => typeof v === 'number') as number | undefined;

  const requestsForLogs = (logs: number, factor: number) => Math.ceil((logs * factor) / pageSize);
  const factorLow = Math.max(0.9, grainFactor * 0.95);
  const factorBase = grainFactor;
  const factorHigh = grainFactor * 1.1 + (dupGp > 0 ? 0.1 : 0);

  const seasonRequestEstimate = (year: number) => {
    const logs = KNOWN_SEASON_LOGS[year]!;
    const fromLogs = {
      low: requestsForLogs(logs, factorLow),
      base: requestsForLogs(logs, factorBase),
      high: requestsForLogs(logs, factorHigh),
    };
    if (year === SEASON && providerTotal != null) {
      const fromMeta = Math.ceil(providerTotal / pageSize);
      return {
        low: Math.min(fromLogs.low, fromMeta),
        base: fromMeta,
        high: Math.max(fromLogs.high, fromMeta + 5),
        source: 'provider_total_count_and_log_scale',
      };
    }
    return { ...fromLogs, source: 'player_game_log_scale_x_grain_factor' };
  };

  const est2024 = seasonRequestEstimate(2024);
  const est2025 = seasonRequestEstimate(2025);
  const est2023 = seasonRequestEstimate(2023);
  const combined = {
    low: est2025.low + est2024.low + est2023.low,
    base: est2025.base + est2024.base + est2023.base,
    high: est2025.high + est2024.high + est2023.high,
  };

  const timeFor = (n: number) => ({
    theoreticalHours: hoursForRequests(n, THEORETICAL_SPACING_SEC),
    practicalHours: hoursForRequests(n, PRACTICAL_SPACING_SEC),
  });

  const sampleBytes = pages.reduce((a, p) => a + p.bytes, 0);
  const bytesPerRecord = records.length ? sampleBytes / records.length : 0;
  const s3ForRequests = (reqLow: number, reqBase: number, reqHigh: number) => ({
    lowMb: mb(reqLow * pageSize * bytesPerRecord * 0.85),
    baseMb: mb(reqBase * pageSize * bytesPerRecord),
    highMb: mb(reqHigh * pageSize * bytesPerRecord * 1.15),
  });

  const cursorAdvances = pages.every((p, i) => {
    if (i === 0) return true;
    const prev = pages[i - 1]!;
    if (!prev.hasMore) return true;
    return p.pageIndex === prev.pageIndex + 1 && String(prev.nextCursor) !== 'null';
  });
  const distinctCursors = new Set(cursors.filter((c) => c != null).map((c) => String(c))).size;
  const cursorOk = pages.length <= 1 || (cursorAdvances && distinctCursors >= pages.length - 1);

  const spacingOk = avgSpacingMs == null || avgSpacingMs >= BDL_TRIAL_MIN_DELAY_MS;
  const afterIso = isolationFailures(after);
  const bytesChanged = after.dbBytes !== before.dbBytes;

  const matchRate =
    logMatch.advancedKeys > 0 ? Math.round((logMatch.matchingLogs / logMatch.advancedKeys) * 1000) / 10 : 0;

  const trialElapsedHours =
    Math.round(((Date.parse(generatedAt) - Date.parse(TRIAL_START)) / 3600000) * 100) / 100;
  const trialRemainingHours = Math.round((TRIAL_HOURS - trialElapsedHours) * 100) / 100;
  const advanced3Practical = timeFor(combined.base).practicalHours;
  const openingPropsHours = { low: 3.0, high: 5.3, note: 'unchanged from 2024 preflight; not started' };
  const openingOddsHours = { low: 0.8, high: 5.0, note: 'unchanged from 2024 preflight; not started' };
  const lineupHours = { hours: 5, note: 'optional; drop first if needed' };

  let verdict:
    | 'GREEN — Advanced Stats sample healthy; proceed to season archive'
    | 'YELLOW — useful but review field/coverage issues'
    | 'RED — do not spend trial time on full Advanced Stats archive';

  const redReasons: string[] = [];
  const yellowReasons: string[] = [];
  if (!records.length) redReasons.push('zero records');
  if (metrics.status429 > 0 && metrics.httpSuccess === 0) redReasons.push('only 429s');
  if (!spacingOk) redReasons.push(`spacing ${avgSpacingMs}ms`);
  if (afterIso.length) redReasons.push(`postgres mutated: ${afterIso.join(',')}`);
  if (identity.unmappedGames === gameIds.size && gameIds.size > 0) redReasons.push('no game IDs mapped');
  if (naturalKey === 'undetermined') yellowReasons.push('grain undetermined');
  if (identity.unmappedPlayers > 0 || identity.unmappedGames > 0) yellowReasons.push('unmapped identities');
  if (matchRate < 95 && logMatch.advancedKeys > 0) yellowReasons.push(`log match ${matchRate}%`);
  if (sparse.length > 8) yellowReasons.push('many sparse fields');
  if (!cursorOk) yellowReasons.push('cursor behavior irregular');
  if (metrics.status429 > 0) yellowReasons.push(`${metrics.status429} 429s`);

  if (redReasons.length) verdict = 'RED — do not spend trial time on full Advanced Stats archive';
  else if (yellowReasons.length) verdict = 'YELLOW — useful but review field/coverage issues';
  else verdict = 'GREEN — Advanced Stats sample healthy; proceed to season archive';

  const payload = {
    generatedAt,
    step: '5A',
    dryRun: false,
    postgresWrites: false,
    safety: { ...safety, lockAcquired: true, lockReleased: true },
    sampleAcquisition: {
      season: SEASON,
      endpoint: ADVANCED_STATS_V2_PATH,
      params: { 'seasons[]': String(SEASON), period: 0, per_page: PER_PAGE },
      pagesFetched: pages.length,
      records: records.length,
      exhaustedNaturally: pages.length < MAX_PAGES && pages.at(-1)?.hasMore === false,
      s3Prefix: plan.s3Prefix,
      sampleManifest: `${plan.s3Prefix}/_characterization_5page_manifest.json`,
      wroteCompleteManifest: false,
    },
    pagination: {
      recordsPerPage,
      pageSize,
      fullPages,
      cursorBehavior: cursorOk ? 'advances_consistently' : 'irregular',
      cursors: cursors.map((c) => (c == null ? null : String(c))),
      metaKeys: pages[0]?.metaKeys ?? [],
      providerTotalCount: providerTotal ?? null,
      providerTotalPages: pages[0]?.totalPages ?? null,
      httpAttempts: metrics.httpAttempts,
      httpSuccess: metrics.httpSuccess,
      status429: metrics.status429,
      retries: metrics.retries,
      retryAfterUsed: metrics.retryAfterUsed,
      avgSpacingMs,
      spacingSamplesMs: metrics.spacingSamplesMs,
      spacingOk,
    },
    recordGrain: {
      records: records.length,
      distinctGames: gameIds.size,
      distinctPlayers: playerIds.size,
      distinctTeams: teamIds.size,
      distinctPlayerGamePairs: gp.size,
      duplicatePlayerGameKeys: dupGp,
      distinctRecordIds: recordIds.size,
      periodValues: [...periodValues].sort(),
      periodZeroMeaning:
        periodValues.size === 1 && periodValues.has('0')
          ? 'period=0 returns full-game rows only in this sample'
          : 'mixed/unexpected period values',
      naturalUniqueKey: naturalKey,
      grainFactor,
    },
    fieldInventory: inventory,
    fieldQuality: {
      numeric: quality,
      universallyPopulated,
      sparse,
      unusable,
      suspiciousConstants,
      impossibleOrScaleFlags: impossible,
    },
    identityCompatibility: identity,
    existingLogMatch: { ...logMatch, matchRatePct: matchRate },
    sampleS3: {
      pages: pages.map((p) => ({ page: p.pageIndex, bytes: p.bytes, records: p.recordCount })),
      totalBytes: sampleBytes,
      totalPretty: `${mb(sampleBytes)} MB`,
      bytesPerRecord: Math.round(bytesPerRecord),
    },
    fullSeasonRequestEstimate: {
      pageSize,
      grainFactor,
      knownSeasonLogs: KNOWN_SEASON_LOGS,
      knownSeasonGames: KNOWN_SEASON_GAMES,
      season2024: est2024,
      season2025: est2025,
      season2023: est2023,
      combined,
      uncertainty: providerTotal == null ? 'high — no meta.total_count; scaled from player-game logs' : 'medium',
    },
    threeSeasonTimeEstimate: {
      spacingTheoreticalSec: THEORETICAL_SPACING_SEC,
      spacingPracticalSec: PRACTICAL_SPACING_SEC,
      season2025: timeFor(est2025.base),
      season2024: timeFor(est2024.base),
      season2023: timeFor(est2023.base),
      combinedBase: timeFor(combined.base),
      combinedHigh: timeFor(combined.high),
    },
    threeSeasonS3Estimate: {
      oneSeasonMb: s3ForRequests(est2024.low, est2024.base, est2024.high),
      threeSeasonsMb: s3ForRequests(combined.low, combined.base, combined.high),
      note: 'Raw JSON pages as archived; range not false precision.',
    },
    recommendedArchiveStrategy: {
      choice: 'A',
      label: 'one raw object per API page + manifest',
      reason: 'Matches existing historical games/stats archive (page=N.json + _manifest.json). Sample used _characterization_5page_manifest.json so a later full crawl can still write _manifest.json.',
    },
    recommendedAcquisitionOrder: {
      order: ['2025', '2024', '2023'],
      reason: 'Keep default 2025 → 2024 → 2023 so current-season enrichment is secured first if trial time runs short. 2024 sample confirmed the endpoint; 2023 last.',
    },
    trialTimeBudget: {
      trialStart: TRIAL_START,
      trialHours: TRIAL_HOURS,
      elapsedHours: trialElapsedHours,
      remainingHours: trialRemainingHours,
      requiredReserveHours: RESERVE_HOURS,
      remainingAfterReserveHours: Math.round((trialRemainingHours - RESERVE_HOURS) * 100) / 100,
      advancedStatsx3Hours: {
        low: timeFor(combined.low).practicalHours,
        base: advanced3Practical,
        high: timeFor(combined.high).practicalHours,
      },
      openingPropsHours,
      openingOddsHours,
      optionalLineupHours: lineupHours,
      dropOrderIfShort: ['full lineups', '2022', 'optional probes'],
      keepIfShort: ['Advanced Stats', 'opening player props', 'final validation reserve'],
    },
    postgresIsolation: {
      before,
      after,
      bytesChanged,
      isolationFailures: afterIso,
      advancedStatsTablesWritten: false,
    },
    materializationRecommendation:
      'S3-only for now. Do not create Advanced Stats serving tables. Later enrich analytics.player_game_logs on (game_id, player_id) if full-season match rate stays high. period=0 full-game rows only.',
    yellowReasons,
    redReasons,
    verdict,
  };

  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + '\n');
  writeFileSync(
    OUT_MD,
    [
      '# Advanced Stats V2 characterization (Step 5A)',
      '',
      `Generated: ${generatedAt}`,
      '',
      `**${verdict}**`,
      '',
      `- pages ${pages.length}/${MAX_PAGES}; records ${records.length}; grain ${naturalKey}`,
      `- HTTP attempts ${metrics.httpAttempts}; 429s ${metrics.status429}; avg spacing ${avgSpacingMs} ms`,
      `- identity games ${identity.mappedGames}/${gameIds.size}; players ${identity.mappedPlayers}/${playerIds.size}`,
      `- log match ${logMatch.matchingLogs}/${logMatch.advancedKeys} (${matchRate}%)`,
      `- 3-season request base ${combined.base}; practical ${advanced3Practical} h`,
      '',
      'Do not crawl a full season from this step. Do not write Advanced Stats to Postgres.',
      '',
    ].join('\n')
  );
  console.log(
    JSON.stringify(
      {
        verdict,
        pages: pages.length,
        records: records.length,
        grain: naturalKey,
        httpAttempts: metrics.httpAttempts,
        status429: metrics.status429,
        avgSpacingMs,
        matchRate,
        combinedRequestsBase: combined.base,
        redReasons,
        yellowReasons,
      },
      null,
      2
    )
  );
  if (verdict.startsWith('RED')) process.exitCode = 2;
  else if (verdict.startsWith('YELLOW')) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('[fatal]', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
