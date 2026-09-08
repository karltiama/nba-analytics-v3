/**
 * Executable historical Option B orchestrator (library).
 * Dry-run never calls paid endpoints and never writes Postgres.
 */

import { spawn } from 'node:child_process';
import {
  BdlArchiveClient,
  readBdlApiKey,
  type BdlEnvelope,
} from '@/lib/balldontlie/archive-client';
import { acquireBdlAcquisitionLock } from '@/lib/balldontlie/acquisition-lock';
import { assertTrialExecuteAllowed, resolveBdlRequestDelayMs } from '@/lib/balldontlie/trial-limiter';
import {
  assertCompleteHistoricalArchive,
  canMaterializeAnalytics,
  providerAccessBlocksBackfill,
  type BdlEntityManifest,
  type ProviderAccessProbe,
} from './archive-gate';
import { transformBdlArchiveToServing, type BdlGame, type BdlStat, type TeamCatalogRow } from './bdl-to-serving';
import { buildServingBackfillPlan, parseHistoricalServingArgs, type HistoricalServingCliArgs } from './plan';
import { historicalSeasonWindow } from './season-window';
import { LOAD_EXISTING_GAMES_SQL, LOAD_TEAM_CATALOG_SQL } from './season-scoped-writes';
import { assertHistoricalServingSeason } from './supported-seasons';

export type OrchestratorLog = (msg: string) => void;

async function probeAccess(season: number): Promise<ProviderAccessProbe> {
  const delay = resolveBdlRequestDelayMs();
  const client = new BdlArchiveClient({
    apiKey: readBdlApiKey(),
    requestDelayMs: delay.delayMs,
    maxRetries: 0,
    retryBaseDelayMs: 1000,
  });
  const probeOne = async (path: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const it = client.paginate({
        path,
        params: { 'seasons[]': String(season) },
        paginationStyle: 'cursor',
        perPage: 1,
      })[Symbol.asyncIterator]();
      const first = await it.next();
      if (first.done || !first.value) return { ok: false, error: 'empty page' };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };
  const games = await probeOne('/games');
  const stats = await probeOne('/stats');
  return {
    gamesOk: games.ok,
    statsOk: stats.ok,
    gamesError: games.error,
    statsError: stats.error,
  };
}

function spawnArchive(season: number, overwrite: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      'tsx',
      'scripts/archive/backfill-balldontlie-season.ts',
      `--season=${season}`,
      '--entities=games,player_stats',
    ];
    if (overwrite) args.push('--overwrite');
    const child = spawn('npx', args, {
      stdio: 'inherit',
      env: process.env,
      shell: true,
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`archive backfill exited ${code}`));
    });
    child.on('error', reject);
  });
}

function spawnCheckpoint(label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      ['tsx', 'scripts/ops/storage-checkpoint.ts', `--label=${label}`, `--out=reports/storage/${label}.json`],
      { stdio: 'inherit', env: process.env, shell: true }
    );
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`storage checkpoint exited ${code}`));
    });
    child.on('error', reject);
  });
}

type S3Like = {
  listByPrefix: (prefix: string) => AsyncIterable<{ key: string }>;
  getJson: <T>(key: string) => Promise<T | null>;
};

async function listPageKeys(s3: S3Like, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  for await (const obj of s3.listByPrefix(`${prefix}/`)) {
    const key = obj.key;
    if (/\/page=\d+\.json$/.test(key)) keys.push(key);
  }
  keys.sort();
  return keys;
}

async function loadEnvelopePages(s3: S3Like, keys: string[]): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (const key of keys) {
    const env = await s3.getJson<BdlEnvelope>(key);
    if (env && Array.isArray(env.data)) rows.push(...env.data);
  }
  return rows;
}

