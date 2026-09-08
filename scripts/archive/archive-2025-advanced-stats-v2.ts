/**
 * Step 5B: complete season-2025 Advanced Stats V2 → S3. No Postgres writes.
 * Does not fetch 2024/2023. Does not start props, odds, lineups, or 2022.
 *
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/archive-2025-advanced-stats-v2.ts --dry-run
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/archive-2025-advanced-stats-v2.ts --execute
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import { ADVANCED_STATS_V2_PATH, planAdvancedStatsV2Archive } from '@/lib/archive/advanced-stats-v2';
import { listArchivePageKeys, type BdlEnvelope } from '@/lib/archive/resumable-s3-archive';
import { parseExecuteFlag } from '@/lib/archive/trial-archive-plan';
import { runAdvancedStatsV2Archive } from '@/scripts/archive/backfill-advanced-stats-v2';
import { acquireBdlAcquisitionLock, bdlAcquisitionLockStatus } from '@/lib/balldontlie/acquisition-lock';
import { BDL_NBA_BASE_URL, BdlArchiveClient, readBdlApiKey } from '@/lib/balldontlie/archive-client';
import {
  assertTrialExecuteAllowed,
  BDL_TRIAL_MIN_DELAY_MS,
  resolveBdlRequestDelayMs,
} from '@/lib/balldontlie/trial-limiter';
import pool from '@/lib/db';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

const SEASON = 2025;
const OUT_JSON = 'reports/trial/advanced-stats-2025-archive-report.json';
const OUT_MD = 'reports/trial/advanced-stats-2025-archive-report.md';
const SAMPLE_5A = 'reports/trial/advanced-stats-characterization.json';
const TRIAL_START = '2026-09-08T12:10:59.422Z';
const TRIAL_HOURS = 48;
const RESERVE_HOURS = 6;
const TIME_GATE_MAX_HOURS = 2.5;
const FORECAST = {
  lowPages: 438,
  basePages: 461,
  highPages: 507,
  practicalSpacingSec: 13.6,
  s3LowMb: 185,
  s3HighMb: 289,
  hoursLow: 1.66,
  hoursHigh: 2.0,
};
const LOGS = { 2023: 46090, 2024: 46150, 2025: 46056 } as const;
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
  dbMb: 326.96,
};

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

type FieldAgg = {
  field: string;
  nonNull: number;
  nullCount: number;
  zeroCount: number;
  min: number | null;
  max: number | null;
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
function hours(n: number): number {
  return Math.round(n * 100) / 100;
}
function hoursFor(requests: number, spacingSec: number): number {
  return hours((requests * spacingSec) / 3600);
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
  if (s.games_2023 !== EXPECTED.games2023 || s.logs_2023 !== EXPECTED.logs2023 || s.tgs_2023 !== EXPECTED.tgs2023) f.push('2023 serving');
  if (s.psa_2023 !== EXPECTED.psa2023 || s.tsa_2023 !== EXPECTED.tsa2023 || s.inferred_2023 !== EXPECTED.inferred2023) f.push('2023 averages/stints');
  if (s.games_2024 !== EXPECTED.games2024 || s.logs_2024 !== EXPECTED.logs2024 || s.tgs_2024 !== EXPECTED.tgs2024) f.push('2024 serving');
  if (s.psa_2024 !== EXPECTED.psa2024 || s.tsa_2024 !== EXPECTED.tsa2024 || s.inferred_2024 !== EXPECTED.inferred2024) f.push('2024 averages/stints');
  if (s.games_2025 !== EXPECTED.games2025 || s.logs_2025 !== EXPECTED.logs2025 || s.tgs_2025 !== EXPECTED.tgs2025) f.push('2025 serving');
  if (!s.box184 || Number(s.box184.home_score) !== EXPECTED.boxHome || Number(s.box184.away_score) !== EXPECTED.boxAway) f.push('18447793');
  if (s.games_2026 !== EXPECTED.games2026 || s.logs_2026 !== 0 || s.tgs_2026 !== 0 || s.stints_2026 !== EXPECTED.stints2026) f.push('2026');
  if (s.raw_pgs !== EXPECTED.rawPgs) f.push('raw.player_game_stats');
  if (s.advancedTable) f.push(`advanced table ${s.advancedTable}`);
  return f;
}

function ingestField(agg: Map<string, FieldAgg>, field: string, value: unknown, rowsSoFarForNull: number) {
  let a = agg.get(field);
  if (!a) {
    a = { field, nonNull: 0, nullCount: 0, zeroCount: 0, min: null, max: null };
    agg.set(field, a);
  }
  const n = asNumber(value);
  if (value == null || n == null) {
    a.nullCount += 1;
    return;
  }
  a.nonNull += 1;
  if (n === 0) a.zeroCount += 1;
  a.min = a.min == null ? n : Math.min(a.min, n);
  a.max = a.max == null ? n : Math.max(a.max, n);
  void rowsSoFarForNull;
}

async function main() {
  const { execute, dryRun } = parseExecuteFlag(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const plan = planAdvancedStatsV2Archive(['--season=2025', dryRun ? '--dry-run' : '--execute']);
  const mode = readIngestionMode();
  const pin = getAnalyticsSeason();
  const delay = resolveBdlRequestDelayMs();
  const lockIdle = bdlAcquisitionLockStatus();

  const elapsedHours = hours((Date.parse(generatedAt) - Date.parse(TRIAL_START)) / 3600000);
  const remainingHours = hours(TRIAL_HOURS - elapsedHours);
  const projectedHighHours = hoursFor(FORECAST.highPages, FORECAST.practicalSpacingSec);
  const projectedBaseHours = hoursFor(FORECAST.basePages, FORECAST.practicalSpacingSec);
  const projectedRemainingAfter = hours(remainingHours - projectedHighHours);

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
  if (plan.season !== SEASON) unsafe.push(`plan season ${plan.season}`);
  if (!plan.s3Prefix.endsWith('season=2025/entity=advanced_stats_v2')) unsafe.push('wrong S3 prefix');

  const pg = await pool.connect();
  let before: Snap;
  try {
    await pg.query('begin read only');
    before = await snapshot(pg);
    await pg.query('commit');
  } finally {
    pg.release();
  }
  if (before.dbMb < 324 || before.dbMb > 330) unsafe.push(`db size ${before.dbMb} MB not ~${EXPECTED.dbMb}`);
  unsafe.push(...isolationFailures(before).map((x) => `preflight ${x}`));

  const timeGate = {
    trialStart: TRIAL_START,
    elapsedHours,
    remainingHours,
    reserveHours: RESERVE_HOURS,
    remainingAfterReserveHours: hours(remainingHours - RESERVE_HOURS),
    forecastPages: FORECAST,
    projectedBaseHours,
    projectedHighHours,
    timeGateMaxHours: TIME_GATE_MAX_HOURS,
    projectedRemainingAfterThisCrawlHours: projectedRemainingAfter,
    proceed: projectedHighHours <= TIME_GATE_MAX_HOURS,
  };

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
    postgresMaterialize: false,
    dbMb: before.dbMb,
    dbBytes: before.dbBytes,
  };

  if (unsafe.length) {
    writeStopped(
      {
        generatedAt,
        step: '5B',
        stopped: true,
        reason: unsafe,
        safety,
        timeGate,
        verdict: 'RED — stop Advanced Stats progression',
      },
      2
    );
  }
  if (!timeGate.proceed) {
    writeStopped(
      {
        generatedAt,
        step: '5B',
        stopped: true,
        reason: [`projected 2025 crawl ${projectedHighHours}h exceeds ${TIME_GATE_MAX_HOURS}h gate`],
        safety,
        timeGate,
        verdict: 'RED — stop Advanced Stats progression',
      },
      2
    );
  }

  const s3 = new S3Storage({ bucket: process.env.NBA_DATA_BUCKET!.trim() });
  const prefixObjects: Array<{ key: string; bytes: number }> = [];
  for await (const obj of s3.listByPrefix(`${plan.s3Prefix}/`)) {
    prefixObjects.push({ key: obj.key, bytes: obj.size });
  }
  const pageKeysBefore = prefixObjects.filter((o) => /\/page=\d+\.json$/.test(o.key));
  const preserved = prefixObjects.filter(
    (o) => !/\/page=\d+\.json$/.test(o.key) && !o.key.endsWith('/_manifest.json')
  );

  if (dryRun) {
    const payload = {
      generatedAt,
      step: '5B',
      dryRun: true,
      bdlHttpRequests: 0,
      postgresWrites: false,
      safety,
      timeGate,
      prefixBefore: {
        objects: prefixObjects.length,
        pages: pageKeysBefore.length,
        preservedNonPage: preserved,
      },
      note: 'Safety and time gate GREEN. Rerun with --execute. Crawls 2025 only to cursor exhaustion.',
    };
    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + '\n');
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  assertTrialExecuteAllowed();
  const startedMs = Date.now();
  const lock = acquireBdlAcquisitionLock();
  const client = new BdlArchiveClient({ apiKey: readBdlApiKey(), baseUrl: BDL_NBA_BASE_URL });
  let archiveResult;
  try {
    console.log('[5B] archiving 2025 Advanced Stats V2 to S3 (no Postgres writes)');
    archiveResult = await runAdvancedStatsV2Archive({ season: SEASON, client, s3 });
  } finally {
    lock.release();
  }
  const durationMs = Date.now() - startedMs;
  const metrics = client.getMetrics();
  const spacing = metrics.spacingSamplesMs;
  const avgSpacingMs = spacing.length
    ? Math.round((spacing.reduce((a, b) => a + b, 0) / spacing.length) * 10) / 10
    : null;
  const minSpacingMs = spacing.length ? Math.min(...spacing) : null;
  const maxSpacingMs = spacing.length ? Math.max(...spacing) : null;

  const pageKeys = await listArchivePageKeys(s3, plan.s3Prefix);
  const indexes = pageKeys.map((k) => Number((k.match(/page=(\d+)\.json$/) ?? [])[1] ?? 0));
  const expectedSeq = indexes.map((_, i) => i + 1);
  const missingPages = expectedSeq.filter((n) => !indexes.includes(n));
  const duplicatePages = indexes.length !== new Set(indexes).size;
  let manifest: Record<string, unknown> | null = null;
  try {
    manifest = await s3.getJson<Record<string, unknown>>(`${plan.s3Prefix}/_manifest.json`);
  } catch {
    manifest = null;
  }

  const gameIds = new Set<string>();
  const playerIds = new Set<string>();
  const teamIds = new Set<string>();
  const gp = new Set<string>();
  const gpTeam = new Map<string, string>();
  let dupGp = 0;
  let rows = 0;
  const periodCounts = new Map<string, number>();
  const fields = new Map<string, FieldAgg>();
  const topLevelKeys = new Set<string>();
  const outliers: Array<Record<string, unknown>> = [];
  let highPace = 0;
  let highDrtg = 0;
  let outlierLowPossessions = 0;
  const pageRecordCounts: number[] = [];
  let lastNext: string | number | null = 'unset';

  for (const key of pageKeys) {
    const body = await s3.getJson<BdlEnvelope>(key);
    const data = Array.isArray(body?.data) ? body!.data : [];
    pageRecordCounts.push(data.length);
    lastNext = (body?.meta?.next_cursor ?? null) as string | number | null;
    for (const raw of data) {
      const row = rec(raw);
      if (!row) continue;
      rows += 1;
      for (const k of Object.keys(row)) topLevelKeys.add(k);
      const period = sid(row.period) ?? 'null';
      periodCounts.set(period, (periodCounts.get(period) ?? 0) + 1);
      const gameId = nestedId(row.game);
      const playerId = nestedId(row.player);
      const teamId = nestedId(row.team);
      if (gameId) gameIds.add(gameId);
      if (playerId) playerIds.add(playerId);
      if (teamId) teamIds.add(teamId);
      if (gameId && playerId) {
        const k = `${gameId}|${playerId}`;
        if (gp.has(k)) dupGp += 1;
        else gp.add(k);
        if (teamId) gpTeam.set(k, teamId);
      }
      for (const [k, v] of Object.entries(row)) {
        if (k === 'player' || k === 'team' || k === 'game') continue;
        ingestField(fields, k, v, rows);
      }
      const pace = asNumber(row.pace);
      const drtg = asNumber(row.defensive_rating);
      const poss = asNumber(row.possessions);
      if (pace != null && pace > 250) highPace += 1;
      if (drtg != null && drtg > 200) highDrtg += 1;
      if ((pace != null && pace > 250) || (drtg != null && drtg > 200)) {
        if ((poss ?? 0) <= 5) outlierLowPossessions += 1;
        if (outliers.length < 40) {
          outliers.push({
            gameId,
            playerId,
            pace,
            defensive_rating: drtg,
            possessions: poss,
            usage_percentage: asNumber(row.usage_percentage),
          });
        }
      }
    }
  }

  const quality = [...fields.values()]
    .map((f) => {
      const nonNull = f.nonNull;
      return {
        ...f,
        nullCount: rows - nonNull,
        pctPopulated: rows ? Math.round((nonNull / rows) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => a.field.localeCompare(b.field));

  let sample5a: { fieldQuality?: { numeric?: Array<{ field: string; pctPopulated: number; max: number | null }> } } | null =
    null;
  try {
    sample5a = JSON.parse(readFileSync(SAMPLE_5A, 'utf8')) as typeof sample5a;
  } catch {
    sample5a = null;
  }
  const sampleMap = new Map((sample5a?.fieldQuality?.numeric ?? []).map((q) => [q.field, q]));
  const substantialChanges: Array<{ field: string; samplePct: number; fullPct: number; delta: number }> = [];
  const watch = [
    'usage_percentage',
    'possessions',
    'offensive_rating',
    'defensive_rating',
    'net_rating',
    'true_shooting_percentage',
    'effective_field_goal_percentage',
    'pie',
    'pace',
    'box_outs',
    'matchup_fga',
    'switches_on',
  ];
  for (const field of watch) {
    const full = quality.find((q) => q.field === field);
    const sample = sampleMap.get(field);
    if (!full || !sample) continue;
    const delta = Math.round((full.pctPopulated - sample.pctPopulated) * 10) / 10;
    if (Math.abs(delta) >= 10) {
      substantialChanges.push({ field, samplePct: sample.pctPopulated, fullPct: full.pctPopulated, delta });
    }
  }

  const idClient = await pool.connect();
  let identity = {
    games: { mapped: 0, unmapped: 0, wrongSeason: [] as string[], distinct: gameIds.size },
    players: { mapped: 0, unmapped: 0, distinct: playerIds.size },
    teams: { mapped: 0, unmapped: 0, distinct: teamIds.size, conflicts: 0 },
  };
  let logMatch = {
    advancedKeys: gp.size,
    matchingLogs: 0,
    advancedOnly: 0,
    logOnly: 0,
    logs2025: 0,
    matchRatePct: 0,
    coverageVsLogsPct: 0,
    advancedOnlySample: [] as string[],
  };
  let after = before;
  try {
    await idClient.query('begin read only');
    const pids = [...playerIds];
    const gids = [...gameIds];
    const tids = [...teamIds];
    const players = pids.length
      ? await idClient.query<{ id: string }>(
          `select player_id as id from analytics.players where player_id = any($1::text[])
           union
           select provider_player_id as id from analytics.player_provider_ids
            where provider = 'balldontlie' and provider_player_id = any($1::text[])`,
          [pids]
        )
      : { rows: [] as Array<{ id: string }> };
    const mappedP = new Set(players.rows.map((r) => String(r.id)));
    const games = gids.length
      ? await idClient.query<{ game_id: string; season: string }>(
          `select game_id, season from analytics.games where game_id = any($1::text[])`,
          [gids]
        )
      : { rows: [] as Array<{ game_id: string; season: string }> };
    const mappedG = new Map(games.rows.map((r) => [String(r.game_id), String(r.season)]));
    const teams = tids.length
      ? await idClient.query<{ team_id: string }>(
          `select team_id from analytics.teams where team_id = any($1::text[])`,
          [tids]
        )
      : { rows: [] as Array<{ team_id: string }> };
    const mappedT = new Set(teams.rows.map((r) => String(r.team_id)));
    const logs = await idClient.query<{ game_id: string; player_id: string; team_id: string }>(
      `select game_id, player_id, team_id from analytics.player_game_logs where season = '2025'`
    );
    const logKey = new Set(logs.rows.map((r) => `${r.game_id}|${r.player_id}`));
    const logTeam = new Map(logs.rows.map((r) => [`${r.game_id}|${r.player_id}`, String(r.team_id)]));
    let matching = 0;
    let advancedOnly = 0;
    const advancedOnlySample: string[] = [];
    let teamConflicts = 0;
    for (const k of gp) {
      if (logKey.has(k)) {
        matching += 1;
        const advTeam = gpTeam.get(k);
        const basicTeam = logTeam.get(k);
        if (advTeam && basicTeam && advTeam !== basicTeam) teamConflicts += 1;
      } else {
        advancedOnly += 1;
        if (advancedOnlySample.length < 20) advancedOnlySample.push(k);
      }
    }
    let logOnly = 0;
    for (const k of logKey) if (!gp.has(k)) logOnly += 1;
    identity = {
      games: {
        mapped: [...gameIds].filter((id) => mappedG.has(id)).length,
        unmapped: [...gameIds].filter((id) => !mappedG.has(id)).length,
        wrongSeason: [...gameIds].filter((id) => mappedG.has(id) && mappedG.get(id) !== '2025'),
        distinct: gameIds.size,
      },
      players: {
        mapped: [...playerIds].filter((id) => mappedP.has(id)).length,
        unmapped: [...playerIds].filter((id) => !mappedP.has(id)).length,
        distinct: playerIds.size,
      },
      teams: {
        mapped: [...teamIds].filter((id) => mappedT.has(id)).length,
        unmapped: [...teamIds].filter((id) => !mappedT.has(id)).length,
        distinct: teamIds.size,
        conflicts: teamConflicts,
      },
    };
    logMatch = {
      advancedKeys: gp.size,
      matchingLogs: matching,
      advancedOnly,
      logOnly,
      logs2025: logKey.size,
      matchRatePct: gp.size ? Math.round((matching / gp.size) * 1000) / 10 : 0,
      coverageVsLogsPct: logKey.size ? Math.round((matching / logKey.size) * 1000) / 10 : 0,
      advancedOnlySample,
    };
    after = await snapshot(idClient);
    await idClient.query('commit');
  } finally {
    idClient.release();
  }

  // Per-key team conflicts are computed from gpTeam vs player-game logs.

  const prefixAfter: Array<{ key: string; bytes: number }> = [];
  for await (const obj of s3.listByPrefix(`${plan.s3Prefix}/`)) {
    prefixAfter.push({ key: obj.key, bytes: obj.size });
  }
  const s3Bytes = prefixAfter.reduce((a, o) => a + o.bytes, 0);
  const runMeta = {
    step: '5B',
    season: SEASON,
    endpoint: ADVANCED_STATS_V2_PATH,
    params: { 'seasons[]': '2025', period: 0, per_page: 100 },
    startedAt: new Date(startedMs).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs,
    http: metrics,
    archive: archiveResult,
  };
  await s3.putJson(`${plan.s3Prefix}/_run.json`, runMeta, { overwrite: true });

  const actualHours = hours(durationMs / 3600000);
  const recordsPerPage = pageKeys.length ? rows / pageKeys.length : 0;
  const coverage = LOGS[2025] ? rows / LOGS[2025] : 0;
  const estPages = (logs: number) => Math.ceil((logs * coverage) / Math.max(recordsPerPage, 1));
  const spacingSec = avgSpacingMs ? avgSpacingMs / 1000 : FORECAST.practicalSpacingSec;
  const rec2024 = {
    pages: estPages(LOGS[2024]),
    recordsEst: Math.round(LOGS[2024] * coverage),
    practicalHours: hoursFor(estPages(LOGS[2024]), spacingSec),
    s3Mb: pageKeys.length ? mb((s3Bytes * estPages(LOGS[2024])) / pageKeys.length) : null,
  };
  const rec2023 = {
    pages: estPages(LOGS[2023]),
    recordsEst: Math.round(LOGS[2023] * coverage),
    practicalHours: hoursFor(estPages(LOGS[2023]), spacingSec),
    s3Mb: pageKeys.length ? mb((s3Bytes * estPages(LOGS[2023])) / pageKeys.length) : null,
  };

  const periodOnlyZero = periodCounts.size === 1 && periodCounts.has('0');
  const seqOk = missingPages.length === 0 && !duplicatePages && indexes[0] === 1 && indexes.at(-1) === indexes.length;
  const exhausted = lastNext == null && archiveResult.exhausted;
  const limiterOk =
    minSpacingMs == null || minSpacingMs >= BDL_TRIAL_MIN_DELAY_MS || metrics.status429 > 0;
  const afterIso = isolationFailures(after);
  const bytesDelta = after.dbBytes - before.dbBytes;

  const redReasons: string[] = [];
  const yellowReasons: string[] = [];
  if (!exhausted) redReasons.push('cursor not exhausted');
  if (!periodOnlyZero) redReasons.push(`period distribution ${JSON.stringify([...periodCounts])}`);
  if (dupGp > 0) redReasons.push(`duplicate (game_id, player_id)=${dupGp}`);
  if (identity.games.unmapped > 0) redReasons.push(`unmapped games ${identity.games.unmapped}`);
  if (identity.games.wrongSeason.length) redReasons.push(`wrong-season games ${identity.games.wrongSeason.join(',')}`);
  if (identity.teams.unmapped > 0) redReasons.push(`unmapped teams ${identity.teams.unmapped}`);
  if (identity.teams.conflicts > 0) redReasons.push(`team conflicts ${identity.teams.conflicts}`);
  if (!seqOk) redReasons.push('page sequence invalid');
  if (!manifest || manifest.status !== 'success') redReasons.push('manifest not success');
  if (Number(manifest?.pageCount) !== pageKeys.length) redReasons.push('manifest pageCount mismatch');
  if (Number(manifest?.recordCount) !== rows) redReasons.push('manifest recordCount mismatch');
  if (afterIso.length) redReasons.push(`postgres mutated ${afterIso.join(',')}`);
  if (bytesDelta !== 0 && afterIso.length === 0) {
    yellowReasons.push(`postgres bytes delta ${bytesDelta} with serving row counts unchanged`);
  }
  if (!limiterOk) redReasons.push(`min spacing ${minSpacingMs}ms`);
  if (identity.players.unmapped > 0) yellowReasons.push(`unmapped players ${identity.players.unmapped}`);
  if (logMatch.advancedOnly > 0) yellowReasons.push(`advanced-only keys ${logMatch.advancedOnly}`);
  if (substantialChanges.length) yellowReasons.push(`field population shifted ${substantialChanges.map((c) => c.field).join(',')}`);
  if (metrics.status429 > 0) yellowReasons.push(`${metrics.status429} 429s`);

  let verdict:
    | 'GREEN — 2025 Advanced Stats archived successfully; proceed to 2024'
    | 'YELLOW — archive complete but review coverage/quality before continuing'
    | 'RED — stop Advanced Stats progression';
  if (redReasons.length) verdict = 'RED — stop Advanced Stats progression';
  else if (yellowReasons.length) verdict = 'YELLOW — archive complete but review coverage/quality before continuing';
  else verdict = 'GREEN — 2025 Advanced Stats archived successfully; proceed to 2024';

  const trialElapsedAfter = hours((Date.now() - Date.parse(TRIAL_START)) / 3600000);
  const trialRemainingAfter = hours(TRIAL_HOURS - trialElapsedAfter);

  const payload = {
    generatedAt,
    step: '5B',
    dryRun: false,
    postgresWrites: false,
    safety: { ...safety, lockAcquired: true, lockReleased: true },
    timeGate,
    acquisition: {
      ...archiveResult,
      durationMs,
      durationHours: actualHours,
      httpAttempts: metrics.httpAttempts,
      httpSuccess: metrics.httpSuccess,
      status429: metrics.status429,
      retries: metrics.retries,
      retryAfterUsed: metrics.retryAfterUsed,
      finalCursor: lastNext,
    },
    pagination: {
      pages: pageKeys.length,
      records: rows,
      recordsPerPage: pageRecordCounts,
      missingPages,
      duplicatePages,
      lastNextCursor: lastNext,
      exhausted,
    },
    rateLimit: {
      configuredMs: delay.delayMs,
      avgSpacingMs,
      minSpacingMs,
      maxSpacingMs,
      status429: metrics.status429,
      retries: metrics.retries,
      retryAfterUsed: metrics.retryAfterUsed,
      limiterOk,
      note: 'Retry-After gaps are reported separately and are not treated as normal spacing failures.',
    },
    recordGrain: {
      totalRows: rows,
      distinctPlayerGamePairs: gp.size,
      duplicatePlayerGameKeys: dupGp,
      distinctGames: gameIds.size,
      distinctPlayers: playerIds.size,
      distinctTeams: teamIds.size,
      periodDistribution: Object.fromEntries(periodCounts),
    },
    identityCompatibility: identity,
    playerGameLogMatch: logMatch,
    fieldQuality: {
      fields: quality,
      substantialChangesVs5A: substantialChanges,
      switches_on: quality.find((q) => q.field === 'switches_on') ?? null,
      topLevelKeyCount: topLevelKeys.size,
    },
    outlierProfile: {
      highPaceGt250: highPace,
      highDefensiveRatingGt200: highDrtg,
      outliersWithPossessionsLte5: outlierLowPossessions,
      sample: outliers,
      note: 'Extremes kept as-is. Associated with very low possessions in this profile when possessions <= 5.',
    },
    s3Validation: {
      prefix: plan.s3Prefix,
      manifest,
      pageCount: pageKeys.length,
      recordCount: rows,
      sequenceOk: seqOk,
      exhausted,
      objects: prefixAfter.length,
      bytes: s3Bytes,
      mb: mb(s3Bytes),
      preservedNonPageBefore: preserved,
      runObject: `${plan.s3Prefix}/_run.json`,
    },
    forecastVsActual: {
      forecast: FORECAST,
      actual: {
        pages: pageKeys.length,
        records: rows,
        requests: metrics.httpAttempts,
        durationHours: actualHours,
        s3Mb: mb(s3Bytes),
      },
    },
    recalibrated2024: rec2024,
    recalibrated2023: rec2023,
    remainingAdvanced: {
      requests: rec2024.pages + rec2023.pages,
      practicalHours: hours((rec2024.practicalHours ?? 0) + (rec2023.practicalHours ?? 0)),
      s3Mb: rec2024.s3Mb != null && rec2023.s3Mb != null ? Math.round((rec2024.s3Mb + rec2023.s3Mb) * 100) / 100 : null,
    },
    trialTimeBudget: {
      trialStart: TRIAL_START,
      elapsedHours: trialElapsedAfter,
      remainingHours: trialRemainingAfter,
      reserveHours: RESERVE_HOURS,
      remainingAfterReserveHours: hours(trialRemainingAfter - RESERVE_HOURS),
      remainingAdvanced2024plus2023Hours: hours((rec2024.practicalHours ?? 0) + (rec2023.practicalHours ?? 0)),
      openingPropsHours: { low: 3.0, high: 5.3 },
      openingOddsHours: { low: 0.8, high: 5.0 },
      optionalLineupHours: 5,
      priority: [
        'Advanced Stats 2025/2024/2023',
        'Opening player props',
        'Opening odds',
        'Final validation/reserve',
        'Optional lineups',
        'Optional 2022',
      ],
    },
    postgresIsolation: {
      beforeBytes: before.dbBytes,
      afterBytes: after.dbBytes,
      deltaBytes: bytesDelta,
      before,
      after,
      isolationFailures: afterIso,
    },
    redReasons,
    yellowReasons,
    verdict,
  };

  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + '\n');
  writeFileSync(
    OUT_MD,
    [
      '# 2025 Advanced Stats V2 archive (Step 5B)',
      '',
      `Generated: ${generatedAt}`,
      '',
      `**${verdict}**`,
      '',
      `- pages ${pageKeys.length}; records ${rows}; exhausted ${exhausted}`,
      `- HTTP ${metrics.httpAttempts}; 429s ${metrics.status429}; duration ${actualHours} h`,
      `- grain dup=${dupGp}; period zero-only=${periodOnlyZero}`,
      `- log match ${logMatch.matchingLogs}/${logMatch.advancedKeys} (${logMatch.matchRatePct}%); coverage ${logMatch.coverageVsLogsPct}%`,
      `- S3 ${mb(s3Bytes)} MB; Postgres delta ${bytesDelta} bytes`,
      '',
      'Do not start 2024. Do not write Advanced Stats to Postgres.',
      '',
    ].join('\n')
  );
  console.log(
    JSON.stringify(
      {
        verdict,
        pages: pageKeys.length,
        records: rows,
        httpAttempts: metrics.httpAttempts,
        durationHours: actualHours,
        s3Mb: mb(s3Bytes),
        matchRate: logMatch.matchRatePct,
        coverage: logMatch.coverageVsLogsPct,
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
