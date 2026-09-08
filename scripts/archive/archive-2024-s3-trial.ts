/**
 * Step 3A: BDL season 2024 → S3 raw archive only.
 * Does not materialize Postgres. Does not start 2023. Does not fetch advanced/props/odds/lineups.
 *
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/archive-2024-s3-trial.ts --dry-run
 *   BDL_TRIAL_MODE=1 npx tsx scripts/archive/archive-2024-s3-trial.ts --execute
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

const SEASON = 2024;
const OUT_JSON = 'reports/trial/2024-s3-archive-report.json';
const OUT_MD = 'reports/trial/2024-s3-archive-report.md';
const BOX_ID = '18447793';

type PgSnap = {
  dbBytes: number;
  games_2024: number;
  logs_2024: number;
  tgs_2024: number;
  psa_2024: number;
  tsa_2024: number;
  stints_2024: number;
  rawPgs: number;
  rawPgsSeason2024: number;
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

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
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
         (select count(*)::int from analytics.games where season = '2024') as games_2024,
         (select count(*)::int from analytics.player_game_logs where season = '2024') as logs_2024,
         (select count(*)::int from analytics.team_game_stats where season = '2024') as tgs_2024,
         (select count(*)::int from analytics.player_season_averages where season = '2024') as psa_2024,
         (select count(*)::int from analytics.team_season_averages where season = '2024') as tsa_2024,
         (select count(*)::int from analytics.player_team_stints where season = '2024') as stints_2024,
         (select count(*)::int from raw.player_game_stats) as raw_pgs,
         (select count(*)::int
            from raw.player_game_stats s
            join analytics.games g on g.game_id = s.game_id::text
           where g.season = '2024') as raw_pgs_season_2024,
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
      games_2024: Number(row.games_2024),
      logs_2024: Number(row.logs_2024),
      tgs_2024: Number(row.tgs_2024),
      psa_2024: Number(row.psa_2024),
      tsa_2024: Number(row.tsa_2024),
      stints_2024: Number(row.stints_2024),
      rawPgs: Number(row.raw_pgs),
      rawPgsSeason2024: Number(row.raw_pgs_season_2024),
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
      }
      const d = dateOnly(game?.date) ?? dateOnly(game?.datetime);
      if (d) stats.dates.push(d);
    }
  }
  stats.dates.sort();
  const logicalDup = [...stats.playerGameCounts.entries()].filter(([, n]) => n > 1);
  const finalsWithZeroStats: string[] = [];
  const oneTeamOnly: string[] = [];
  for (const g of finals) {
    const n = stats.teamIdsByGame.get(g.id);
    if (!n || n.size === 0) finalsWithZeroStats.push(g.id);
    else if (g.homeId && g.awayId && (!n.has(g.homeId) || !n.has(g.awayId))) oneTeamOnly.push(g.id);
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
  };
}

async function main() {
  const { dryRun, execute } = parseExecuteFlag(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const mode = readIngestionMode();
  const pin = getAnalyticsSeason();
  const delay = resolveBdlRequestDelayMs();
  const lockIdle = bdlAcquisitionLockStatus();
  const plan = buildServingBackfillPlan({ season: SEASON, rawPrefix: process.env.NBA_RAW_PREFIX, blockedReason: null });

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
    season2023NotStarted: true,
  };

  if (unsafe.length) {
    const stopped = {
      generatedAt,
      step: '3A',
      stopped: true,
      reason: 'safety preflight failed',
      unsafe,
      safety,
      verdict: 'RED — stop 2024 backfill',
    };
    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(stopped, null, 2) + '\n');
    console.log(JSON.stringify(stopped, null, 2));
    process.exit(2);
  }

  console.log('=== Step 3A 2024 S3 archive (games + player_stats) ===');
  console.log(`  stagingMode       : ${plan.stagingMode}`);
  console.log(`  dry-run           : ${dryRun}`);
  console.log(`  trial delay       : ${delay.delayMs}ms concurrency=${delay.concurrency}`);

  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('Missing NBA_DATA_BUCKET');
  const s3 = new S3Storage({ bucket });
  const pgBefore = await snapshotPostgres();
  if (pgBefore.games_2026 !== 1200 || pgBefore.stints_2026 !== 578) {
    throw new Error(`2026 isolation unexpected before archive: games=${pgBefore.games_2026} stints=${pgBefore.stints_2026}`);
  }

  const s3Before = {
    bucketTotal: await sumPrefix(s3, ''),
    season2024: await sumPrefix(s3, 'raw/source=balldontlie/league=nba/season=2024/'),
    games: await sumPrefix(s3, `${plan.s3GamesPrefix}/`),
    playerStats: await sumPrefix(s3, `${plan.s3StatsPrefix}/`),
  };

  if (dryRun || !execute) {
    console.log('[dry-run] safety GREEN. No provider requests. No S3 writes. No Postgres writes.');
    console.log(
      JSON.stringify(
        {
          safety,
          plan: {
            s3GamesPrefix: plan.s3GamesPrefix,
            s3StatsPrefix: plan.s3StatsPrefix,
            stagingMode: plan.stagingMode,
          },
          s3Before,
          postgresBefore: pgBefore,
        },
        null,
        2
      )
    );
    return;
  }

  assertTrialExecuteAllowed();
  const lock = acquireBdlAcquisitionLock();
  console.log(`  lock              : acquired ${lock.path}`);
  let archiveResult: Awaited<ReturnType<typeof runBackfillBalldontlieSeason>> | null = null;
  try {
    archiveResult = await runBackfillBalldontlieSeason(
      ['--season=2024', '--entities=games,player_stats', '--request-delay-ms=13000'],
      { skipLock: true }
    );
  } finally {
    lock.release();
    console.log('  lock              : released');
  }

  const validation = await validateArchive(s3, plan);
  const pgAfter = await snapshotPostgres();
  const s3After = {
    bucketTotal: await sumPrefix(s3, ''),
    season2024: await sumPrefix(s3, 'raw/source=balldontlie/league=nba/season=2024/'),
    games: await sumPrefix(s3, `${plan.s3GamesPrefix}/`),
    playerStats: await sumPrefix(s3, `${plan.s3StatsPrefix}/`),
  };

  const postgresUnchanged =
    pgAfter.games_2024 === 0 &&
    pgAfter.logs_2024 === 0 &&
    pgAfter.tgs_2024 === 0 &&
    pgAfter.psa_2024 === 0 &&
    pgAfter.tsa_2024 === 0 &&
    pgAfter.stints_2024 === 0 &&
    pgAfter.rawPgsSeason2024 === 0 &&
    pgAfter.rawPgs === pgBefore.rawPgs &&
    pgAfter.logs_2025 === pgBefore.logs_2025 &&
    pgAfter.tgs_2025 === pgBefore.tgs_2025 &&
    pgAfter.games_2025 === pgBefore.games_2025 &&
    pgAfter.games_2026 === 1200 &&
    pgAfter.stints_2026 === 578 &&
    pgAfter.box184?.home === 109 &&
    pgAfter.box184?.away === 118;

  const dbBytesDelta = pgAfter.dbBytes - pgBefore.dbBytes;
  const isolation2025 =
    pgAfter.games_2025 === 1323 &&
    pgAfter.logs_2025 === pgBefore.logs_2025 &&
    pgAfter.tgs_2025 === pgBefore.tgs_2025 &&
    pgAfter.box184?.home === 109 &&
    pgAfter.box184?.away === 118;

  const gamesOk =
    validation.gate.ok &&
    validation.games.sequenceIssues.length === 0 &&
    validation.games.cursorCompletedNaturally &&
    validation.games.duplicateProviderGameIds.length === 0;
  const statsOk =
    validation.stats.sequenceIssues.length === 0 &&
    validation.stats.cursorCompletedNaturally &&
    validation.stats.duplicateProviderStatIds === 0 &&
    validation.stats.unknownNonSeasonGameIds.length === 0;
  const coverageGaps =
    validation.coverage.finalsWithZeroPlayerStats.length > 0 ||
    validation.coverage.statsReferencingUnknownGames.length > 0 ||
    validation.coverage.oneTeamOnlyFinals.length > 0;
  const archiveFailed = archiveResult?.exitCode !== 0 || !validation.gate.ok;

  let verdict: string;
  if (archiveFailed || !postgresUnchanged || !gamesOk) {
    verdict = 'RED — stop 2024 backfill';
  } else if (!statsOk || coverageGaps || validation.stats.logicalPlayerGameDuplicates > 0) {
    verdict = 'YELLOW — archive acquired but review gaps before materialization';
  } else {
    verdict = 'GREEN — 2024 S3 archive complete; proceed to read-only materialization preflight';
  }

  const metrics = archiveResult?.metrics;
  const spacing = metrics?.spacingSamplesMs ?? [];
  const report = {
    generatedAt,
    step: '3A',
    dryRun: false,
    safety: { ...safety, lockAcquiredDuringExecute: true },
    stagingMode: plan.stagingMode,
    gamesAcquisition: {
      status: archiveResult?.summaries.find((s) => s.entity === 'games') ?? null,
      totalGames: validation.games.total,
      finalGames: validation.games.finals,
      postseasonGames: validation.games.postseason,
      pages: validation.games.pageKeys,
      manifestCount: validation.games.manifest?.recordCount ?? null,
      manifestStatus: validation.games.manifest?.status ?? null,
      retries: metrics?.retries ?? null,
      status429: metrics?.status429 ?? null,
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
    },
    rateLimiting: {
      delayMs: archiveResult?.delayMs ?? delay.delayMs,
      trialMode: archiveResult?.trialMode ?? delay.trialMode,
      concurrency: archiveResult?.concurrency ?? delay.concurrency,
      status429: metrics?.status429 ?? 0,
      retries: metrics?.retries ?? 0,
      retryAfterUsed: metrics?.retryAfterUsed ?? 0,
      httpAttempts: metrics?.httpAttempts ?? 0,
      avgSpacingMs: avg(spacing),
      minSpacingMs: spacing.length ? Math.min(...spacing) : null,
      maxSpacingMs: spacing.length ? Math.max(...spacing) : null,
    },
    manifestStatus: {
      games: validation.games,
      playerStats: {
        ...validation.stats,
        logicalPlayerGameDuplicateSample: validation.stats.logicalPlayerGameDuplicateSample,
      },
      archiveGate: validation.gate,
    },
    coverage: validation.coverage,
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
      totalAddedBytes: s3After.season2024.bytes - s3Before.season2024.bytes,
      objectCountAdded: s3After.season2024.objects - s3Before.season2024.objects,
      season2024After: s3After.season2024,
    },
    postgresUnchanged: {
      ok: postgresUnchanged,
      before: pgBefore,
      after: pgAfter,
      dbBytesDelta,
      dbBytesDeltaNote:
        dbBytesDelta === 0
          ? 'exact match'
          : 'catalog/page-size drift only expected; serving row counts must stay 0 for 2024',
    },
    isolation: {
      games2025: pgAfter.games_2025,
      logs2025: pgAfter.logs_2025,
      tgs2025: pgAfter.tgs_2025,
      box18447793: pgAfter.box184,
      games2026: pgAfter.games_2026,
      stints2026: pgAfter.stints_2026,
      logs2026: pgAfter.logs_2026,
      expected2025CompleteGames: 1322,
      localOnlyExtraGame: pgAfter.games_2025 === 1323,
      isolation2025ok: isolation2025,
    },
    verdict,
  };

  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');
  const md = [
    '# 2024 S3 archive report (Step 3A)',
    '',
    `Generated: ${generatedAt}`,
    '',
    `**${verdict}**`,
    '',
    `- stagingMode: ${plan.stagingMode}`,
    `- games: ${validation.games.total} (Final ${validation.games.finals}, postseason ${validation.games.postseason})`,
    `- stats records: ${validation.stats.records}`,
    `- HTTP attempts: ${metrics?.httpAttempts ?? 0}; 429s: ${metrics?.status429 ?? 0}; retries: ${metrics?.retries ?? 0}`,
    `- S3 added bytes: ${s3After.season2024.bytes - s3Before.season2024.bytes}`,
    `- Postgres 2024 serving rows: games=${pgAfter.games_2024} logs=${pgAfter.logs_2024} tgs=${pgAfter.tgs_2024}`,
    `- 18447793: ${pgAfter.box184?.home}-${pgAfter.box184?.away}`,
    `- Finals with zero stats: ${validation.coverage.finalsWithZeroPlayerStats.length}`,
    '',
  ].join('\n');
  writeFileSync(OUT_MD, md);
  console.log(JSON.stringify({ verdict, outJson: OUT_JSON, coverage: validation.coverage, rateLimiting: report.rateLimiting }, null, 2));
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
