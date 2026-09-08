/**
 * Step 4F: controlled 2023 S3 → analytics materialization with provider-quality policy.
 * Option B only. No BALLDONTLIE HTTP. No 2022. No Advanced Stats.
 *
 *   npx tsx scripts/ingestion/materialize-2023-from-s3.ts --dry-run
 *   npx tsx scripts/ingestion/materialize-2023-from-s3.ts --execute --i-understand-production-write
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { S3Storage } from '@/lib/aws/s3';
import { bdlAcquisitionLockStatus } from '@/lib/balldontlie/acquisition-lock';
import type { BdlEnvelope } from '@/lib/balldontlie/archive-client';
import { assertCompleteHistoricalArchive, type BdlEntityManifest } from '@/lib/ingestion/historical-serving/archive-gate';
import {
  transformBdlArchiveToServing,
  type BdlGame,
  type BdlStat,
  type ExistingGameRow,
  type ServingPlayer,
  type TeamCatalogRow,
} from '@/lib/ingestion/historical-serving/bdl-to-serving';
import { buildServingBackfillPlan } from '@/lib/ingestion/historical-serving/plan';
import {
  BDL_PLAYER_POINTS_SCORE_MISMATCH,
  PERSISTENT_2023_ANOMALIES,
  PERSISTENT_2023_ANOMALY_IDS,
  evaluateSeason,
  projectedValidationRow,
  specForGame,
  type GameEvidence,
  type RawStatRef,
} from '@/lib/ingestion/historical-serving/provider-quality-policy';
import {
  LOAD_EXISTING_GAMES_SQL,
  LOAD_TEAM_CATALOG_SQL,
  applyHistoricalServingToPostgres,
} from '@/lib/ingestion/historical-serving/season-scoped-writes';
import { historicalSeasonWindow } from '@/lib/ingestion/historical-serving/season-window';
import type { StorageCheckpointLike } from '@/lib/ops/trial-storage-gate';
import pool from '@/lib/db';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

const SEASON = 2023;
const OUT_JSON = 'reports/trial/2023-materialization-report.json';
const OUT_MD = 'reports/trial/2023-materialization-report.md';
const PREV_CHECKPOINT = 'reports/storage/after-2024.json';
const CUR_CHECKPOINT = 'reports/storage/after-2023.json';
const BOX_ID = '18447793';
const LOCAL_ONLY_ID = '21681993';
const EXPECTED_DB_HOST = 'aws-1-us-east-2.pooler.supabase.com';
const ANOMALY_SET = new Set(PERSISTENT_2023_ANOMALY_IDS);

const EXPECTED = {
  gamesPages: 14,
  gamesRecords: 1319,
  statsPages: 461,
  statsRecords: 46090,
  teamStats: 2638,
  playerAvgs: 595,
  teamAvgs: 30,
  inferredStints: 695,
  allowStrict: 1309,
  allowAnomaly: 10,
  rawPgs: 46056,
  games2024: 1321,
  logs2024: 46150,
  tgs2024: 2642,
  psa2024: 587,
  tsa2024: 30,
  inferred2024: 699,
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
  | 'GREEN — 2023 materialized successfully; core historical objective complete'
  | 'YELLOW — 2023 materialized but storage/quality result needs review'
  | 'RED — stop historical progression';

function mb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

function sid(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function toNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
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

async function loadEnvelopeData<T>(s3: S3Storage, keys: string[]): Promise<T[]> {
  const rows: T[] = [];
  for (const key of keys) {
    const env = await s3.getJson<BdlEnvelope>(key);
    if (env && Array.isArray(env.data)) rows.push(...(env.data as T[]));
  }
  return rows;
}

function ptsByTeam(stats: BdlStat[], homeId: string, awayId: string) {
  let home = 0;
  let away = 0;
  const players = new Set<string>();
  for (const s of stats) {
    const pid = sid(s.player?.id);
    const tid = sid(s.team?.id);
    if (pid) players.add(pid);
    const pts = toNum(s.pts);
    if (tid === homeId) home += pts;
    else if (tid === awayId) away += pts;
  }
  return { home, away, players };
}

function teamSide(raw: unknown): { players: Array<Record<string, unknown>> } {
  const side = (raw ?? {}) as Record<string, unknown>;
  const players = Array.isArray(side.players) ? (side.players as Array<Record<string, unknown>>) : [];
  return { players };
}

function writeStopped(payload: unknown, code: number): never {
  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + '\n');
  console.log(JSON.stringify(payload, null, 2));
  process.exit(code);
}

function spawnCheckpoint(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      ['tsx', 'scripts/ops/storage-checkpoint.ts', '--label=after-2023', `--out=${CUR_CHECKPOINT}`],
      { stdio: 'inherit', env: process.env, shell: true }
    );
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`storage checkpoint exited ${code}`));
    });
    child.on('error', reject);
  });
}

async function snapshot(client: Awaited<ReturnType<typeof pool.connect>>) {
  const r = await client.query(
    `select
       pg_database_size(current_database())::bigint as db_bytes,
       current_database() as db_name,
       (select count(*)::int from analytics.games where season = '2023') as games_2023,
       (select count(distinct game_id)::int from analytics.games where season = '2023') as distinct_games_2023,
       (select count(*)::int from analytics.player_game_logs where season = '2023') as logs_2023,
       (select count(distinct game_id)::int from analytics.player_game_logs where season = '2023') as log_games_2023,
       (select count(*)::int from analytics.team_game_stats where season = '2023') as tgs_2023,
       (select count(distinct game_id)::int from analytics.team_game_stats where season = '2023') as tgs_games_2023,
       (select count(*)::int from analytics.player_season_averages where season = '2023') as psa_2023,
       (select count(*)::int from analytics.team_season_averages where season = '2023') as tsa_2023,
       (select count(*)::int from analytics.player_team_stints where season = '2023' and source = 'inferred_pgl') as inferred_2023,
       (select count(*)::int from analytics.player_team_stints where season = '2023' and source is distinct from 'inferred_pgl') as other_stints_2023,
       (select count(*)::int from analytics.games where season = '2024') as games_2024,
       (select count(*)::int from analytics.player_game_logs where season = '2024') as logs_2024,
       (select count(*)::int from analytics.team_game_stats where season = '2024') as tgs_2024,
       (select count(*)::int from analytics.player_season_averages where season = '2024') as psa_2024,
       (select count(*)::int from analytics.team_season_averages where season = '2024') as tsa_2024,
       (select count(*)::int from analytics.player_team_stints where season = '2024' and source = 'inferred_pgl') as inferred_2024,
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
       (select count(*)::int from analytics.player_team_stints where season = '2026') as stints_2026,
       (select count(*)::int from raw.player_game_stats) as raw_pgs,
       (select count(*)::int
          from raw.player_game_stats s
          join analytics.games g on g.game_id = s.game_id::text
         where g.season = '2023') as raw_pgs_2023,
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
    `select game_id, season, home_score, away_score from analytics.games where game_id = $1`,
    [BOX_ID]
  );
  const local = await client.query(
    `select g.game_id, g.season, g.home_score, g.away_score,
            (select count(*)::int from analytics.player_game_logs l where l.game_id = g.game_id) as logs
     from analytics.games g where g.game_id = $1`,
    [LOCAL_ONLY_ID]
  );
  const n = (k: string) => Number(r.rows[0]![k]);
  return {
    dbBytes: Number(r.rows[0]!.db_bytes),
    dbName: String(r.rows[0]!.db_name),
    games_2023: n('games_2023'),
    distinct_games_2023: n('distinct_games_2023'),
    logs_2023: n('logs_2023'),
    log_games_2023: n('log_games_2023'),
    tgs_2023: n('tgs_2023'),
    tgs_games_2023: n('tgs_games_2023'),
    psa_2023: n('psa_2023'),
    tsa_2023: n('tsa_2023'),
    inferred_2023: n('inferred_2023'),
    other_stints_2023: n('other_stints_2023'),
    games_2024: n('games_2024'),
    logs_2024: n('logs_2024'),
    tgs_2024: n('tgs_2024'),
    psa_2024: n('psa_2024'),
    tsa_2024: n('tsa_2024'),
    inferred_2024: n('inferred_2024'),
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
    stints_2026: n('stints_2026'),
    raw_pgs: n('raw_pgs'),
    raw_pgs_2023: n('raw_pgs_2023'),
    raw_pgs_2024: n('raw_pgs_2024'),
    raw_pgs_2025: n('raw_pgs_2025'),
    box184: box.rows[0] ?? null,
    localOnly: local.rows[0] ?? null,
  };
}

async function ensureBdlPlayerEntities(
  client: Awaited<ReturnType<typeof pool.connect>>,
  players: ServingPlayer[]
): Promise<number> {
  const ids = players.map((p) => p.player_id);
  if (!ids.length) return 0;
  const existing = await client.query<{ provider_player_id: string }>(
    `select provider_player_id from analytics.player_provider_ids
     where provider = 'balldontlie' and provider_player_id = any($1::text[])`,
    [ids]
  );
  const have = new Set(existing.rows.map((r) => r.provider_player_id));
  const missing = players.filter((p) => !have.has(p.player_id));
  for (const p of missing) {
    const ent = await client.query<{ player_entity_id: string }>(
      `insert into analytics.player_entities (display_name, first_name, last_name, position)
       values ($1, $2, $3, $4)
       returning player_entity_id::text as player_entity_id`,
      [p.full_name, p.first_name, p.last_name, p.position]
    );
    const entityId = ent.rows[0]!.player_entity_id;
    await client.query(
      `insert into analytics.player_provider_ids (
         player_entity_id, provider, provider_player_id, is_primary, metadata
       ) values ($1::uuid, 'balldontlie', $2, true, $3::jsonb)
       on conflict (provider, provider_player_id) do nothing`,
      [
        entityId,
        p.player_id,
        JSON.stringify({ source: '2023-historical-materialize', analytics_player_id: p.player_id }),
      ]
    );
  }
  return missing.length;
}

async function main() {
  const argv = process.argv.slice(2);
  const execute = argv.includes('--execute');
  const understand = argv.includes('--i-understand-production-write');
  const dryRun = !execute;
  if (execute && !understand) {
    throw new Error('Refusing Production write without --i-understand-production-write');
  }
  const generatedAt = new Date().toISOString();
  const mode = readIngestionMode();
  const pin = getAnalyticsSeason();
  const window = historicalSeasonWindow(SEASON);
  const plan = buildServingBackfillPlan({
    season: SEASON,
    rawPrefix: process.env.NBA_RAW_PREFIX,
    blockedReason: null,
  });
  const host = dbHostFromUrl(process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? '');
  const lock = bdlAcquisitionLockStatus();
  const unsafe: string[] = [];
  if (mode.dataMode !== 'replay') unsafe.push(`DATA_MODE=${mode.dataMode || '(empty)'}`);
  if (!mode.offseason) unsafe.push('OFFSEASON_MODE not 1');
  if (!mode.cronDryRun) unsafe.push('CRON_DRY_RUN not 1');
  if (pin !== '2025') unsafe.push(`season pin=${pin}`);
  if (host !== EXPECTED_DB_HOST) unsafe.push(`db host ${host || '(empty)'} != ${EXPECTED_DB_HOST}`);
  if (plan.stagingMode !== 'none') unsafe.push(`stagingMode=${plan.stagingMode}`);
  if (lock.active) unsafe.push(`BDL lock active pid=${lock.pid}`);

  const beforeClient = await pool.connect();
  let before;
  try {
    await beforeClient.query('begin read only');
    before = await snapshot(beforeClient);
    await beforeClient.query('commit');
  } finally {
    beforeClient.release();
  }
  if (before.games_2023 !== 0 || before.logs_2023 !== 0 || before.tgs_2023 !== 0 || before.psa_2023 !== 0 || before.tsa_2023 !== 0 || before.inferred_2023 !== 0 || before.raw_pgs_2023 !== 0) {
    unsafe.push('2023 serving/raw not empty');
  }
  if (before.games_2024 !== EXPECTED.games2024 || before.logs_2024 !== EXPECTED.logs2024 || before.tgs_2024 !== EXPECTED.tgs2024 || before.psa_2024 !== EXPECTED.psa2024 || before.tsa_2024 !== EXPECTED.tsa2024 || before.inferred_2024 !== EXPECTED.inferred2024) {
    unsafe.push('2024 serving unexpected');
  }
  if (before.games_2025 !== EXPECTED.games2025 || before.logs_2025 !== EXPECTED.logs2025 || before.tgs_2025 !== EXPECTED.tgs2025) {
    unsafe.push('2025 serving unexpected');
  }
  if (before.games_2026 !== EXPECTED.games2026 || before.logs_2026 !== 0 || before.tgs_2026 !== 0 || before.stints_2026 !== EXPECTED.stints2026) {
    unsafe.push('2026 isolation unexpected');
  }
  const boxBefore = before.box184 as { home_score?: number; away_score?: number } | null;
  if (!boxBefore || Number(boxBefore.home_score) !== EXPECTED.boxHome || Number(boxBefore.away_score) !== EXPECTED.boxAway) {
    unsafe.push('18447793 unexpected');
  }
  if (before.raw_pgs !== EXPECTED.rawPgs) unsafe.push(`raw.player_game_stats ${before.raw_pgs}`);

  const safety = {
    dataMode: mode.dataMode,
    offseasonMode: mode.offseason,
    cronDryRun: mode.cronDryRun,
    frozen: true,
    currentAnalyticsSeason: pin,
    bdlHttpRequests: 0,
    lockActive: lock.active,
    stagingMode: plan.stagingMode,
    dbHost: host,
    expectedDbHost: EXPECTED_DB_HOST,
    postgresWrites: false,
    servingBefore: before,
  };
  if (unsafe.length) {
    writeStopped({ generatedAt, step: '4F', stopped: true, reason: 'safety preflight failed', unsafe, safety, verdict: 'RED — stop historical progression' }, 2);
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
  const archiveDiffers =
    !gate.ok ||
    gamesPageKeys.length !== EXPECTED.gamesPages ||
    Number(gamesManifest?.recordCount) !== EXPECTED.gamesRecords ||
    statsPageKeys.length !== EXPECTED.statsPages ||
    Number(statsManifest?.recordCount) !== EXPECTED.statsRecords;
  if (archiveDiffers) {
    writeStopped({ generatedAt, step: '4F', stopped: true, reason: 'S3 archive differs from Step 4A certification', gate, verdict: 'RED — stop historical progression' }, 2);
  }

  console.log('[4F] loading 2023 S3 archive (no BDL HTTP)...');
  const games = await loadEnvelopeData<BdlGame>(s3, gamesPageKeys);
  const statsRows = await loadEnvelopeData<BdlStat>(s3, statsPageKeys);
  const pg = await pool.connect();
  let teamCatalog: TeamCatalogRow[] = [];
  let existing: ExistingGameRow[] = [];
  try {
    teamCatalog = (await pg.query<TeamCatalogRow>(LOAD_TEAM_CATALOG_SQL)).rows;
    const ids = games.map((g) => sid(g.id)).filter(Boolean);
    existing = ids.length ? (await pg.query<ExistingGameRow>(LOAD_EXISTING_GAMES_SQL, [ids])).rows : [];
  } finally {
    pg.release();
  }

  const report = transformBdlArchiveToServing({
    seasonStartYear: SEASON,
    games,
    stats: statsRows,
    teamCatalog,
    existingGames: existing,
  });
  if (report.stats.crossSeasonConflicts > 0) {
    writeStopped({ generatedAt, step: '4F', stopped: true, reason: 'cross-season collisions', report: report.stats, verdict: 'RED — stop historical progression' }, 2);
  }

  const rawStatsByGame = new Map<string, RawStatRef[]>();
  const seasonStatsByGame = new Map<string, BdlStat[]>();
  for (const srow of statsRows) {
    const gid = sid(srow.game?.id);
    if (!gid) continue;
    const list = seasonStatsByGame.get(gid) ?? [];
    list.push(srow);
    seasonStatsByGame.set(gid, list);
    const raw = rawStatsByGame.get(gid) ?? [];
    raw.push({ id: sid(srow.id), playerId: sid(srow.player?.id), teamId: sid(srow.team?.id), gameId: gid });
    rawStatsByGame.set(gid, raw);
  }
  const logsByGame = new Map<string, typeof report.logs>();
  for (const log of report.logs) {
    const list = logsByGame.get(log.game_id) ?? [];
    list.push(log);
    logsByGame.set(log.game_id, list);
  }

  const evidenceByGame = new Map<string, GameEvidence>();
  for (const spec of PERSISTENT_2023_ANOMALIES) {
    const g = report.games.find((x) => x.game_id === spec.gameId);
    const orig = seasonStatsByGame.get(spec.gameId) ?? [];
    const repair = await s3.getJson<{ pages?: BdlEnvelope[] }>(`${plan.s3StatsPrefix}/game_id=${spec.gameId}.json`);
    const fresh = (repair?.pages ?? []).flatMap((p) => (Array.isArray(p.data) ? (p.data as BdlStat[]) : []));
    const origSum = ptsByTeam(orig, g?.home_team_id ?? '', g?.away_team_id ?? '');
    const freshSum = ptsByTeam(fresh, g?.home_team_id ?? '', g?.away_team_id ?? '');
    const refetchIdentical =
      origSum.home === freshSum.home &&
      origSum.away === freshSum.away &&
      origSum.players.size === freshSum.players.size &&
      [...origSum.players].every((id) => freshSum.players.has(id));
    let boxScores: GameEvidence['boxScores'] = spec.boxScoresEvidence;
    if (spec.boxScoresEvidence === 'sampled_reproduced') {
      const date = sid((games.find((x) => sid(x.id) === spec.gameId) as BdlGame | undefined)?.date);
      const diag = await s3.getJson<{ body?: { data?: Array<Record<string, unknown>> } }>(
        `raw/source=balldontlie/league=nba/season=2023/entity=box_scores_diagnostic/date=${date}.json`
      );
      const box = (diag?.body?.data ?? []).find((b) => sid(b.id) === spec.gameId) ?? null;
      if (!box) boxScores = 'missing';
      else {
        const home = teamSide(box.home_team);
        const away = teamSide(box.visitor_team);
        let homePts = 0;
        let awayPts = 0;
        for (const p of home.players) homePts += toNum(p.pts);
        for (const p of away.players) awayPts += toNum(p.pts);
        if (homePts !== spec.providerSum.home || awayPts !== spec.providerSum.away) boxScores = 'missing';
      }
    }
    evidenceByGame.set(spec.gameId, { refetchIdentical, boxScores });
  }
  for (const g of report.games) {
    if (!evidenceByGame.has(g.game_id)) evidenceByGame.set(g.game_id, { refetchIdentical: false, boxScores: 'not_applicable' });
  }

  const policy = evaluateSeason({
    season: '2023',
    games: report.games,
    logsByGame,
    rawStatsByGame,
    evidenceByGame,
  });
  const anomalyIds = policy.results.filter((r) => r.decision === 'ALLOW_PERSISTENT_ANOMALY').map((r) => r.gameId).sort();
  const expectedIds = [...PERSISTENT_2023_ANOMALY_IDS].sort();
  const policyOk =
    policy.canMaterialize &&
    policy.allowStrict === EXPECTED.allowStrict &&
    policy.allowAnomaly === EXPECTED.allowAnomaly &&
    policy.reject === 0 &&
    anomalyIds.join(',') === expectedIds.join(',');
  const qualityEval = {
    allowStrict: policy.allowStrict,
    allowAnomaly: policy.allowAnomaly,
    reject: policy.reject,
    anomalyIds,
    expectedIds,
    rejects: policy.results.filter((r) => r.decision === 'REJECT').map((r) => ({ gameId: r.gameId, reason: r.reason })),
  };
  if (!policyOk) {
    writeStopped({ generatedAt, step: '4F', stopped: true, reason: 'provider-quality policy rejected materialization', qualityEval, verdict: 'RED — stop historical progression' }, 2);
  }

  const qualityRows = policy.results
    .filter((r) => r.qualityFlag)
    .map((r) =>
      projectedValidationRow({
        result: r,
        season: '2023',
        detectedAt: generatedAt,
        evidence: evidenceByGame.get(r.gameId),
      })
    );

  if (dryRun) {
    const payload = {
      generatedAt,
      step: '4F',
      dryRun: true,
      bdlHttpRequests: 0,
      postgresWrites: false,
      safety,
      qualityEval,
      qualityRowsPlanned: qualityRows.length,
      mapped: { games: report.games.length, logs: report.logs.length, players: report.players.length },
      note: 'Policy GREEN. Rerun with --execute --i-understand-production-write. No Postgres writes.',
    };
    mkdirSync('reports/trial', { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + '\n');
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log('[4F] policy GREEN; writing quality flags + 2023 serving (no BDL HTTP)');
  const writeClient = await pool.connect();
  let inferredStints = 0;
  let entitiesCreated = 0;
  try {
    await writeClient.query('begin');
    await writeClient.query(`set local statement_timeout = '900s'`);
    for (const row of qualityRows) {
      await writeClient.query(
        `insert into game_validation_results (game_id, check_name, status, severity, details, validated_at)
         values ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
         on conflict (game_id, check_name)
         do update set status = excluded.status, severity = excluded.severity,
                       details = excluded.details, validated_at = excluded.validated_at`,
        [row.game_id, row.check_name, row.status, row.severity, JSON.stringify(row.details), row.validated_at]
      );
    }
    entitiesCreated = await ensureBdlPlayerEntities(writeClient, report.players);
    const wrote = await applyHistoricalServingToPostgres(writeClient, report);
    inferredStints = wrote.inferredStints;
    await writeClient.query('commit');
  } catch (err) {
    await writeClient.query('rollback');
    throw err;
  } finally {
    writeClient.release();
  }

  const afterClient = await pool.connect();
  let after = before;
  let strict = { pass: 0, fail: 0 };
  let flagged = { allowed: 0, fail: 0 };
  let qualityFilter = { n: 0, ids: [] as string[], extra: [] as string[] };
  let structural = { dupLogKeys: 0, foreignTeam: 0, nullCore: 0, tgsNotTwo: 0, bothTeamsMissing: 0 };
  let anomalyTeamPointsFabricated = 0;
  try {
    await afterClient.query('begin read only');
    after = await snapshot(afterClient);
    const struct = await afterClient.query(
      `select
         (select count(*)::int from (
            select game_id, player_id from analytics.player_game_logs where season = '2023'
            group by 1, 2 having count(*) > 1
          ) d) as dup_log_keys,
         (select count(*)::int from analytics.player_game_logs
           where season = '2023' and (game_id is null or player_id is null or team_id is null)) as null_core,
         (select count(*)::int from analytics.player_game_logs l
           join analytics.games g on g.game_id = l.game_id
          where l.season = '2023'
            and l.team_id is distinct from g.home_team_id
            and l.team_id is distinct from g.away_team_id) as foreign_team,
         (select count(*)::int from analytics.games g
           where g.season = '2023'
             and (select count(*) from analytics.team_game_stats t where t.game_id = g.game_id) is distinct from 2) as tgs_not_two,
         (select count(*)::int from analytics.games g
           where g.season = '2023' and exists (
             select 1 from analytics.player_game_logs l where l.game_id = g.game_id
           ) and (
             not exists (select 1 from analytics.player_game_logs h where h.game_id = g.game_id and h.team_id = g.home_team_id)
             or not exists (select 1 from analytics.player_game_logs a where a.game_id = g.game_id and a.team_id = g.away_team_id)
           )) as both_teams_missing`
    );
    structural = {
      dupLogKeys: Number(struct.rows[0]!.dup_log_keys),
      foreignTeam: Number(struct.rows[0]!.foreign_team),
      nullCore: Number(struct.rows[0]!.null_core),
      tgsNotTwo: Number(struct.rows[0]!.tgs_not_two),
      bothTeamsMissing: Number(struct.rows[0]!.both_teams_missing),
    };
    const scores = await afterClient.query<{
      game_id: string;
      home_pts: number;
      away_pts: number;
      home_score: number;
      away_score: number;
    }>(
      `with summed as (
         select g.game_id,
                coalesce(sum(l.points) filter (where l.team_id = g.home_team_id), 0)::int as home_pts,
                coalesce(sum(l.points) filter (where l.team_id = g.away_team_id), 0)::int as away_pts,
                g.home_score, g.away_score
         from analytics.games g
         left join analytics.player_game_logs l on l.game_id = g.game_id
         where g.season = '2023'
         group by g.game_id, g.home_team_id, g.away_team_id, g.home_score, g.away_score
       )
       select * from summed`
    );
    for (const row of scores.rows) {
      const id = String(row.game_id);
      const match = Number(row.home_pts) === Number(row.home_score) && Number(row.away_pts) === Number(row.away_score);
      if (ANOMALY_SET.has(id)) {
        const spec = specForGame(id)!;
        const ok =
          Number(row.home_score) === spec.official.home &&
          Number(row.away_score) === spec.official.away &&
          Number(row.home_pts) === spec.providerSum.home &&
          Number(row.away_pts) === spec.providerSum.away;
        if (ok) flagged.allowed += 1;
        else flagged.fail += 1;
      } else if (match) {
        strict.pass += 1;
      } else {
        strict.fail += 1;
      }
    }
    const tgsAnom = await afterClient.query<{
      game_id: string;
      is_home: boolean;
      team_points: number;
    }>(
      `select t.game_id, t.is_home, t.team_points
       from analytics.team_game_stats t
       where t.season = '2023' and t.game_id = any($1::text[])`,
      [[...PERSISTENT_2023_ANOMALY_IDS]]
    );
    anomalyTeamPointsFabricated = 0;
    for (const row of tgsAnom.rows) {
      const spec = specForGame(String(row.game_id));
      if (!spec) continue;
      const expected = row.is_home ? spec.providerSum.home : spec.providerSum.away;
      if (Number(row.team_points) !== expected) anomalyTeamPointsFabricated += 1;
    }
    const q = await afterClient.query<{ game_id: string }>(
      `select game_id from game_validation_results
       where check_name = $1 and status = 'fail' and severity = 'error'`,
      [BDL_PLAYER_POINTS_SCORE_MISMATCH]
    );
    const ids = q.rows.map((r) => String(r.game_id)).sort();
    qualityFilter = {
      n: ids.length,
      ids,
      extra: ids.filter((id) => !ANOMALY_SET.has(id)),
    };
    await afterClient.query('commit');
  } finally {
    afterClient.release();
  }

  await spawnCheckpoint();
  let checkpoint: StorageCheckpointLike | null = null;
  try {
    checkpoint = JSON.parse(readFileSync(CUR_CHECKPOINT, 'utf8')) as StorageCheckpointLike;
  } catch {
    checkpoint = null;
  }
  const previous = JSON.parse(readFileSync(PREV_CHECKPOINT, 'utf8')) as StorageCheckpointLike;
  const beforeMb = previous.postgres?.mb ?? mb(before.dbBytes);
  const afterMb = checkpoint?.postgres?.mb ?? mb(after.dbBytes);
  const deltaMb = Math.round((afterMb - beforeMb) * 100) / 100;
  const storageClass = afterMb < 340 ? 'Healthy' : 'Historical Postgres warning';

  const isolationFailures: string[] = [];
  if (after.games_2023 !== EXPECTED.gamesRecords) isolationFailures.push(`games ${after.games_2023}`);
  if (after.distinct_games_2023 !== EXPECTED.gamesRecords) isolationFailures.push('duplicate/missing game ids');
  if (after.logs_2023 !== EXPECTED.statsRecords) isolationFailures.push(`logs ${after.logs_2023}`);
  if (after.tgs_2023 !== EXPECTED.teamStats) isolationFailures.push(`tgs ${after.tgs_2023}`);
  if (after.psa_2023 !== EXPECTED.playerAvgs) isolationFailures.push(`psa ${after.psa_2023}`);
  if (after.tsa_2023 !== EXPECTED.teamAvgs) isolationFailures.push(`tsa ${after.tsa_2023}`);
  if (after.inferred_2023 < 690 || after.inferred_2023 > 710) isolationFailures.push(`stints ${after.inferred_2023}`);
  if (after.other_stints_2023 !== 0) isolationFailures.push('non-inferred 2023 stints');
  if (structural.dupLogKeys || structural.foreignTeam || structural.nullCore || structural.tgsNotTwo || structural.bothTeamsMissing) {
    isolationFailures.push(`structural ${JSON.stringify(structural)}`);
  }
  if (strict.pass !== 1309 || strict.fail !== 0) isolationFailures.push(`strict ${strict.pass}/1309 fail=${strict.fail}`);
  if (flagged.allowed !== 10 || flagged.fail !== 0) isolationFailures.push(`anomaly ${flagged.allowed}/10 fail=${flagged.fail}`);
  if (anomalyTeamPointsFabricated !== 0) isolationFailures.push('team_points fabricated onto official scores');
  if (qualityFilter.n !== 10 || qualityFilter.extra.length) isolationFailures.push(`quality filter ${qualityFilter.n} extra=${qualityFilter.extra.join(',')}`);
  if (after.raw_pgs_2023 !== 0 || after.raw_pgs_2024 !== 0 || after.raw_pgs !== EXPECTED.rawPgs || after.raw_pgs_2025 !== EXPECTED.rawPgs) {
    isolationFailures.push('raw staging isolation');
  }
  if (after.games_2024 !== EXPECTED.games2024 || after.logs_2024 !== EXPECTED.logs2024 || after.tgs_2024 !== EXPECTED.tgs2024 || after.psa_2024 !== EXPECTED.psa2024 || after.tsa_2024 !== EXPECTED.tsa2024 || after.inferred_2024 !== EXPECTED.inferred2024) {
    isolationFailures.push('2024 mutated');
  }
  if (after.games_2025 !== EXPECTED.games2025 || after.logs_2025 !== EXPECTED.logs2025 || after.tgs_2025 !== EXPECTED.tgs2025 || after.inferred_2025 !== before.inferred_2025 || after.nba_stats_2025 !== before.nba_stats_2025) {
    isolationFailures.push('2025 mutated');
  }
  const boxAfter = after.box184 as { home_score?: number; away_score?: number } | null;
  if (!boxAfter || Number(boxAfter.home_score) !== EXPECTED.boxHome || Number(boxAfter.away_score) !== EXPECTED.boxAway) {
    isolationFailures.push('18447793 mutated');
  }
  const local = after.localOnly as { season?: string; logs?: number } | null;
  if (!local || String(local.season) !== '2025' || Number(local.logs) !== 0) isolationFailures.push('21681993 mutated');
  if (after.games_2026 !== EXPECTED.games2026 || after.logs_2026 !== 0 || after.tgs_2026 !== 0 || after.stints_2026 !== EXPECTED.stints2026) {
    isolationFailures.push('2026 mutated');
  }

  let verdict: Verdict;
  if (isolationFailures.length) verdict = 'RED — stop historical progression';
  else if (afterMb >= 340) verdict = 'YELLOW — 2023 materialized but storage/quality result needs review';
  else verdict = 'GREEN — 2023 materialized successfully; core historical objective complete';

  const payload = {
    generatedAt,
    step: '4F',
    dryRun: false,
    bdlHttpRequests: 0,
    mapper: 'transformBdlArchiveToServing',
    stagingMode: 'none',
    safety: { ...safety, postgresWrites: true },
    qualityEvaluation: qualityEval,
    qualityRecordsWritten: qualityRows.length,
    entitiesCreatedForStints: entitiesCreated,
    inferredStintsWritten: inferredStints,
    games: { expected: 1319, actual: after.games_2023, distinct: after.distinct_games_2023 },
    playerLogs: { expected: 46090, actual: after.logs_2023, logGames: after.log_games_2023 },
    teamStats: { expected: 2638, actual: after.tgs_2023, games: after.tgs_games_2023 },
    seasonAverages: { playerExpected: 595, playerActual: after.psa_2023, teamExpected: 30, teamActual: after.tsa_2023 },
    stints: { expectedApprox: 695, actual: after.inferred_2023, other: after.other_stints_2023 },
    strictReconciliation: { pass: strict.pass, fail: strict.fail, expected: 1309 },
    knownProviderAnomaly: { flaggedAndAllowed: flagged.allowed, fail: flagged.fail, expected: 10 },
    rawStagingIsolation: { raw_pgs: after.raw_pgs, raw_pgs_2023: after.raw_pgs_2023, raw_pgs_2024: after.raw_pgs_2024, raw_pgs_2025: after.raw_pgs_2025 },
    qualityFilterVerification: qualityFilter,
    isolation2024: { games: after.games_2024, logs: after.logs_2024, tgs: after.tgs_2024, psa: after.psa_2024, tsa: after.tsa_2024, inferred: after.inferred_2024 },
    isolation2025: { games: after.games_2025, logs: after.logs_2025, tgs: after.tgs_2025, box184: after.box184, localOnly: after.localOnly },
    isolation2026: { games: after.games_2026, logs: after.logs_2026, tgs: after.tgs_2026, stints: after.stints_2026 },
    structural,
    storage: {
      previousMb: beforeMb,
      currentMb: afterMb,
      bytes: checkpoint?.postgres?.bytes ?? after.dbBytes,
      deltaMb,
      headroomTo340Mb: Math.round((340 - afterMb) * 100) / 100,
      headroomTo400Mb: Math.round((400 - afterMb) * 100) / 100,
      headroomTo450Mb: Math.round((450 - afterMb) * 100) / 100,
      class: storageClass,
      checkpoint: CUR_CHECKPOINT,
    },
    isolationFailures,
    bdlHttpConfirmation: { requests: 0, investigationClosed: true },
    verdict,
  };
  mkdirSync('reports/trial', { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + '\n');
  writeFileSync(
    OUT_MD,
    [
      '# 2023 materialization (Step 4F)',
      '',
      `Generated: ${generatedAt}`,
      '',
      `**${verdict}**`,
      '',
      `- games ${after.games_2023}/1319; logs ${after.logs_2023}/46090; tgs ${after.tgs_2023}/2638`,
      `- strict ${strict.pass}/1309; flagged ${flagged.allowed}/10; reject 0`,
      `- quality flags ${qualityFilter.n}; raw 2023 ${after.raw_pgs_2023}`,
      `- storage ${afterMb} MB (delta ${deltaMb}); ${storageClass}`,
      '',
      'Do not start Advanced Stats. Do not start 2022.',
      '',
    ].join('\n')
  );
  console.log(JSON.stringify({ verdict, games: after.games_2023, logs: after.logs_2023, strict: strict.pass, flagged: flagged.allowed, deltaMb, storageClass, isolationFailures }, null, 2));
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
