/**
 * Step 4A: BDL season 2023 → S3 raw archive only.
 * Does not materialize Postgres. Does not start 2022. Does not fetch advanced/props/odds/lineups.
 *
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/archive-2023-s3-trial.ts --dry-run
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/archive-2023-s3-trial.ts --execute
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { S3Storage } from '@/lib/aws/s3';
import {
  acquireBdlAcquisitionLock,
  bdlAcquisitionLockStatus,
} from '@/lib/balldontlie/acquisition-lock';
import { type BdlEnvelope } from '@/lib/balldontlie/archive-client';
import {
  assertTrialExecuteAllowed,
  BDL_TRIAL_MIN_DELAY_MS,
  resolveBdlRequestDelayMs,
} from '@/lib/balldontlie/trial-limiter';
import { parseExecuteFlag } from '@/lib/archive/trial-archive-plan';
import { assertCompleteHistoricalArchive, type BdlEntityManifest } from '@/lib/ingestion/historical-serving/archive-gate';
import { buildServingBackfillPlan } from '@/lib/ingestion/historical-serving/plan';
import { runBackfillBalldontlieSeason } from '@/scripts/archive/backfill-balldontlie-season';
import pool from '@/lib/db';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

const SEASON = 2023;
const OUT_JSON = 'reports/trial/2023-s3-archive-report.json';
const OUT_MD = 'reports/trial/2023-s3-archive-report.md';
const BOX_ID = '18447793';
const BASELINE_2024_ATTEMPTS = 477;
const BASELINE_2024_AVG_MS = 13654;
const BASELINE_2024_HOURS = 1.81;
const EST_REQ_LOW = 450;
const EST_REQ_HIGH = 500;
const MAX_START_HOURS = 3;
const ARCHIVE_2024_MB = 88.54;
const EXPECTED = {
  games2024: 1321,
  logs2024: 46150,
  tgs2024: 2642,
  psa2024: 587,
  tsa2024: 30,
  inferred2024: 699,
  games2025: 1323,
  logs2025: 46056,
  tgs2025: 2644,
  rawPgs: 46056,
  games2026: 1200,
  logs2026: 0,
  stints2026: 578,
  boxHome: 109,
  boxAway: 118,
};

type PgSnap = {
  dbBytes: number;
  games_2023: number;
  logs_2023: number;
  tgs_2023: number;
  psa_2023: number;
  tsa_2023: number;
  stints_2023: number;
  rawPgs: number;
  rawPgsSeason2023: number;
  rawPgsSeason2025: number;
  games_2024: number;
  logs_2024: number;
  tgs_2024: number;
  psa_2024: number;
  tsa_2024: number;
  inferred_2024: number;
  games_2025: number;
  logs_2025: number;
  tgs_2025: number;
  box184: { home: number | null; away: number | null } | null;
  games_2026: number;
  logs_2026: number;
  tgs_2026: number;
  stints_2026: number;
};

function sid(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function isFinal(status: unknown): boolean {
  const s = String(status ?? '').trim().toLowerCase();
  return s === 'final' || s.includes('final');
}

function dateOnly(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length >= 10 ? s.slice(0, 10) : s || null;
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function hoursFromRequests(n: number, avgMs: number): number {
  return Math.round(((n * avgMs) / 3_600_000) * 100) / 100;
}

function mb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

async function sumPrefix(s3: S3Storage, prefix: string): Promise<{ bytes: number; objects: number }> {
  let bytes = 0;
  let objects = 0;
  for await (const obj of s3.listByPrefix(prefix)) {
    bytes += obj.size;
    objects += 1;
  }
  return { bytes, objects };
}

async function listPageKeys(s3: S3Storage, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  for await (const obj of s3.listByPrefix(`${prefix}/`)) {
    if (/\/page=\d+\.json$/.test(obj.key)) keys.push(obj.key);
  }
  keys.sort((a, b) => {
    const na = Number((a.match(/page=(\d+)\.json$/) ?? [])[1] ?? 0);
    const nb = Number((b.match(/page=(\d+)\.json$/) ?? [])[1] ?? 0);
    return na - nb;
  });
  return keys;
}

function pageSequenceIssues(keys: string[], expectedCount: number): string[] {
  const issues: string[] = [];
  const nums = keys.map((k) => Number((k.match(/page=(\d+)\.json$/) ?? [])[1] ?? NaN));
  if (keys.length !== expectedCount) {
    issues.push(`object count ${keys.length} != manifest pageCount ${expectedCount}`);
  }
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) {
      issues.push(`page sequence break at index ${i}: expected page=${i + 1}, got page=${nums[i]}`);
      break;
    }
  }
  return issues;
}

async function snapshotPostgres(): Promise<PgSnap> {
  const client = await pool.connect();
  try {
    await client.query('begin read only');
    const r = await client.query(
      `select
         pg_database_size(current_database())::bigint as db_bytes,
         (select count(*)::int from analytics.games where season = '2023') as games_2023,
         (select count(*)::int from analytics.player_game_logs where season = '2023') as logs_2023,
         (select count(*)::int from analytics.team_game_stats where season = '2023') as tgs_2023,
         (select count(*)::int from analytics.player_season_averages where season = '2023') as psa_2023,
         (select count(*)::int from analytics.team_season_averages where season = '2023') as tsa_2023,
         (select count(*)::int from analytics.player_team_stints where season = '2023') as stints_2023,
         (select count(*)::int from raw.player_game_stats) as raw_pgs,
         (select count(*)::int
            from raw.player_game_stats s
            join analytics.games g on g.game_id = s.game_id::text
           where g.season = '2023') as raw_pgs_season_2023,
         (select count(*)::int
            from raw.player_game_stats s
            join analytics.games g on g.game_id = s.game_id::text
           where g.season = '2025') as raw_pgs_season_2025,
         (select count(*)::int from analytics.games where season = '2024') as games_2024,
         (select count(*)::int from analytics.player_game_logs where season = '2024') as logs_2024,
         (select count(*)::int from analytics.team_game_stats where season = '2024') as tgs_2024,
         (select count(*)::int from analytics.player_season_averages where season = '2024') as psa_2024,
         (select count(*)::int from analytics.team_season_averages where season = '2024') as tsa_2024,
         (select count(*)::int from analytics.player_team_stints
           where season = '2024' and source = 'inferred_pgl') as inferred_2024,
         (select count(*)::int from analytics.games where season = '2025') as games_2025,
         (select count(*)::int from analytics.player_game_logs where season = '2025') as logs_2025,
         (select count(*)::int from analytics.team_game_stats where season = '2025') as tgs_2025,
         (select count(*)::int from analytics.games where season = '2026') as games_2026,
         (select count(*)::int from analytics.player_game_logs where season = '2026') as logs_2026,
         (select count(*)::int from analytics.team_game_stats where season = '2026') as tgs_2026,
         (select count(*)::int from analytics.player_team_stints where season = '2026') as stints_2026`
    );
    const box = await client.query(
      `select home_score, away_score from analytics.games where game_id = $1`,
      [BOX_ID]
    );
    await client.query('commit');
    const row = r.rows[0]!;
    const b = box.rows[0];
    return {
      dbBytes: Number(row.db_bytes),
      games_2023: Number(row.games_2023),
      logs_2023: Number(row.logs_2023),
      tgs_2023: Number(row.tgs_2023),
      psa_2023: Number(row.psa_2023),
      tsa_2023: Number(row.tsa_2023),
      stints_2023: Number(row.stints_2023),
      rawPgs: Number(row.raw_pgs),
      rawPgsSeason2023: Number(row.raw_pgs_season_2023),
      rawPgsSeason2025: Number(row.raw_pgs_season_2025),
      games_2024: Number(row.games_2024),
      logs_2024: Number(row.logs_2024),
      tgs_2024: Number(row.tgs_2024),
      psa_2024: Number(row.psa_2024),
      tsa_2024: Number(row.tsa_2024),
      inferred_2024: Number(row.inferred_2024),
      games_2025: Number(row.games_2025),
      logs_2025: Number(row.logs_2025),
      tgs_2025: Number(row.tgs_2025),
      box184: b ? { home: Number(b.home_score), away: Number(b.away_score) } : null,
      games_2026: Number(row.games_2026),
      logs_2026: Number(row.logs_2026),
      tgs_2026: Number(row.tgs_2026),
      stints_2026: Number(row.stints_2026),
    };
  } catch (err) {
    try {
      await client.query('rollback');
    } catch {
      // ignore
    }
    throw err;
  } finally {
    client.release();
  }
}

function serving2023Empty(pg: PgSnap): boolean {
  return (
    pg.games_2023 === 0 &&
    pg.logs_2023 === 0 &&
    pg.tgs_2023 === 0 &&
    pg.psa_2023 === 0 &&
    pg.tsa_2023 === 0 &&
    pg.stints_2023 === 0 &&
    pg.rawPgsSeason2023 === 0
  );
}

function isolation2024Ok(pg: PgSnap): boolean {
  return (
    pg.games_2024 === EXPECTED.games2024 &&
    pg.logs_2024 === EXPECTED.logs2024 &&
    pg.tgs_2024 === EXPECTED.tgs2024 &&
    pg.psa_2024 === EXPECTED.psa2024 &&
    pg.tsa_2024 === EXPECTED.tsa2024 &&
    pg.inferred_2024 === EXPECTED.inferred2024
  );
}

function isolation2025Ok(pg: PgSnap): boolean {
  return (
    pg.games_2025 === EXPECTED.games2025 &&
    pg.logs_2025 === EXPECTED.logs2025 &&
    pg.tgs_2025 === EXPECTED.tgs2025 &&
    pg.box184?.home === EXPECTED.boxHome &&
    pg.box184?.away === EXPECTED.boxAway
  );
}

function isolation2026Ok(pg: PgSnap): boolean {
  return pg.games_2026 === EXPECTED.games2026 && pg.logs_2026 === EXPECTED.logs2026 && pg.stints_2026 === EXPECTED.stints2026;
}

async function validateArchive(s3: S3Storage, plan: { s3GamesPrefix: string; s3StatsPrefix: string }) {
  const gamesManifest = await s3.getJson<BdlEntityManifest>(`${plan.s3GamesPrefix}/_manifest.json`);
  const statsManifest = await s3.getJson<BdlEntityManifest>(`${plan.s3StatsPrefix}/_manifest.json`);
  const gamesPageKeys = await listPageKeys(s3, plan.s3GamesPrefix);
  const statsPageKeys = await listPageKeys(s3, plan.s3StatsPrefix);
  const gate = assertCompleteHistoricalArchive({
    season: SEASON,
    gamesManifest,
    statsManifest,
    gamesPageKeys,
    statsPageKeys,
  });

  const gamesSeq = pageSequenceIssues(gamesPageKeys, Number(gamesManifest?.pageCount ?? 0));
  const statsSeq = pageSequenceIssues(statsPageKeys, Number(statsManifest?.pageCount ?? 0));

  const games: Array<{
    id: string;
    date: string | null;
    status: string | null;
    postseason: boolean;
    homeId: string;
    awayId: string;
    homeScore: number | null;
    awayScore: number | null;
  }> = [];
  const gameIdCounts = new Map<string, number>();
  let gamesCursorComplete = false;
  let gamesLastNext: unknown = 'unset';
  for (let i = 0; i < gamesPageKeys.length; i++) {
    const env = await s3.getJson<BdlEnvelope>(gamesPageKeys[i]!);
    const rows = Array.isArray(env?.data) ? env.data : [];
    const next = env?.meta?.next_cursor ?? null;
    gamesLastNext = next;
    if (i === gamesPageKeys.length - 1) gamesCursorComplete = next == null;
    for (const raw of rows) {
      const g = raw as Record<string, unknown>;
      const home = (g.home_team ?? null) as Record<string, unknown> | null;
      const vis = (g.visitor_team ?? null) as Record<string, unknown> | null;
      const id = sid(g.id);
      if (id) gameIdCounts.set(id, (gameIdCounts.get(id) ?? 0) + 1);
      games.push({
        id,
        date: dateOnly(g.date) ?? dateOnly(g.datetime),
        status: g.status == null ? null : String(g.status),
        postseason: Boolean(g.postseason),
        homeId: sid(home?.id),
        awayId: sid(vis?.id),
        homeScore: toNum(g.home_team_score),
        awayScore: toNum(g.visitor_team_score),
      });
    }
  }
  const duplicateGameIds = [...gameIdCounts.entries()].filter(([, n]) => n > 1).map(([id, n]) => ({ id, n }));
  const inventoryIds = new Set(games.map((g) => g.id).filter(Boolean));
  const finals = games.filter((g) => isFinal(g.status));

  const stats = {
    records: 0,
    distinctGames: new Set<string>(),
    distinctPlayers: new Set<string>(),
    distinctStatIds: new Set<string>(),
    duplicateStatIds: 0,
    playerGameCounts: new Map<string, number>(),
    missingPlayerId: 0,
    missingTeamId: 0,
    missingGameId: 0,
    unknownGameIds: new Set<string>(),
    dates: [] as string[],
    teamIdsByGame: new Map<string, Set<string>>(),
    ptsByGameTeam: new Map<string, Map<string, number>>(),
  };
  let statsCursorComplete = false;
  let statsLastNext: unknown = 'unset';
  for (let i = 0; i < statsPageKeys.length; i++) {
    const env = await s3.getJson<BdlEnvelope>(statsPageKeys[i]!);
    const rows = Array.isArray(env?.data) ? env.data : [];
    const next = env?.meta?.next_cursor ?? null;
    statsLastNext = next;
    if (i === statsPageKeys.length - 1) statsCursorComplete = next == null;
    for (const raw of rows) {
      const s = raw as Record<string, unknown>;
      const player = (s.player ?? null) as Record<string, unknown> | null;
      const team = (s.team ?? null) as Record<string, unknown> | null;
      const game = (s.game ?? null) as Record<string, unknown> | null;
      stats.records += 1;
      const statId = sid(s.id);
      if (statId) {
        if (stats.distinctStatIds.has(statId)) stats.duplicateStatIds += 1;
        else stats.distinctStatIds.add(statId);
      }
      const playerId = sid(player?.id);
      const teamId = sid(team?.id);
      const gameId = sid(game?.id ?? s.game_id);
      if (!playerId) stats.missingPlayerId += 1;
      if (!teamId) stats.missingTeamId += 1;
      if (!gameId) stats.missingGameId += 1;
      if (playerId) stats.distinctPlayers.add(playerId);
      if (gameId) {
        stats.distinctGames.add(gameId);
        if (!inventoryIds.has(gameId)) stats.unknownGameIds.add(gameId);
        const key = `${gameId}::${playerId || 'null'}`;
        stats.playerGameCounts.set(key, (stats.playerGameCounts.get(key) ?? 0) + 1);
        const teams = stats.teamIdsByGame.get(gameId) ?? new Set<string>();
        if (teamId) teams.add(teamId);
        stats.teamIdsByGame.set(gameId, teams);
        if (teamId) {
          const pm = stats.ptsByGameTeam.get(gameId) ?? new Map<string, number>();
          pm.set(teamId, (pm.get(teamId) ?? 0) + (toNum(s.pts) ?? 0));
          stats.ptsByGameTeam.set(gameId, pm);
        }
      }
      const d = dateOnly(game?.date) ?? dateOnly(game?.datetime);
      if (d) stats.dates.push(d);
    }
  }
  stats.dates.sort();
  const logicalDup = [...stats.playerGameCounts.entries()].filter(([, n]) => n > 1);
  const finalsWithZeroStats: string[] = [];
  const oneTeamOnly: string[] = [];
  const scoreMismatches: Array<{
    gameId: string;
    official: { home: number | null; away: number | null };
    summed: { home: number; away: number };
  }> = [];
  let scoreMatches = 0;
  for (const g of finals) {
    const n = stats.teamIdsByGame.get(g.id);
    if (!n || n.size === 0) finalsWithZeroStats.push(g.id);
    else if (g.homeId && g.awayId && (!n.has(g.homeId) || !n.has(g.awayId))) oneTeamOnly.push(g.id);
    const pts = stats.ptsByGameTeam.get(g.id) ?? new Map();
    const homePts = pts.get(g.homeId) ?? 0;
    const awayPts = pts.get(g.awayId) ?? 0;
    if (g.homeScore == null || g.awayScore == null) continue;
    if (homePts === g.homeScore && awayPts === g.awayScore) {
      scoreMatches += 1;
    } else {
      scoreMismatches.push({
        gameId: g.id,
        official: { home: g.homeScore, away: g.awayScore },
        summed: { home: homePts, away: awayPts },
      });
    }
  }

  return {
    gate,
    games: {
      manifest: gamesManifest,
      pageKeys: gamesPageKeys.length,
      sequenceIssues: gamesSeq,
      cursorCompletedNaturally: gamesCursorComplete,
      lastNextCursor: gamesLastNext,
      total: games.length,
      uniqueGameIds: inventoryIds.size,
      finals: finals.length,
      postseason: games.filter((g) => g.postseason).length,
      duplicateProviderGameIds: duplicateGameIds,
    },
    stats: {
      manifest: statsManifest,
      pageKeys: statsPageKeys.length,
      sequenceIssues: statsSeq,
      cursorCompletedNaturally: statsCursorComplete,
      lastNextCursor: statsLastNext,
      records: stats.records,
      distinctGameIds: stats.distinctGames.size,
      distinctPlayers: stats.distinctPlayers.size,
      duplicateProviderStatIds: stats.duplicateStatIds,
      firstDate: stats.dates[0] ?? null,
      lastDate: stats.dates[stats.dates.length - 1] ?? null,
      unknownNonSeasonGameIds: [...stats.unknownGameIds].sort(),
      missingPlayerId: stats.missingPlayerId,
      missingTeamId: stats.missingTeamId,
      missingGameId: stats.missingGameId,
      logicalPlayerGameDuplicates: logicalDup.length,
      logicalPlayerGameDuplicateSample: logicalDup.slice(0, 25).map(([k, n]) => ({ key: k, n })),
    },
    coverage: {
      authoritativeFinals: finals.length,
      finalsRepresentedInStats: finals.length - finalsWithZeroStats.length,
      finalsWithZeroPlayerStats: finalsWithZeroStats,
      oneTeamOnlyFinals: oneTeamOnly,
      statsReferencingUnknownGames: [...stats.unknownGameIds].sort(),
    },
    scoreReconciliation: {
      finals: finals.length,
      matches: scoreMatches,
      mismatches: scoreMismatches.length,
      mismatchIds: scoreMismatches.map((m) => m.gameId),
      mismatchSample: scoreMismatches.slice(0, 25),
    },
  };
}

function remainingTimeBudget(actual2023: { attempts: number; hours: number; avgMs: number | null }) {
  const avgMs = actual2023.avgMs ?? BASELINE_2024_AVG_MS;
  const hours = (n: number) => hoursFromRequests(n, avgMs);
  return {
    note: '2023 core archive complete. Do not start Advanced Stats, opening props/odds, lineups, or 2022. Keep a 6-hour end-of-trial reserve.',
    baseline2024: { httpAttempts: BASELINE_2024_ATTEMPTS, avgSpacingMs: BASELINE_2024_AVG_MS, apiHours: BASELINE_2024_HOURS },
    actual2023Core: actual2023,
    phases: [
      { phase: '2023 materialization', expectedApiRequests: 0, estimatedApiTime: '0', priority: 'MUST', started: false },
      { phase: 'Advanced 2025', expectedApiRequests: '~350–550', estimatedApiTime: `~${hours(350)}–${hours(550)} h`, priority: 'HIGH', started: false },
      { phase: 'Advanced 2024', expectedApiRequests: '~350–550', estimatedApiTime: `~${hours(350)}–${hours(550)} h`, priority: 'HIGH', started: false },
      { phase: 'Advanced 2023', expectedApiRequests: '~350–550', estimatedApiTime: `~${hours(350)}–${hours(550)} h`, priority: 'HIGH', started: false },
      { phase: 'Opening props', expectedApiRequests: '~800–1400', estimatedApiTime: `~${hours(800)}–${hours(1400)} h`, priority: 'HIGH', started: false },
      { phase: 'Opening odds', expectedApiRequests: '~200–1320', estimatedApiTime: `~${hours(200)}–${hours(1320)} h`, priority: 'HIGH', started: false },
      { phase: 'Lineups', expectedApiRequests: '~1300', estimatedApiTime: `~${hours(1300)} h`, priority: 'OPTIONAL', started: false },
      { phase: '2022 core', expectedApiRequests: '~450–500', estimatedApiTime: `~${hours(450)}–${hours(500)} h`, priority: 'OPTIONAL', started: false },
    ],
    endOfTrialReserveHours: 6,
  };
}

function compareArchiveSize(actualMb: number): 'smaller' | 'similar' | 'materially larger' {
  if (actualMb > ARCHIVE_2024_MB * 1.2 || actualMb - ARCHIVE_2024_MB > 15) return 'materially larger';
  if (actualMb < ARCHIVE_2024_MB * 0.9) return 'smaller';
  return 'similar';
}

async function main() {
  const { dryRun, execute } = parseExecuteFlag(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const mode = readIngestionMode();
  const pin = getAnalyticsSeason();
  const delay = resolveBdlRequestDelayMs();
  const lockIdle = bdlAcquisitionLockStatus();
  const plan = buildServingBackfillPlan({ season: SEASON, rawPrefix: process.env.NBA_RAW_PREFIX, blockedReason: null });

  const hoursLow = hoursFromRequests(EST_REQ_LOW, BASELINE_2024_AVG_MS);
  const hoursHigh = hoursFromRequests(EST_REQ_HIGH, BASELINE_2024_AVG_MS);
  const preExecutionTimeEstimate = {
    baseline2024: {
      httpAttempts: BASELINE_2024_ATTEMPTS,
      apiHours: BASELINE_2024_HOURS,
      avgSecondsPerRequest: BASELINE_2024_AVG_MS / 1000,
    },
    expectedRequests: `${EST_REQ_LOW}–${EST_REQ_HIGH}`,
    expectedHours: `${hoursLow}–${hoursHigh}`,
    stopIfOverHours: MAX_START_HOURS,
    projectedMaxHours: hoursHigh,
  };

  const unsafe: string[] = [];
  if (!delay.trialMode) unsafe.push('BDL_TRIAL_MODE is not 1');
  if (delay.delayMs !== 13_000) unsafe.push(`effective spacing ${delay.delayMs}ms (expected 13000)`);
  if (delay.delayMs < BDL_TRIAL_MIN_DELAY_MS) unsafe.push(`spacing below 12000ms`);
  if (delay.concurrency !== 1) unsafe.push(`concurrency=${delay.concurrency}`);
  if (mode.dataMode !== 'replay') unsafe.push(`DATA_MODE=${mode.dataMode || '(empty)'}`);
  if (!mode.offseason) unsafe.push('OFFSEASON_MODE not 1');
  if (!mode.cronDryRun) unsafe.push('CRON_DRY_RUN not 1');
  if (pin !== '2025') unsafe.push(`season pin=${pin}`);
  if (lockIdle.active) unsafe.push(`BDL lock already active pid=${lockIdle.pid}`);
  if (plan.stagingMode !== 'none') unsafe.push(`stagingMode=${plan.stagingMode}`);
  if (hoursHigh > MAX_START_HOURS) unsafe.push(`projected runtime ${hoursHigh}h exceeds ${MAX_START_HOURS}h`);

  const safety = {
    bdlTrialMode: delay.trialMode,
    delayMs: delay.delayMs,
    minSpacingMs: BDL_TRIAL_MIN_DELAY_MS,
    concurrency: delay.concurrency,
    delaySource: delay.source,
    dataMode: mode.dataMode,
    offseasonMode: mode.offseason,
    cronDryRun: mode.cronDryRun,
    frozen: mode.dataMode === 'replay' && mode.offseason && mode.cronDryRun,
    currentAnalyticsSeason: pin,
    lockIdleBefore: !lockIdle.active,
    stagingMode: plan.stagingMode,
    s3GamesPrefix: plan.s3GamesPrefix,
    s3StatsPrefix: plan.s3StatsPrefix,
    entities: ['games', 'player_stats'] as const,
    postgresMaterialize: false,
    season2022NotStarted: true,
  };

  if (unsafe.length) {
    const stopped = {
      generatedAt,
      step: '4A',
      stopped: true,
      reason: 'safety preflight failed',
      unsafe,
      safety,
      preExecutionTimeEstimate,
      verdict: 'RED — stop 2023 progression',
    };
    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(stopped, null, 2) + '\n');
    console.log(JSON.stringify(stopped, null, 2));
    process.exit(2);
  }

  console.log('=== Step 4A 2023 S3 archive (games + player_stats) ===');
  console.log(`  stagingMode       : ${plan.stagingMode}`);
  console.log(`  dry-run           : ${dryRun}`);
  console.log(`  trial delay       : ${delay.delayMs}ms concurrency=${delay.concurrency}`);
  console.log(`  pre-exec estimate : ${preExecutionTimeEstimate.expectedRequests} req / ${preExecutionTimeEstimate.expectedHours} h`);

  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('Missing NBA_DATA_BUCKET');
  const s3 = new S3Storage({ bucket });
  const pgBefore = await snapshotPostgres();
  if (!serving2023Empty(pgBefore)) {
    throw new Error(
      `2023 serving not empty before archive: games=${pgBefore.games_2023} logs=${pgBefore.logs_2023} tgs=${pgBefore.tgs_2023}`
    );
  }
  if (!isolation2024Ok(pgBefore)) {
    throw new Error(
      `2024 serving unexpected before archive: games=${pgBefore.games_2024} logs=${pgBefore.logs_2024} tgs=${pgBefore.tgs_2024} inferred=${pgBefore.inferred_2024}`
    );
  }
  if (!isolation2025Ok(pgBefore) || !isolation2026Ok(pgBefore)) {
    throw new Error(
      `2025/2026 isolation unexpected before archive: 2025 games=${pgBefore.games_2025} 2026 games=${pgBefore.games_2026} stints=${pgBefore.stints_2026}`
    );
  }
  if (pgBefore.rawPgs !== EXPECTED.rawPgs || pgBefore.rawPgsSeason2025 !== EXPECTED.rawPgs) {
    throw new Error(`raw.player_game_stats unexpected total=${pgBefore.rawPgs} season2025=${pgBefore.rawPgsSeason2025}`);
  }

  const s3Before = {
    bucketTotal: await sumPrefix(s3, ''),
    season2023: await sumPrefix(s3, 'raw/source=balldontlie/league=nba/season=2023/'),
    season2024: await sumPrefix(s3, 'raw/source=balldontlie/league=nba/season=2024/'),
    games: await sumPrefix(s3, `${plan.s3GamesPrefix}/`),
    playerStats: await sumPrefix(s3, `${plan.s3StatsPrefix}/`),
  };

  if (dryRun || !execute) {
    console.log('[dry-run] safety GREEN. No provider requests. No S3 writes. No Postgres writes.');
    const payload = {
      generatedAt,
      step: '4A',
      dryRun: true,
      safety,
      preExecutionTimeEstimate,
      plan: {
        s3GamesPrefix: plan.s3GamesPrefix,
        s3StatsPrefix: plan.s3StatsPrefix,
        stagingMode: plan.stagingMode,
      },
      s3Before,
      postgresBefore: pgBefore,
      isolation2024: isolation2024Ok(pgBefore),
      isolation2025: isolation2025Ok(pgBefore),
      isolation2026: isolation2026Ok(pgBefore),
      note: 'Rerun with BDL_TRIAL_MODE=1 --execute to archive. Do not materialize 2023.',
    };
    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + '\n');
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  assertTrialExecuteAllowed();
  const lock = acquireBdlAcquisitionLock();
  console.log(`  lock              : acquired ${lock.path}`);
  const wallStart = Date.now();
  let archiveResult: Awaited<ReturnType<typeof runBackfillBalldontlieSeason>> | null = null;
  try {
    archiveResult = await runBackfillBalldontlieSeason(
      ['--season=2023', '--entities=games,player_stats', '--request-delay-ms=13000'],
      { skipLock: true }
    );
  } finally {
    lock.release();
    console.log('  lock              : released');
  }
  const wallMs = Date.now() - wallStart;

  const validation = await validateArchive(s3, plan);
  const pgAfter = await snapshotPostgres();
  const s3After = {
    bucketTotal: await sumPrefix(s3, ''),
    season2023: await sumPrefix(s3, 'raw/source=balldontlie/league=nba/season=2023/'),
    season2024: await sumPrefix(s3, 'raw/source=balldontlie/league=nba/season=2024/'),
    games: await sumPrefix(s3, `${plan.s3GamesPrefix}/`),
    playerStats: await sumPrefix(s3, `${plan.s3StatsPrefix}/`),
  };

  const postgresUnchanged =
    serving2023Empty(pgAfter) &&
    isolation2024Ok(pgAfter) &&
    isolation2025Ok(pgAfter) &&
    isolation2026Ok(pgAfter) &&
    pgAfter.rawPgs === pgBefore.rawPgs &&
    pgAfter.rawPgsSeason2025 === pgBefore.rawPgsSeason2025 &&
    pgAfter.tgs_2026 === 0;

  const gamesOk =
    validation.gate.ok &&
    validation.games.sequenceIssues.length === 0 &&
    validation.games.cursorCompletedNaturally &&
    validation.games.duplicateProviderGameIds.length === 0 &&
    validation.games.uniqueGameIds === validation.games.total;
  const statsOk =
    validation.stats.sequenceIssues.length === 0 &&
    validation.stats.cursorCompletedNaturally &&
    validation.stats.duplicateProviderStatIds === 0 &&
    validation.stats.unknownNonSeasonGameIds.length === 0 &&
    validation.stats.missingPlayerId === 0 &&
    validation.stats.missingTeamId === 0 &&
    validation.stats.missingGameId === 0;
  const coverageGaps =
    validation.coverage.finalsWithZeroPlayerStats.length > 0 ||
    validation.coverage.statsReferencingUnknownGames.length > 0 ||
    validation.coverage.oneTeamOnlyFinals.length > 0;
  const archiveFailed = archiveResult?.exitCode !== 0 || !validation.gate.ok;

  let verdict:
    | 'GREEN — 2023 S3 archive complete; proceed to materialization preflight'
    | 'YELLOW — archive complete but review gaps'
    | 'RED — stop 2023 progression';
  if (archiveFailed || !postgresUnchanged || !gamesOk) {
    verdict = 'RED — stop 2023 progression';
  } else if (
    !statsOk ||
    coverageGaps ||
    validation.stats.logicalPlayerGameDuplicates > 0 ||
    validation.scoreReconciliation.mismatches > 0
  ) {
    verdict = 'YELLOW — archive complete but review gaps';
  } else {
    verdict = 'GREEN — 2023 S3 archive complete; proceed to materialization preflight';
  }

  const metrics = archiveResult?.metrics;
  const spacing = metrics?.spacingSamplesMs ?? [];
  const addedBytes = s3After.season2023.bytes - s3Before.season2023.bytes;
  const addedMb = mb(addedBytes);
  const vs2024 = compareArchiveSize(addedMb);
  const apiHours = Math.round((wallMs / 3_600_000) * 100) / 100;
  const avgSpacingMs = avg(spacing);

  const report = {
    generatedAt,
    step: '4A',
    dryRun: false,
    safety: { ...safety, lockAcquiredDuringExecute: true },
    stagingMode: plan.stagingMode,
    preExecutionTimeEstimate,
    gamesAcquisition: {
      status: archiveResult?.summaries.find((s) => s.entity === 'games') ?? null,
      totalGames: validation.games.total,
      uniqueGameIds: validation.games.uniqueGameIds,
      finalGames: validation.games.finals,
      postseasonGames: validation.games.postseason,
      pages: validation.games.pageKeys,
      manifestCount: validation.games.manifest?.recordCount ?? null,
      manifestStatus: validation.games.manifest?.status ?? null,
      retries: metrics?.retries ?? null,
      status429: metrics?.status429 ?? null,
      cursorExhausted: validation.games.cursorCompletedNaturally,
    },
    statsAcquisition: {
      status: archiveResult?.summaries.find((s) => s.entity === 'player_stats') ?? null,
      httpRequests: metrics?.httpAttempts ?? null,
      httpSuccess: metrics?.httpSuccess ?? null,
      pages: validation.stats.pageKeys,
      playerStatRecords: validation.stats.records,
      distinctGameIds: validation.stats.distinctGameIds,
      distinctPlayers: validation.stats.distinctPlayers,
      firstGameDate: validation.stats.firstDate,
      lastGameDate: validation.stats.lastDate,
      status429: metrics?.status429 ?? null,
      retries: metrics?.retries ?? null,
      retryAfterUsed: metrics?.retryAfterUsed ?? null,
      cursorExhausted: validation.stats.cursorCompletedNaturally,
    },
    completeness: validation.coverage,
    scoreReconciliation: validation.scoreReconciliation,
    rateLimiting: {
      delayMs: archiveResult?.delayMs ?? delay.delayMs,
      trialMode: archiveResult?.trialMode ?? delay.trialMode,
      concurrency: archiveResult?.concurrency ?? delay.concurrency,
      status429: metrics?.status429 ?? 0,
      retries: metrics?.retries ?? 0,
      retryAfterUsed: metrics?.retryAfterUsed ?? 0,
      httpAttempts: metrics?.httpAttempts ?? 0,
      avgSpacingMs,
      minSpacingMs: spacing.length ? Math.min(...spacing) : null,
      maxSpacingMs: spacing.length ? Math.max(...spacing) : null,
      wallClockMs: wallMs,
      wallClockHours: apiHours,
    },
    manifestStatus: {
      games: validation.games,
      playerStats: {
        ...validation.stats,
        logicalPlayerGameDuplicateSample: validation.stats.logicalPlayerGameDuplicateSample,
      },
      archiveGate: validation.gate,
    },
    structuralAnomalies: {
      duplicateGameIds: validation.games.duplicateProviderGameIds,
      duplicateStatIds: validation.stats.duplicateProviderStatIds,
      missingPlayerId: validation.stats.missingPlayerId,
      missingTeamId: validation.stats.missingTeamId,
      missingGameId: validation.stats.missingGameId,
      logicalPlayerGameDuplicates: validation.stats.logicalPlayerGameDuplicates,
      oneTeamOnlyFinals: validation.coverage.oneTeamOnlyFinals,
      unknownGameIds: validation.coverage.statsReferencingUnknownGames,
      finalsWithZeroPlayerStats: validation.coverage.finalsWithZeroPlayerStats,
    },
    s3Growth: {
      before: s3Before,
      after: s3After,
      gamesBytes: s3After.games.bytes,
      playerStatsBytes: s3After.playerStats.bytes,
      totalAddedBytes: addedBytes,
      totalAddedMb: addedMb,
      objectCountAdded: s3After.season2023.objects - s3Before.season2023.objects,
      comparedTo2024Mb: ARCHIVE_2024_MB,
      vs2024,
      season2024PrefixUnchanged: s3After.season2024.bytes === s3Before.season2024.bytes,
    },
    postgresUnchanged: {
      ok: postgresUnchanged,
      before: pgBefore,
      after: pgAfter,
      dbBytesDelta: pgAfter.dbBytes - pgBefore.dbBytes,
    },
    isolation2024: {
      ok: isolation2024Ok(pgAfter),
      games: pgAfter.games_2024,
      logs: pgAfter.logs_2024,
      teamStats: pgAfter.tgs_2024,
      playerAverages: pgAfter.psa_2024,
      teamAverages: pgAfter.tsa_2024,
      inferredStints: pgAfter.inferred_2024,
    },
    isolation2025: {
      ok: isolation2025Ok(pgAfter),
      games: pgAfter.games_2025,
      completeAuthoritativeFinals: 1322,
      logs: pgAfter.logs_2025,
      teamStats: pgAfter.tgs_2025,
      box18447793: pgAfter.box184,
    },
    isolation2026: {
      ok: isolation2026Ok(pgAfter),
      games: pgAfter.games_2026,
      logs: pgAfter.logs_2026,
      teamStats: pgAfter.tgs_2026,
      stints: pgAfter.stints_2026,
    },
    actualRequestCount: metrics?.httpAttempts ?? 0,
    actualAcquisitionTime: {
      wallClockMs: wallMs,
      wallClockHours: apiHours,
      comparedTo2024: { attempts: BASELINE_2024_ATTEMPTS, hours: BASELINE_2024_HOURS },
    },
    updatedTrialTimeBudget: remainingTimeBudget({
      attempts: metrics?.httpAttempts ?? 0,
      hours: apiHours,
      avgMs: avgSpacingMs,
    }),
    verdict,
  };

  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');
  const md = [
    '# 2023 S3 archive report (Step 4A)',
    '',
    `Generated: ${generatedAt}`,
    '',
    `**${verdict}**`,
    '',
    `- stagingMode: ${plan.stagingMode}`,
    `- games: ${validation.games.total} (Final ${validation.games.finals}, postseason ${validation.games.postseason})`,
    `- stats records: ${validation.stats.records}`,
    `- HTTP attempts: ${metrics?.httpAttempts ?? 0}; 429s: ${metrics?.status429 ?? 0}; retries: ${metrics?.retries ?? 0}`,
    `- wall-clock: ${apiHours} h (2024 was ${BASELINE_2024_HOURS} h / ${BASELINE_2024_ATTEMPTS} attempts)`,
    `- S3 added: ${addedMb} MB vs 2024 ${ARCHIVE_2024_MB} MB (${vs2024})`,
    `- score recon: ${validation.scoreReconciliation.matches}/${validation.scoreReconciliation.finals}`,
    `- Postgres 2023 serving still empty: ${serving2023Empty(pgAfter)}`,
    `- 2024 isolation: ${isolation2024Ok(pgAfter)}`,
    '',
  ].join('\n');
  writeFileSync(OUT_MD, md);
  console.log(
    JSON.stringify(
      {
        verdict,
        outJson: OUT_JSON,
        games: report.gamesAcquisition,
        stats: report.statsAcquisition,
        scoreReconciliation: validation.scoreReconciliation,
        rateLimiting: report.rateLimiting,
        s3Growth: { totalAddedMb: addedMb, vs2024 },
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
