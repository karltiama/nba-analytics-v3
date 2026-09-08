/**
 * Step 3C: validated 2024 S3 archive → compact analytics serving.
 * Option B only (transformBdlArchiveToServing, stagingMode=none).
 * No BALLDONTLIE HTTP. No 2023. No advanced/props/odds/lineups.
 *
 *   npx tsx scripts/ingestion/materialize-2024-from-s3.ts --dry-run
 *   npx tsx scripts/ingestion/materialize-2024-from-s3.ts --execute --i-understand-production-write
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { S3Storage } from '@/lib/aws/s3';
import { bdlAcquisitionLockStatus } from '@/lib/balldontlie/acquisition-lock';
import { assertCompleteHistoricalArchive, type BdlEntityManifest } from '@/lib/ingestion/historical-serving/archive-gate';
import { runHistoricalServingBackfill } from '@/lib/ingestion/historical-serving/orchestrate';
import { buildServingBackfillPlan } from '@/lib/ingestion/historical-serving/plan';
import { historicalSeasonWindow } from '@/lib/ingestion/historical-serving/season-window';
import pool from '@/lib/db';
import {
  AFTER_2024_MAX_DB_MB,
  AFTER_2024_MAX_DELTA_MB,
  evaluateTrialStorageGate,
  GLOBAL_HARD_STOP_MB,
  type StorageCheckpointLike,
} from '@/lib/ops/trial-storage-gate';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

const SEASON = 2024;
const OUT_JSON = 'reports/trial/2024-materialization-report.json';
const OUT_MD = 'reports/trial/2024-materialization-report.md';
const PREV_CHECKPOINT = 'reports/storage/after-31game-materialize.json';
const CUR_CHECKPOINT = 'reports/storage/after-2024.json';
const BOX_ID = '18447793';
const LOCAL_ONLY_ID = '21681993';
const EXPECTED_DB_HOST = 'aws-1-us-east-2.pooler.supabase.com';
const ADVISORY_ABA = ['1028026974', '369', '38017698', '56677738', '666860'] as const;

const EXPECTED = {
  gamesPages: 14,
  gamesRecords: 1321,
  statsPages: 462,
  statsRecords: 46150,
  distinctStatGames: 1321,
  teamStats: 2642,
  playerAvgs: 587,
  teamAvgs: 30,
  inferredStints: 699,
  rawPgs: 46056,
  games2025: 1323,
  logs2025: 46056,
  tgs2025: 2644,
  inferred2025: 184,
  nbaStats2025: 514,
  games2026: 1200,
  logs2026: 0,
  tgs2026: 0,
  stints2026: 578,
  boxHome: 109,
  boxAway: 118,
};

type Verdict =
  | 'GREEN — 2024 materialized successfully; storage gate passes'
  | 'YELLOW — 2024 materialized, but storage result changes 2023 plan'
  | 'RED — stop historical materialization';

function mb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

function dbHostFromUrl(url: string): string {
  try {
    return new URL(url.replace(/^postgres(ql)?:/i, 'http:')).hostname;
  } catch {
    return '';
  }
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

function spawnGate(): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      [
        'tsx',
        'scripts/ops/trial-storage-gate.ts',
        `--previous=${PREV_CHECKPOINT}`,
        `--current=${CUR_CHECKPOINT}`,
        '--phase=after-2024',
      ],
      { env: process.env, shell: true }
    );
    let stdout = '';
    child.stdout?.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr?.on('data', (d) => {
      stdout += String(d);
    });
    child.on('exit', (code) => resolve({ ok: code === 0, stdout }));
    child.on('error', reject);
  });
}

async function snapshotIsolation(client: Awaited<ReturnType<typeof pool.connect>>) {
  const r = await client.query(
    `select
       pg_database_size(current_database())::bigint as db_bytes,
       current_database() as db_name,
       (select count(*)::int from analytics.games where season = '2024') as games_2024,
       (select count(distinct game_id)::int from analytics.games where season = '2024') as distinct_games_2024,
       (select count(*)::int from analytics.games where season = '2024' and season is distinct from '2024') as games_2024_wrong_season,
       (select count(*)::int from analytics.player_game_logs where season = '2024') as logs_2024,
       (select count(distinct game_id)::int from analytics.player_game_logs where season = '2024') as log_games_2024,
       (select count(*)::int from analytics.team_game_stats where season = '2024') as tgs_2024,
       (select count(distinct game_id)::int from analytics.team_game_stats where season = '2024') as tgs_games_2024,
       (select count(*)::int from analytics.player_season_averages where season = '2024') as psa_2024,
       (select count(*)::int from analytics.team_season_averages where season = '2024') as tsa_2024,
       (select count(*)::int from analytics.player_team_stints where season = '2024' and source = 'inferred_pgl') as inferred_2024,
       (select count(*)::int from analytics.player_team_stints where season = '2024' and source is distinct from 'inferred_pgl') as other_stints_2024,
       (select count(*)::int from analytics.games where season = '2023') as games_2023,
       (select count(*)::int from analytics.player_game_logs where season = '2023') as logs_2023,
       (select count(*)::int from analytics.team_game_stats where season = '2023') as tgs_2023,
       (select count(*)::int from analytics.player_season_averages where season = '2023') as psa_2023,
       (select count(*)::int from analytics.team_season_averages where season = '2023') as tsa_2023,
       (select count(*)::int from analytics.games where season = '2025') as games_2025,
       (select count(*)::int from analytics.player_game_logs where season = '2025') as logs_2025,
       (select count(*)::int from analytics.team_game_stats where season = '2025') as tgs_2025,
       (select count(*)::int from analytics.player_season_averages where season = '2025') as psa_2025,
       (select count(*)::int from analytics.team_season_averages where season = '2025') as tsa_2025,
       (select count(*)::int from analytics.player_team_stints where season = '2025' and source = 'inferred_pgl') as inferred_2025,
       (select count(*)::int from analytics.player_team_stints where season = '2025' and source = 'nba_stats') as nba_stats_2025,
       (select count(*)::int from analytics.games where season = '2026') as games_2026,
       (select count(*)::int from analytics.player_game_logs where season = '2026') as logs_2026,
       (select count(*)::int from analytics.team_game_stats where season = '2026') as tgs_2026,
       (select count(*)::int from analytics.player_season_averages where season = '2026') as psa_2026,
       (select count(*)::int from analytics.team_season_averages where season = '2026') as tsa_2026,
       (select count(*)::int from analytics.player_team_stints where season = '2026') as stints_2026,
       (select count(*)::int from raw.player_game_stats) as raw_pgs,
       (select count(*)::int
          from raw.player_game_stats s
          join analytics.games g on g.game_id = s.game_id::text
         where g.season = '2024') as raw_pgs_2024,
       (select count(*)::int
          from raw.player_game_stats s
          join analytics.games g on g.game_id = s.game_id::text
         where g.season = '2025') as raw_pgs_2025`
  );
  const box = await client.query(
    `select game_id, season, home_team_id, away_team_id, home_score, away_score
     from analytics.games where game_id = $1`,
    [BOX_ID]
  );
  const local = await client.query(
    `select g.game_id, g.season, g.home_score, g.away_score,
            (select count(*)::int from analytics.player_game_logs l where l.game_id = g.game_id) as logs
     from analytics.games g where g.game_id = $1`,
    [LOCAL_ONLY_ID]
  );
  const structural = await client.query(
    `select
       (select count(*)::int from (
          select game_id, player_id from analytics.player_game_logs where season = '2024'
          group by 1, 2 having count(*) > 1
        ) d) as dup_log_keys,
       (select count(*)::int from analytics.player_game_logs
         where season = '2024' and (game_id is null or player_id is null or team_id is null)) as null_core,
       (select count(*)::int from analytics.player_game_logs l
         join analytics.games g on g.game_id = l.game_id
        where l.season = '2024'
          and l.team_id is distinct from g.home_team_id
          and l.team_id is distinct from g.away_team_id) as foreign_team,
       (select count(*)::int from analytics.games g
         where g.season = '2024'
           and (select count(*) from analytics.team_game_stats t where t.game_id = g.game_id) is distinct from 2) as missing_finals,
       (select count(*)::int from analytics.games g
         where g.season = '2024' and exists (
           select 1 from analytics.player_game_logs l
           where l.game_id = g.game_id
             and not exists (
               select 1 from analytics.player_game_logs h
               where h.game_id = g.game_id and h.team_id = g.home_team_id
             )
         )) as missing_home_logs,
       (select count(*)::int from analytics.games g
         where g.season = '2024' and exists (
           select 1 from analytics.player_game_logs l
           where l.game_id = g.game_id
             and not exists (
               select 1 from analytics.player_game_logs a
               where a.game_id = g.game_id and a.team_id = g.away_team_id
             )
         )) as missing_away_logs`
  );
  const score = await client.query(
    `with summed as (
       select g.game_id,
              coalesce(sum(l.points) filter (where l.team_id = g.home_team_id), 0)::int as home_pts,
              coalesce(sum(l.points) filter (where l.team_id = g.away_team_id), 0)::int as away_pts,
              g.home_score, g.away_score
       from analytics.games g
       left join analytics.player_game_logs l on l.game_id = g.game_id
       where g.season = '2024'
       group by g.game_id, g.home_team_id, g.away_team_id, g.home_score, g.away_score
     )
     select count(*)::int as finals,
            count(*) filter (where home_pts = home_score and away_pts = away_score)::int as matches
     from summed`
  );
  const aba = await client.query(
    `select player_id, count(*)::int as stints
     from analytics.player_team_stints
     where season = '2024' and source = 'inferred_pgl' and player_id = any($1::text[])
     group by player_id`,
    [ADVISORY_ABA]
  );
  const n = (k: string) => Number(r.rows[0]![k]);
  return {
    dbBytes: Number(r.rows[0]!.db_bytes),
    dbName: String(r.rows[0]!.db_name),
    games_2024: n('games_2024'),
    distinct_games_2024: n('distinct_games_2024'),
    logs_2024: n('logs_2024'),
    log_games_2024: n('log_games_2024'),
    tgs_2024: n('tgs_2024'),
    tgs_games_2024: n('tgs_games_2024'),
    psa_2024: n('psa_2024'),
    tsa_2024: n('tsa_2024'),
    inferred_2024: n('inferred_2024'),
    other_stints_2024: n('other_stints_2024'),
    games_2023: n('games_2023'),
    logs_2023: n('logs_2023'),
    tgs_2023: n('tgs_2023'),
    psa_2023: n('psa_2023'),
    tsa_2023: n('tsa_2023'),
    games_2025: n('games_2025'),
    logs_2025: n('logs_2025'),
    tgs_2025: n('tgs_2025'),
    psa_2025: n('psa_2025'),
    tsa_2025: n('tsa_2025'),
    inferred_2025: n('inferred_2025'),
    nba_stats_2025: n('nba_stats_2025'),
    games_2026: n('games_2026'),
    logs_2026: n('logs_2026'),
    tgs_2026: n('tgs_2026'),
    psa_2026: n('psa_2026'),
    tsa_2026: n('tsa_2026'),
    stints_2026: n('stints_2026'),
    raw_pgs: n('raw_pgs'),
    raw_pgs_2024: n('raw_pgs_2024'),
    raw_pgs_2025: n('raw_pgs_2025'),
    box184: box.rows[0] ?? null,
    localOnly: local.rows[0] ?? null,
    structural: {
      dupLogKeys: Number(structural.rows[0]!.dup_log_keys),
      nullCore: Number(structural.rows[0]!.null_core),
      foreignTeam: Number(structural.rows[0]!.foreign_team),
      missingFinals: Number(structural.rows[0]!.missing_finals),
      missingHomeLogs: Number(structural.rows[0]!.missing_home_logs),
      missingAwayLogs: Number(structural.rows[0]!.missing_away_logs),
    },
    score: {
      finals: Number(score.rows[0]!.finals),
      matches: Number(score.rows[0]!.matches),
    },
    abaStints: Object.fromEntries(aba.rows.map((row) => [String(row.player_id), Number(row.stints)])),
  };
}

function writeStopped(payload: Record<string, unknown>, code: number): never {
  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + '\n');
  console.log(JSON.stringify(payload, null, 2));
  process.exit(code);
}

async function main() {
  const generatedAt = new Date().toISOString();
  const argv = process.argv.slice(2);
  const execute = argv.includes('--execute');
  const dryRun = argv.includes('--dry-run') || !execute;
  const confirm = argv.includes('--i-understand-production-write');
  const mode = readIngestionMode();
  const pin = getAnalyticsSeason();
  const lock = bdlAcquisitionLockStatus();
  const window = historicalSeasonWindow(SEASON);
  const plan = buildServingBackfillPlan({
    season: SEASON,
    rawPrefix: process.env.NBA_RAW_PREFIX,
    blockedReason: null,
  });
  const host = dbHostFromUrl(process.env.SUPABASE_DB_URL ?? '');
  const unsafe: string[] = [];

  if (mode.dataMode !== 'replay') unsafe.push(`DATA_MODE=${mode.dataMode || '(empty)'}`);
  if (!mode.offseason) unsafe.push('OFFSEASON_MODE not 1');
  if (!mode.cronDryRun) unsafe.push('CRON_DRY_RUN not 1');
  if (pin !== '2025') unsafe.push(`season pin=${pin}`);
  if (plan.stagingMode !== 'none') unsafe.push(`stagingMode=${plan.stagingMode}`);
  if (window.servingMinDate !== '2024-10-15' || window.servingMaxDate !== '2025-06-30') {
    unsafe.push(`season window ${window.servingMinDate}..${window.servingMaxDate}`);
  }
  if (host !== EXPECTED_DB_HOST) unsafe.push(`db host ${host || '(unparsed)'} != ${EXPECTED_DB_HOST}`);
  if (execute && !confirm) unsafe.push('missing --i-understand-production-write');
  if (process.env.BDL_TRIAL_MODE === '1') {
    // Allowed but unused; Step 3C must not fetch. Do not treat as unsafe.
  }

  const client = await pool.connect();
  let before;
  try {
    await client.query('begin read only');
    before = await snapshotIsolation(client);
    await client.query('commit');
  } finally {
    client.release();
  }

  if (before.games_2024 !== 0 || before.logs_2024 !== 0 || before.tgs_2024 !== 0) {
    unsafe.push(`2024 serving not empty games=${before.games_2024} logs=${before.logs_2024} tgs=${before.tgs_2024}`);
  }
  if (before.logs_2023 !== 0 || before.tgs_2023 !== 0) {
    unsafe.push(`2023 serving not empty logs=${before.logs_2023} tgs=${before.tgs_2023}`);
  }
  if (before.games_2026 !== EXPECTED.games2026 || before.logs_2026 !== 0 || before.stints_2026 !== EXPECTED.stints2026) {
    unsafe.push(`2026 isolation unexpected games=${before.games_2026} logs=${before.logs_2026} stints=${before.stints_2026}`);
  }
  if (before.games_2025 !== EXPECTED.games2025 || before.logs_2025 !== EXPECTED.logs2025 || before.tgs_2025 !== EXPECTED.tgs2025) {
    unsafe.push(`2025 isolation unexpected games=${before.games_2025} logs=${before.logs_2025} tgs=${before.tgs_2025}`);
  }
  if (before.raw_pgs_2024 !== 0) unsafe.push(`raw.player_game_stats already has ${before.raw_pgs_2024} season-2024 rows`);
  const box = before.box184 as { home_score?: number | null; away_score?: number | null } | null;
  if (!box || Number(box.home_score) !== EXPECTED.boxHome || Number(box.away_score) !== EXPECTED.boxAway) {
    unsafe.push(`18447793 scores unexpected ${JSON.stringify(box)}`);
  }

  const safety = {
    dataMode: mode.dataMode,
    offseasonMode: mode.offseason,
    cronDryRun: mode.cronDryRun,
    frozen: mode.dataMode === 'replay' && mode.offseason && mode.cronDryRun,
    currentAnalyticsSeason: pin,
    bdlHttpRequests: 0,
    lockRequired: false,
    lockActive: lock.active,
    stagingMode: plan.stagingMode,
    seasonWindow: { min: window.servingMinDate, max: window.servingMaxDate, storedSeason: window.storedSeason },
    dbHost: host,
    expectedDbHost: EXPECTED_DB_HOST,
    productionFrozen: true,
    postgresWrites: false,
    servingBefore: before,
  };

  if (unsafe.length) {
    writeStopped(
      {
        generatedAt,
        step: '3C',
        stopped: true,
        reason: 'safety preflight failed',
        unsafe,
        safety,
        verdict: 'RED — stop historical materialization',
      },
      2
    );
  }

  const bucket = process.env.NBA_DATA_BUCKET?.trim();
  if (!bucket) throw new Error('Missing NBA_DATA_BUCKET');
  const s3 = new S3Storage({ bucket });
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
  const gamesLoaded = {
    pages: gamesPageKeys.length,
    records: Number(gamesManifest?.recordCount ?? NaN),
    uniqueGameIds: Number(gamesManifest?.recordCount ?? NaN),
    manifestStatus: gamesManifest?.status ?? null,
  };
  const statsLoaded = {
    pages: statsPageKeys.length,
    records: Number(statsManifest?.recordCount ?? NaN),
    distinctGameIds: EXPECTED.distinctStatGames,
    manifestStatus: statsManifest?.status ?? null,
    distinctGameIdsNote: 'certified in Step 3A/3B; driver does not re-download 462 pages',
  };
  const archiveDiffers =
    !gate.ok ||
    gamesPageKeys.length !== EXPECTED.gamesPages ||
    gamesLoaded.records !== EXPECTED.gamesRecords ||
    statsPageKeys.length !== EXPECTED.statsPages ||
    statsLoaded.records !== EXPECTED.statsRecords ||
    gamesManifest?.status !== 'success' ||
    statsManifest?.status !== 'success';

  const sourceArchive = {
    prefix: `raw/source=balldontlie/league=nba/season=2024/...`,
    gamesPrefix: plan.s3GamesPrefix,
    statsPrefix: plan.s3StatsPrefix,
    stagingMode: plan.stagingMode,
    gate,
    games: gamesLoaded,
    playerStats: statsLoaded,
    matchesStep3A: !archiveDiffers,
    mapper: 'transformBdlArchiveToServing',
    skipArchive: true,
    skipProbe: true,
  };

  if (archiveDiffers) {
    writeStopped(
      {
        generatedAt,
        step: '3C',
        stopped: true,
        reason: 'S3 archive differs from Step 3A certification',
        sourceArchive,
        verdict: 'RED — stop historical materialization',
      },
      2
    );
  }

  if (dryRun) {
    const payload = {
      generatedAt,
      step: '3C',
      dryRun: true,
      postgresWrites: false,
      bdlHttpRequests: 0,
      safety,
      sourceArchive,
      note: 'Safety + archive GREEN. Rerun with --execute --i-understand-production-write to materialize.',
      verdictPendingExecute: true,
    };
    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify({ ...payload, dryRunHeld: true }, null, 2) + '\n');
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log('[3C] safety GREEN; applying Option B from existing S3 (no BDL HTTP)');
  const orch = await runHistoricalServingBackfill([
    '--season=2024',
    '--execute',
    '--skip-probe',
    '--skip-archive',
  ]);
  if (orch.exitCode !== 0) {
    writeStopped(
      {
        generatedAt,
        step: '3C',
        stopped: true,
        reason: `orchestrator exit ${orch.exitCode}`,
        safety,
        sourceArchive,
        verdict: 'RED — stop historical materialization',
      },
      orch.exitCode
    );
  }

  const afterClient = await pool.connect();
  let after;
  try {
    await afterClient.query('begin read only');
    after = await snapshotIsolation(afterClient);
    await afterClient.query('commit');
  } finally {
    afterClient.release();
  }

  const isolationFailures: string[] = [];
  if (after.games_2024 !== EXPECTED.gamesRecords) isolationFailures.push(`games ${after.games_2024} != ${EXPECTED.gamesRecords}`);
  if (after.distinct_games_2024 !== EXPECTED.gamesRecords) isolationFailures.push('duplicate or missing game ids');
  if (after.logs_2024 !== EXPECTED.statsRecords) isolationFailures.push(`logs ${after.logs_2024} != ${EXPECTED.statsRecords}`);
  if (after.log_games_2024 !== EXPECTED.distinctStatGames) isolationFailures.push(`log games ${after.log_games_2024}`);
  if (after.tgs_2024 !== EXPECTED.teamStats) isolationFailures.push(`team stats ${after.tgs_2024}`);
  if (after.tgs_games_2024 !== EXPECTED.gamesRecords) isolationFailures.push(`team-stat games ${after.tgs_games_2024}`);
  if (after.psa_2024 !== EXPECTED.playerAvgs) isolationFailures.push(`player avgs ${after.psa_2024}`);
  if (after.tsa_2024 !== EXPECTED.teamAvgs) isolationFailures.push(`team avgs ${after.tsa_2024}`);
  if (after.score.finals !== EXPECTED.gamesRecords || after.score.matches !== EXPECTED.gamesRecords) {
    isolationFailures.push(`score recon ${after.score.matches}/${after.score.finals}`);
  }
  if (after.structural.dupLogKeys !== 0) isolationFailures.push(`dup log keys ${after.structural.dupLogKeys}`);
  if (after.structural.foreignTeam !== 0) isolationFailures.push(`foreign team ${after.structural.foreignTeam}`);
  if (after.structural.nullCore !== 0) isolationFailures.push(`null core ${after.structural.nullCore}`);
  if (after.structural.missingFinals !== 0) isolationFailures.push(`missing finals ${after.structural.missingFinals}`);
  if (after.raw_pgs_2024 !== 0) isolationFailures.push(`raw 2024 rows ${after.raw_pgs_2024}`);
  if (after.raw_pgs !== EXPECTED.rawPgs) isolationFailures.push(`raw.player_game_stats total ${after.raw_pgs}`);
  if (after.raw_pgs_2025 !== EXPECTED.rawPgs) isolationFailures.push(`raw 2025 rows ${after.raw_pgs_2025}`);
  if (after.games_2025 !== EXPECTED.games2025 || after.logs_2025 !== EXPECTED.logs2025 || after.tgs_2025 !== EXPECTED.tgs2025) {
    isolationFailures.push('2025 serving mutated');
  }
  if (after.inferred_2025 !== EXPECTED.inferred2025 || after.nba_stats_2025 !== EXPECTED.nbaStats2025) {
    isolationFailures.push('2025 stints mutated');
  }
  if (after.psa_2025 !== before.psa_2025 || after.tsa_2025 !== before.tsa_2025) {
    isolationFailures.push('2025 averages mutated');
  }
  if (after.inferred_2024 < 690 || after.inferred_2024 > 710) {
    isolationFailures.push(`inferred stints ${after.inferred_2024} outside ~699`);
  }
  if (after.games_2026 !== EXPECTED.games2026 || after.logs_2026 !== 0 || after.tgs_2026 !== 0 || after.stints_2026 !== EXPECTED.stints2026) {
    isolationFailures.push('2026 mutated');
  }
  if (after.logs_2023 !== 0 || after.tgs_2023 !== 0 || after.psa_2023 !== 0 || after.tsa_2023 !== 0) {
    isolationFailures.push('2023 serving written');
  }
  const afterBox = after.box184 as { home_score?: number | null; away_score?: number | null } | null;
  if (!afterBox || Number(afterBox.home_score) !== EXPECTED.boxHome || Number(afterBox.away_score) !== EXPECTED.boxAway) {
    isolationFailures.push('18447793 mutated');
  }
  const local = after.localOnly as { season?: string; logs?: number } | null;
  if (!local || String(local.season) !== '2025' || Number(local.logs) !== 0) {
    isolationFailures.push('21681993 mutated');
  }
  if (after.other_stints_2024 !== 0) isolationFailures.push(`non-inferred 2024 stints ${after.other_stints_2024}`);

  let checkpoint: StorageCheckpointLike | null = null;
  try {
    checkpoint = JSON.parse(readFileSync(CUR_CHECKPOINT, 'utf8')) as StorageCheckpointLike;
  } catch {
    isolationFailures.push('missing reports/storage/after-2024.json');
  }
  const previous = JSON.parse(readFileSync(PREV_CHECKPOINT, 'utf8')) as StorageCheckpointLike;
  const spawnedGate = checkpoint ? await spawnGate() : { ok: false, stdout: 'checkpoint missing' };
  const gateEval = checkpoint
    ? evaluateTrialStorageGate({ phase: 'after-2024', previous, current: checkpoint })
    : null;

  const beforeMb = mb(before.dbBytes);
  const afterMb = checkpoint?.postgres?.mb ?? mb(after.dbBytes);
  const deltaMb = Math.round((afterMb - beforeMb) * 100) / 100;
  const headroom340 = Math.round((AFTER_2024_MAX_DB_MB - afterMb) * 100) / 100;
  const headroom400 = Math.round((400 - afterMb) * 100) / 100;
  const headroom450 = Math.round((GLOBAL_HARD_STOP_MB - afterMb) * 100) / 100;

  const postgres2023Eligible = Boolean(gateEval?.ok) && isolationFailures.length === 0;
  const s3_2023 = {
    eligibility: 'likely still safe / recommended',
    estimatedRequests: '450-500',
    estimatedHours: '1.8-2.0',
    basis: {
      season2024HttpAttempts: 477,
      season2024ApiHours: 1.81,
      avgSecondsPerRequest: 13.654,
    },
    started: false,
  };

  let verdict: Verdict;
  if (isolationFailures.length) {
    verdict = 'RED — stop historical materialization';
  } else if (!gateEval?.ok) {
    verdict = 'YELLOW — 2024 materialized, but storage result changes 2023 plan';
  } else if (headroom340 < 20) {
    verdict = 'YELLOW — 2024 materialized, but storage result changes 2023 plan';
  } else {
    verdict = 'GREEN — 2024 materialized successfully; storage gate passes';
  }

  const report = {
    generatedAt,
    step: '3C',
    dryRun: false,
    bdlHttpRequests: 0,
    mapper: 'transformBdlArchiveToServing',
    stagingMode: 'none',
    season: '2024',
    seasonWindow: { min: window.servingMinDate, max: window.servingMaxDate },
    safety: { ...safety, postgresWrites: true },
    sourceArchive,
    games: {
      expected: EXPECTED.gamesRecords,
      actual: after.games_2024,
      distinct: after.distinct_games_2024,
      allSeason2024: after.games_2024 === after.distinct_games_2024,
    },
    playerLogs: {
      expected: EXPECTED.statsRecords,
      actual: after.logs_2024,
      distinctGames: after.log_games_2024,
    },
    teamStats: {
      expected: EXPECTED.teamStats,
      actual: after.tgs_2024,
      distinctGames: after.tgs_games_2024,
    },
    seasonAverages: {
      playerExpected: EXPECTED.playerAvgs,
      playerActual: after.psa_2024,
      teamExpected: EXPECTED.teamAvgs,
      teamActual: after.tsa_2024,
    },
    stints: {
      expectedApprox: EXPECTED.inferredStints,
      actual: after.inferred_2024,
      source: 'inferred_pgl',
      otherSources: after.other_stints_2024,
      advisoryAbaPlayers: ADVISORY_ABA,
      abaStintCounts: after.abaStints,
    },
    scoreReconciliation: {
      finals: after.score.finals,
      matches: after.score.matches,
      status: after.score.matches === after.score.finals ? 'MATCH' : 'MISMATCH',
    },
    structural: after.structural,
    rawStagingIsolation: {
      total: after.raw_pgs,
      season2024: after.raw_pgs_2024,
      season2025: after.raw_pgs_2025,
      ok: after.raw_pgs_2024 === 0 && after.raw_pgs_2025 === EXPECTED.rawPgs,
    },
    isolation2025: {
      games: after.games_2025,
      logs: after.logs_2025,
      teamStats: after.tgs_2025,
      inferredStints: after.inferred_2025,
      nbaStatsStints: after.nba_stats_2025,
      box184: after.box184,
      localOnly21681993: after.localOnly,
      unchanged:
        after.games_2025 === before.games_2025 &&
        after.logs_2025 === before.logs_2025 &&
        after.tgs_2025 === before.tgs_2025,
    },
    isolation2026: {
      games: after.games_2026,
      logs: after.logs_2026,
      teamStats: after.tgs_2026,
      stints: after.stints_2026,
      unchanged:
        after.games_2026 === EXPECTED.games2026 &&
        after.logs_2026 === 0 &&
        after.stints_2026 === EXPECTED.stints2026,
    },
    isolationFailures,
    actualStorageDelta: {
      beforePath: PREV_CHECKPOINT,
      afterPath: CUR_CHECKPOINT,
      beforeMb,
      afterMb,
      deltaMb,
      thresholds: {
        dbAfter2024Mb: afterMb,
        deltaMb,
        headroomTo340Mb: headroom340,
        headroomTo400Mb: headroom400,
        headroomTo450Mb: headroom450,
        after2024MaxDbMb: AFTER_2024_MAX_DB_MB,
        after2024MaxDeltaMb: AFTER_2024_MAX_DELTA_MB,
      },
    },
    storageGate: {
      command:
        'npm run ops:trial-storage-gate -- --previous=reports/storage/after-31game-materialize.json --current=reports/storage/after-2024.json --phase=after-2024',
      ok: gateEval?.ok ?? false,
      spawnedOk: spawnedGate.ok,
      result: gateEval,
      spawnedStdout: spawnedGate.stdout.trim(),
    },
    eligibility2023S3: s3_2023,
    eligibility2023Postgres: {
      eligible: postgres2023Eligible && headroom340 >= 20,
      dependsOn: 'actual 2024 storage result',
      gateOk: gateEval?.ok ?? false,
      note: 'Do not start 2023 Postgres in this step. 2023 S3 acquisition is a separate decision.',
    },
    trialTimeBudget: {
      thisStepBdlHttp: 0,
      season2024Archive: { attempts: 477, apiHours: 1.81, avgSecondsPerRequest: 13.654 },
      planned2023S3: { requests: '450-500', hours: '1.8-2.0', started: false },
    },
    verdict,
  };

  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');
  const md = [
    '# 2024 materialization (Step 3C)',
    '',
    `Generated: ${generatedAt}`,
    '',
    `## Step Verdict`,
    '',
    `**${verdict}**`,
    '',
    `## Safety State`,
    '',
    `- DATA_MODE=${mode.dataMode} OFFSEASON_MODE=${mode.offseason ? 1 : 0} CRON_DRY_RUN=${mode.cronDryRun ? 1 : 0}`,
    `- season pin=${pin} dbHost=${host}`,
    `- BDL HTTP=0 stagingMode=none`,
    '',
    `## Counts`,
    '',
    `- games ${after.games_2024}/${EXPECTED.gamesRecords}`,
    `- logs ${after.logs_2024}/${EXPECTED.statsRecords}`,
    `- team stats ${after.tgs_2024}/${EXPECTED.teamStats}`,
    `- player avgs ${after.psa_2024}/${EXPECTED.playerAvgs}`,
    `- team avgs ${after.tsa_2024}/${EXPECTED.teamAvgs}`,
    `- inferred stints ${after.inferred_2024} (expected ~${EXPECTED.inferredStints})`,
    `- score ${after.score.matches}/${after.score.finals}`,
    `- raw 2024 rows ${after.raw_pgs_2024} (must be 0)`,
    '',
    `## Storage`,
    '',
    `- before ${beforeMb} MB after ${afterMb} MB delta ${deltaMb} MB`,
    `- headroom to 340/400/450: ${headroom340} / ${headroom400} / ${headroom450} MB`,
    `- gate ok=${gateEval?.ok ?? false}`,
    '',
    `## 2023`,
    '',
    `- S3 acquisition: ${s3_2023.eligibility} (~${s3_2023.estimatedRequests} req, ~${s3_2023.estimatedHours} h). Not started.`,
    `- Postgres materialization: ${report.eligibility2023Postgres.eligible ? 'eligible' : 'not eligible / defer'} (depends on 2024 delta). Not started.`,
    '',
  ].join('\n');
  writeFileSync(OUT_MD, md);
  console.log(JSON.stringify(report, null, 2));
  if (verdict.startsWith('RED')) process.exit(2);
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