export async function runHistoricalServingBackfill(
  argv: string[],
  log: OrchestratorLog = console.log
): Promise<{ exitCode: number; dryRun: boolean; season: number }> {
  const args: HistoricalServingCliArgs = parseHistoricalServingArgs(argv);
  assertHistoricalServingSeason(args.season);
  const window = historicalSeasonWindow(args.season);
  const delay = resolveBdlRequestDelayMs();
  const dryRun = args.dryRun || !args.execute;

  log('=== WP7.2 compact historical serving backfill ===');
  log(`  season stored : ${window.storedSeason} (${window.label})`);
  log(`  serving dates : ${window.servingMinDate} .. ${window.servingMaxDate}`);
  log(`  dry-run       : ${dryRun}`);
  log(`  stagingMode   : none (Option B — no raw.player_game_stats writes)`);
  log(`  trial limiter : ${delay.trialMode ? 'ON' : 'off'} delayMs=${delay.delayMs} concurrency=${delay.concurrency}`);

  const plan = buildServingBackfillPlan({
    season: args.season,
    rawPrefix: process.env.NBA_RAW_PREFIX,
    blockedReason: null,
  });
  log(`  s3 games      : ${plan.s3GamesPrefix}`);
  log(`  s3 stats      : ${plan.s3StatsPrefix}`);
  log(`  skip-probe    : ${args.skipProbe}`);
  log(`  skip-archive  : ${args.skipArchive}`);
  log('  steps:');
  for (const step of plan.steps) log(`    - ${step}`);

  if (dryRun) {
    log('\n[dry-run] skip provider probe (no /games, no /stats, no paid endpoints).');
    log('[dry-run] skip S3 archive, skip Postgres writes, skip storage checkpoint.');
    log('[dry-run] execution path is wired; rerun without --dry-run and with --execute + BDL_TRIAL_MODE=1 after GOAT is authorized.');
    return { exitCode: 0, dryRun: true, season: args.season };
  }

  const needsProvider = !args.skipArchive || !args.skipProbe;
  if (needsProvider) assertTrialExecuteAllowed();
  const lock = needsProvider ? acquireBdlAcquisitionLock() : null;
  try {
    let blockedReason: string | null = null;
    if (!args.skipProbe) {
      try {
        const probe = await probeAccess(args.season);
        log(`  BDL /games    : ${probe.gamesOk ? 'ok' : probe.gamesError}`);
        log(`  BDL /stats    : ${probe.statsOk ? 'ok' : probe.statsError}`);
        blockedReason = providerAccessBlocksBackfill(probe);
      } catch (e) {
        blockedReason = e instanceof Error ? e.message : String(e);
      }
    }

    if (blockedReason) {
      log(`[blocked] ${blockedReason}`);
      log('[blocked] Architecture is in place. No S3 archive and no Postgres writes were performed.');
      return { exitCode: 2, dryRun: false, season: args.season };
    }

    const { S3Storage } = await import('@/lib/aws/s3');
    const pool = (await import('@/lib/db')).default;
    const { applyHistoricalServingToPostgres } = await import('./season-scoped-writes');
    const bucket = process.env.NBA_DATA_BUCKET?.trim();
    if (!bucket) throw new Error('Missing NBA_DATA_BUCKET');
    const s3 = new S3Storage({ bucket });

    if (args.skipArchive) {
      log('[archive] skipped — using existing S3 objects (no BDL HTTP)');
    } else {
      log('[archive] running season-scoped BDL → S3 backfill (games + player_stats)');
      await spawnArchive(args.season, args.overwrite);
    }

    const gamesManifest = await s3.getJson<BdlEntityManifest>(`${plan.s3GamesPrefix}/_manifest.json`);
    const statsManifest = await s3.getJson<BdlEntityManifest>(`${plan.s3StatsPrefix}/_manifest.json`);
    const gamesPageKeys = await listPageKeys(s3, plan.s3GamesPrefix);
    const statsPageKeys = await listPageKeys(s3, plan.s3StatsPrefix);
    const verification = assertCompleteHistoricalArchive({
      season: args.season,
      gamesManifest,
      statsManifest,
      gamesPageKeys,
      statsPageKeys,
    });
    if (!canMaterializeAnalytics(verification)) {
      log(`[blocked] archive incomplete: ${verification.reason}`);
      return { exitCode: 2, dryRun: false, season: args.season };
    }

    const games = (await loadEnvelopePages(s3, gamesPageKeys)) as BdlGame[];
    const stats = (await loadEnvelopePages(s3, statsPageKeys)) as BdlStat[];

    const client = await pool.connect();
    try {
      await client.query('begin');
      const teams = await client.query<TeamCatalogRow>(LOAD_TEAM_CATALOG_SQL);
      const ids = [...new Set(games.map((g) => String(g.id ?? '')).filter(Boolean))];
      const existing = ids.length
        ? await client.query<{ game_id: string; season: string | null }>(LOAD_EXISTING_GAMES_SQL, [ids])
        : { rows: [] as { game_id: string; season: string | null }[] };
      const report = transformBdlArchiveToServing({
        seasonStartYear: args.season,
        games,
        stats,
        teamCatalog: teams.rows,
        existingGames: existing.rows,
      });
      if (report.stats.crossSeasonConflicts > 0) {
        throw new Error(`Cross-season game conflicts: ${report.stats.crossSeasonConflicts}`);
      }
      const wrote = await applyHistoricalServingToPostgres(client, report);
      await client.query('commit');
      log(
        `[wrote] season=${report.season} games=${report.games.length} logs=${report.logs.length} ` +
          `players=${report.players.length} inferredStints=${wrote.inferredStints} stagingMode=none`
      );
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }

    await spawnCheckpoint(`after-${args.season}`);
    return { exitCode: 0, dryRun: false, season: args.season };
  } finally {
    lock?.release();
  }
}
