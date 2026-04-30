/**
 * Slice 7: Build player_game_features_v1 from curated parquet inputs.
 *
 * Scope:
 * - Read curated player_game_logs (required) and curated games (optional sanity)
 * - Build features layer output only:
 *   features/league=nba/season=<S>/entity=player_game_features/dt=YYYY-MM-DD/data.parquet
 * - No strategy/API/UI/infra changes.
 */

import 'dotenv/config';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import duckdb from '@duckdb/node-api';
import { S3Storage } from '@/lib/aws/s3';
import {
  FEATURE_VERSION,
  KEY_FEATURE_COLUMNS,
  PLAYER_GAME_FEATURE_COLUMNS,
  dedupeKey,
  mean,
  type KeyFeatureColumn,
  type PlayerGameFeature,
} from '@/lib/features/player-game-features-v1-schema';

type CliArgs = {
  season: number;
  dryRun: boolean;
  overwrite: boolean;
  partitions: string[] | null;
};

type CuratedPlayerLogRow = {
  season: string | null;
  game_id: string | null;
  game_date: string | null;
  player_id: string | null;
  player_name: string | null;
  team_id: string | null;
  team_abbr: string | null;
  opponent_team_id: string | null;
  opponent_abbr: string | null;
  minutes: number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  threes: number | null;
  pra: number | null;
};

type PartitionSummary = {
  dt: string;
  outputKey: string;
  rowsWritten: number;
  skipped: boolean;
  skipReason?: 'exists' | 'dry-run';
};

type ManualCheckResult = {
  status: 'passed' | 'failed';
  playerId: string;
  gameId: string;
  gameDate: string;
  priorGameIdsUsedL5: string[];
  priorGameIdsUsedL10: string[];
  manual: { l5: number | null; l10: number | null };
  emitted: { l5: number | null; l10: number | null };
  tolerance: number;
  error?: string;
};

type Manifest = {
  schemaVersion: 1;
  featureVersion: 'player_game_features_v1';
  source: 'existing_ingestion';
  inputPrefix: string;
  outputPrefix: string;
  season: number;
  entity: 'player_game_features';
  rowCount: number;
  dateRange: { from: string | null; to: string | null };
  partitions: PartitionSummary[];
  duplicateRowsDropped: number;
  crossPartitionDuplicateKeysDetected: number;
  nullCounts: Record<KeyFeatureColumn, number>;
  nullRates: Record<KeyFeatureColumn, number>;
  validationStatus: 'passed' | 'warning' | 'failed';
  validation: {
    rowCountCheck: { expected: number; actual: number; status: 'passed' | 'failed' };
    dateRangeCheck: { expected: { from: string | null; to: string | null }; actual: { from: string | null; to: string | null }; status: 'passed' | 'failed' };
    duplicateKeyCount: number;
    partitionCountCheck: { expected: number; actual: number; status: 'passed' | 'failed' };
    sampleRows: PlayerGameFeature[];
    manualCheck: ManualCheckResult;
  };
  generatedAt: string;
  status: 'success' | 'partial' | 'dry-run' | 'error';
};

function fatal(msg: string): never {
  console.error(`[fatal] ${msg}`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) fatal(`Missing required env var: ${name}`);
  return v;
}

function parseArgs(argv: string[]): CliArgs {
  const flags: Record<string, string | boolean> = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq === -1) flags[raw.slice(2)] = true;
    else flags[raw.slice(2, eq)] = raw.slice(eq + 1);
  }
  const seasonRaw = flags.season;
  if (typeof seasonRaw !== 'string' || !/^\d{4}$/.test(seasonRaw)) {
    fatal('Missing or invalid --season=<YYYY>. Example: --season=2025');
  }
  let partitions: string[] | null = null;
  const partitionsRaw = flags.partitions;
  if (typeof partitionsRaw === 'string' && partitionsRaw.trim().length > 0) {
    partitions = partitionsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    const bad = partitions.filter((p) => !/^\d{4}-\d{2}-\d{2}$/.test(p));
    if (bad.length > 0) fatal(`Invalid --partitions values: ${bad.join(', ')}`);
  }
  return {
    season: Number(seasonRaw),
    dryRun: flags['dry-run'] === true,
    overwrite: flags.overwrite === true,
    partitions,
  };
}

function curatedLogsPrefix(season: number): string {
  return `curated/league=nba/season=${season}/entity=player_game_logs`;
}
function curatedGamesPrefix(season: number): string {
  return `curated/league=nba/season=${season}/entity=games`;
}
function featuresPrefix(season: number): string {
  return `features/league=nba/season=${season}/entity=player_game_features`;
}

async function ensureDuckdbAvailable(): Promise<void> {
  try {
    const instance = await duckdb.DuckDBInstance.create(':memory:');
    const conn = await instance.connect();
    const reader = await conn.runAndReadAll('select 1');
    await reader.getRows();
    conn.closeSync();
    instance.closeSync();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fatal(`DuckDB unavailable: ${msg}`);
  }
}

async function listPartitionDates(s3: S3Storage, prefix: string): Promise<string[]> {
  const out = new Set<string>();
  for await (const obj of s3.listByPrefix(prefix)) {
    const m = obj.key.match(/\/dt=(\d{4}-\d{2}-\d{2})\/data\.parquet$/);
    if (!m) continue;
    out.add(m[1]);
  }
  return [...out].sort();
}

async function downloadParquetSet(args: {
  s3: S3Storage;
  s3Client: S3Client;
  bucket: string;
  sourcePrefix: string;
  targetDir: string;
  selectedDts: string[] | null;
}): Promise<{ localPaths: string[]; dts: string[] }> {
  const { s3, s3Client, bucket, sourcePrefix, targetDir, selectedDts } = args;
  const localPaths: string[] = [];
  const dts: string[] = [];
  for await (const obj of s3.listByPrefix(sourcePrefix)) {
    const m = obj.key.match(/\/dt=(\d{4}-\d{2}-\d{2})\/data\.parquet$/);
    if (!m) continue;
    const dt = m[1];
    if (selectedDts && !selectedDts.includes(dt)) continue;
    const local = path.join(targetDir, `dt=${dt}.parquet`);
    const got = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: obj.key }));
    if (!got.Body) continue;
    const bytes = Buffer.from(await got.Body.transformToByteArray());
    await fs.writeFile(local, bytes);
    localPaths.push(local);
    dts.push(dt);
  }
  return { localPaths, dts: [...new Set(dts)].sort() };
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  return s.length ? s : null;
}

function buildFeaturesFromRows(rows: CuratedPlayerLogRow[], season: number): {
  features: PlayerGameFeature[];
  duplicateRowsDropped: number;
  crossPartitionDuplicateKeysDetected: number;
} {
  const dedupe = new Map<string, CuratedPlayerLogRow>();
  let duplicateRowsDropped = 0;
  for (const row of rows) {
    const pid = safeString(row.player_id);
    const gid = safeString(row.game_id);
    if (!pid || !gid) continue;
    const key = dedupeKey(pid, gid);
    if (dedupe.has(key)) {
      duplicateRowsDropped += 1;
      continue;
    }
    dedupe.set(key, row);
  }

  const byPlayer = new Map<string, CuratedPlayerLogRow[]>();
  for (const row of dedupe.values()) {
    const pid = String(row.player_id);
    if (!byPlayer.has(pid)) byPlayer.set(pid, []);
    byPlayer.get(pid)!.push(row);
  }

  const features: PlayerGameFeature[] = [];
  let crossPartitionDuplicateKeysDetected = 0;
  // With global dedupe map this will remain 0; included for manifest parity.

  for (const [playerId, logs] of byPlayer) {
    logs.sort((a, b) => {
      const ad = String(a.game_date ?? '');
      const bd = String(b.game_date ?? '');
      if (ad !== bd) return ad < bd ? -1 : 1;
      const ag = String(a.game_id ?? '');
      const bg = String(b.game_id ?? '');
      return ag < bg ? -1 : ag > bg ? 1 : 0;
    });

    for (let i = 0; i < logs.length; i++) {
      const target = logs[i];
      const prior = logs.slice(0, i);

      const pointsSeason = mean(prior.map((p) => toNum(p.points)).filter((x): x is number => x != null));
      const reboundsSeason = mean(prior.map((p) => toNum(p.rebounds)).filter((x): x is number => x != null));
      const assistsSeason = mean(prior.map((p) => toNum(p.assists)).filter((x): x is number => x != null));
      const threesSeason = mean(prior.map((p) => toNum(p.threes)).filter((x): x is number => x != null));
      const praSeason = mean(
        prior
          .map((p) => {
            const pra = toNum(p.pra);
            if (pra != null) return pra;
            const pts = toNum(p.points);
            const reb = toNum(p.rebounds);
            const ast = toNum(p.assists);
            return pts != null && reb != null && ast != null ? pts + reb + ast : null;
          })
          .filter((x): x is number => x != null)
      );

      const l5 = prior.slice(-5);
      const l10 = prior.slice(-10);
      const statWindow = (
        arr: CuratedPlayerLogRow[],
        getter: (r: CuratedPlayerLogRow) => number | null
      ) => mean(arr.map(getter).filter((x): x is number => x != null));

      const pointsL5 = statWindow(l5, (r) => toNum(r.points));
      const pointsL10 = statWindow(l10, (r) => toNum(r.points));
      const reboundsL5 = statWindow(l5, (r) => toNum(r.rebounds));
      const reboundsL10 = statWindow(l10, (r) => toNum(r.rebounds));
      const assistsL5 = statWindow(l5, (r) => toNum(r.assists));
      const assistsL10 = statWindow(l10, (r) => toNum(r.assists));
      const threesL5 = statWindow(l5, (r) => toNum(r.threes));
      const threesL10 = statWindow(l10, (r) => toNum(r.threes));
      const praL5 = statWindow(l5, (r) => {
        const pra = toNum(r.pra);
        if (pra != null) return pra;
        const pts = toNum(r.points);
        const reb = toNum(r.rebounds);
        const ast = toNum(r.assists);
        return pts != null && reb != null && ast != null ? pts + reb + ast : null;
      });
      const praL10 = statWindow(l10, (r) => {
        const pra = toNum(r.pra);
        if (pra != null) return pra;
        const pts = toNum(r.points);
        const reb = toNum(r.rebounds);
        const ast = toNum(r.assists);
        return pts != null && reb != null && ast != null ? pts + reb + ast : null;
      });
      const minutesL5 = statWindow(l5, (r) => toNum(r.minutes));
      const minutesL10 = statWindow(l10, (r) => toNum(r.minutes));

      const actualPoints = toNum(target.points);
      const actualRebounds = toNum(target.rebounds);
      const actualAssists = toNum(target.assists);
      const actualThrees = toNum(target.threes);
      const actualPra = (() => {
        const pra = toNum(target.pra);
        if (pra != null) return pra;
        return actualPoints != null && actualRebounds != null && actualAssists != null
          ? actualPoints + actualRebounds + actualAssists
          : null;
      })();

      features.push({
        season: safeString(target.season) ?? String(season),
        game_id: String(target.game_id),
        game_date: String(target.game_date),
        player_id: playerId,
        player_name: safeString(target.player_name),
        team_id: safeString(target.team_id),
        team_abbr: safeString(target.team_abbr),
        opponent_team_id: safeString(target.opponent_team_id),
        opponent_abbr: safeString(target.opponent_abbr),
        prior_games: prior.length,
        points_season_avg_before_game: pointsSeason,
        points_l5_avg_before_game: pointsL5,
        points_l10_avg_before_game: pointsL10,
        rebounds_season_avg_before_game: reboundsSeason,
        rebounds_l5_avg_before_game: reboundsL5,
        rebounds_l10_avg_before_game: reboundsL10,
        assists_season_avg_before_game: assistsSeason,
        assists_l5_avg_before_game: assistsL5,
        assists_l10_avg_before_game: assistsL10,
        threes_season_avg_before_game: threesSeason,
        threes_l5_avg_before_game: threesL5,
        threes_l10_avg_before_game: threesL10,
        pra_season_avg_before_game: praSeason,
        pra_l5_avg_before_game: praL5,
        pra_l10_avg_before_game: praL10,
        minutes_l5_avg_before_game: minutesL5,
        minutes_l10_avg_before_game: minutesL10,
        actual_points: actualPoints,
        actual_rebounds: actualRebounds,
        actual_assists: actualAssists,
        actual_threes: actualThrees,
        actual_pra: actualPra,
      });
    }
  }

  features.sort((a, b) => {
    if (a.game_date !== b.game_date) return a.game_date < b.game_date ? -1 : 1;
    if (a.player_id !== b.player_id) return a.player_id < b.player_id ? -1 : 1;
    return a.game_id < b.game_id ? -1 : a.game_id > b.game_id ? 1 : 0;
  });

  return { features, duplicateRowsDropped, crossPartitionDuplicateKeysDetected };
}

async function writeFeaturesPartitionParquet(args: {
  rows: PlayerGameFeature[];
  parquetPath: string;
}): Promise<void> {
  const { rows, parquetPath } = args;
  const tmpJsonl = path.join(os.tmpdir(), `slice7-features-${randomUUID()}.jsonl`);
  await fs.writeFile(
    tmpJsonl,
    rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''),
    'utf8'
  );
  const jsonPath = tmpJsonl.replace(/\\/g, '/');
  const pqPath = parquetPath.replace(/\\/g, '/');

  const instance = await duckdb.DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    const sourceSql =
      `read_ndjson('${jsonPath}', columns={` +
      PLAYER_GAME_FEATURE_COLUMNS.map((c) => `${c}:'VARCHAR'`).join(',') +
      `}, format='newline_delimited')`;

    const selectSql = `SELECT
      CAST(season AS VARCHAR) AS season,
      CAST(game_id AS VARCHAR) AS game_id,
      TRY_CAST(game_date AS DATE) AS game_date,
      CAST(player_id AS VARCHAR) AS player_id,
      CAST(player_name AS VARCHAR) AS player_name,
      CAST(team_id AS VARCHAR) AS team_id,
      CAST(team_abbr AS VARCHAR) AS team_abbr,
      CAST(opponent_team_id AS VARCHAR) AS opponent_team_id,
      CAST(opponent_abbr AS VARCHAR) AS opponent_abbr,
      TRY_CAST(prior_games AS BIGINT) AS prior_games,
      TRY_CAST(points_season_avg_before_game AS DOUBLE) AS points_season_avg_before_game,
      TRY_CAST(points_l5_avg_before_game AS DOUBLE) AS points_l5_avg_before_game,
      TRY_CAST(points_l10_avg_before_game AS DOUBLE) AS points_l10_avg_before_game,
      TRY_CAST(rebounds_season_avg_before_game AS DOUBLE) AS rebounds_season_avg_before_game,
      TRY_CAST(rebounds_l5_avg_before_game AS DOUBLE) AS rebounds_l5_avg_before_game,
      TRY_CAST(rebounds_l10_avg_before_game AS DOUBLE) AS rebounds_l10_avg_before_game,
      TRY_CAST(assists_season_avg_before_game AS DOUBLE) AS assists_season_avg_before_game,
      TRY_CAST(assists_l5_avg_before_game AS DOUBLE) AS assists_l5_avg_before_game,
      TRY_CAST(assists_l10_avg_before_game AS DOUBLE) AS assists_l10_avg_before_game,
      TRY_CAST(threes_season_avg_before_game AS DOUBLE) AS threes_season_avg_before_game,
      TRY_CAST(threes_l5_avg_before_game AS DOUBLE) AS threes_l5_avg_before_game,
      TRY_CAST(threes_l10_avg_before_game AS DOUBLE) AS threes_l10_avg_before_game,
      TRY_CAST(pra_season_avg_before_game AS DOUBLE) AS pra_season_avg_before_game,
      TRY_CAST(pra_l5_avg_before_game AS DOUBLE) AS pra_l5_avg_before_game,
      TRY_CAST(pra_l10_avg_before_game AS DOUBLE) AS pra_l10_avg_before_game,
      TRY_CAST(minutes_l5_avg_before_game AS DOUBLE) AS minutes_l5_avg_before_game,
      TRY_CAST(minutes_l10_avg_before_game AS DOUBLE) AS minutes_l10_avg_before_game,
      TRY_CAST(actual_points AS DOUBLE) AS actual_points,
      TRY_CAST(actual_rebounds AS DOUBLE) AS actual_rebounds,
      TRY_CAST(actual_assists AS DOUBLE) AS actual_assists,
      TRY_CAST(actual_threes AS DOUBLE) AS actual_threes,
      TRY_CAST(actual_pra AS DOUBLE) AS actual_pra
      FROM ${sourceSql}`;

    await conn.run(`COPY (${selectSql}) TO '${pqPath}' (FORMAT PARQUET, COMPRESSION ZSTD)`);
  } finally {
    conn.closeSync();
    instance.closeSync();
    await fs.unlink(tmpJsonl).catch(() => {});
  }
}

function calcDateRange(features: PlayerGameFeature[]): { from: string | null; to: string | null } {
  if (!features.length) return { from: null, to: null };
  return { from: features[0].game_date, to: features[features.length - 1].game_date };
}

function groupByDt(features: PlayerGameFeature[]): Map<string, PlayerGameFeature[]> {
  const out = new Map<string, PlayerGameFeature[]>();
  for (const f of features) {
    if (!out.has(f.game_date)) out.set(f.game_date, []);
    out.get(f.game_date)!.push(f);
  }
  return out;
}

function computeNullStats(features: PlayerGameFeature[]): {
  nullCounts: Record<KeyFeatureColumn, number>;
  nullRates: Record<KeyFeatureColumn, number>;
} {
  const nullCounts = Object.fromEntries(KEY_FEATURE_COLUMNS.map((k) => [k, 0])) as Record<
    KeyFeatureColumn,
    number
  >;
  for (const f of features) {
    for (const c of KEY_FEATURE_COLUMNS) {
      if (f[c] == null) nullCounts[c] += 1;
    }
  }
  const total = features.length || 1;
  const nullRates = Object.fromEntries(
    KEY_FEATURE_COLUMNS.map((c) => [c, nullCounts[c] / total])
  ) as Record<KeyFeatureColumn, number>;
  return { nullCounts, nullRates };
}

function manualNoLookaheadCheck(features: PlayerGameFeature[]): ManualCheckResult {
  const tolerance = 1e-9;
  const byPlayer = new Map<string, PlayerGameFeature[]>();
  for (const f of features) {
    if (!byPlayer.has(f.player_id)) byPlayer.set(f.player_id, []);
    byPlayer.get(f.player_id)!.push(f);
  }
  const eligible = [...byPlayer.entries()].find(([, rows]) => rows.length >= 12);
  if (!eligible) {
    return {
      status: 'failed',
      playerId: '',
      gameId: '',
      gameDate: '',
      priorGameIdsUsedL5: [],
      priorGameIdsUsedL10: [],
      manual: { l5: null, l10: null },
      emitted: { l5: null, l10: null },
      tolerance,
      error: 'No player with >= 12 games found for manual check.',
    };
  }

  const [playerId, rows] = eligible;
  rows.sort((a, b) => (a.game_date === b.game_date ? (a.game_id < b.game_id ? -1 : 1) : a.game_date < b.game_date ? -1 : 1));
  const idx = 11;
  const target = rows[idx];
  const prior = rows.slice(0, idx);
  const l5Games = prior.slice(-5);
  const l10Games = prior.slice(-10);
  const l5 = mean(l5Games.map((r) => r.actual_points).filter((x): x is number => x != null));
  const l10 = mean(l10Games.map((r) => r.actual_points).filter((x): x is number => x != null));
  const emittedL5 = target.points_l5_avg_before_game;
  const emittedL10 = target.points_l10_avg_before_game;
  const ok =
    Math.abs((l5 ?? 0) - (emittedL5 ?? 0)) <= tolerance &&
    Math.abs((l10 ?? 0) - (emittedL10 ?? 0)) <= tolerance;

  return {
    status: ok ? 'passed' : 'failed',
    playerId,
    gameId: target.game_id,
    gameDate: target.game_date,
    priorGameIdsUsedL5: l5Games.map((r) => r.game_id),
    priorGameIdsUsedL10: l10Games.map((r) => r.game_id),
    manual: { l5, l10 },
    emitted: { l5: emittedL5, l10: emittedL10 },
    tolerance,
    error: ok ? undefined : 'Manual prior-games-only L5/L10 points mismatch.',
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const bucket = requireEnv('NBA_DATA_BUCKET');
  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  const inputPrefix = curatedLogsPrefix(args.season);
  const inputGamesPrefix = curatedGamesPrefix(args.season);
  const outputPrefix = featuresPrefix(args.season);
  const manifestKey = `${outputPrefix}/_manifest.json`;

  console.log('=== Slice 7 Build: player_game_features_v1 ===');
  console.log(`  season        : ${args.season}`);
  console.log(`  inputLogs     : s3://${bucket}/${inputPrefix}/`);
  console.log(`  inputGamesOpt : s3://${bucket}/${inputGamesPrefix}/`);
  console.log(`  outputPrefix  : s3://${bucket}/${outputPrefix}/`);
  console.log(`  dryRun        : ${args.dryRun}`);
  console.log(`  overwrite     : ${args.overwrite}`);

  await ensureDuckdbAvailable();
  const s3 = new S3Storage({ bucket, region });
  const s3Client = new S3Client({ region });

  const logsDts = await listPartitionDates(s3, inputPrefix);
  if (logsDts.length === 0) fatal('No curated player_game_logs partitions found.');
  const selected = args.partitions ? logsDts.filter((d) => args.partitions!.includes(d)) : logsDts;
  if (selected.length === 0) fatal('No partitions match --partitions.');
  console.log(`  selected dt partitions: ${selected.length}`);

  const tmpRoot = path.join(os.tmpdir(), `slice7-${randomUUID()}`);
  const tmpLogs = path.join(tmpRoot, 'logs');
  const tmpGames = path.join(tmpRoot, 'games');
  await fs.mkdir(tmpLogs, { recursive: true });
  await fs.mkdir(tmpGames, { recursive: true });

  const downloadedLogs = await downloadParquetSet({
    s3,
    s3Client,
    bucket,
    sourcePrefix: inputPrefix,
    targetDir: tmpLogs,
    selectedDts: selected,
  });
  // Optional sanity input (not used for feature math).
  const downloadedGames = await downloadParquetSet({
    s3,
    s3Client,
    bucket,
    sourcePrefix: inputGamesPrefix,
    targetDir: tmpGames,
    selectedDts: null,
  });
  console.log(`  downloaded logs parquet files : ${downloadedLogs.localPaths.length}`);
  console.log(`  downloaded games parquet files: ${downloadedGames.localPaths.length}`);

  if (downloadedLogs.localPaths.length === 0) fatal('No local curated player logs files downloaded.');

  const instance = await duckdb.DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  let features: PlayerGameFeature[] = [];
  let duplicateRowsDropped = 0;
  let crossPartitionDuplicateKeysDetected = 0;
  try {
    const logsGlob = path.join(tmpLogs, '*.parquet').replace(/\\/g, '/');
    const reader = await conn.runAndReadAll(`
      SELECT
        CAST(season AS VARCHAR) AS season,
        CAST(game_id AS VARCHAR) AS game_id,
        CAST(game_date AS VARCHAR) AS game_date,
        CAST(player_id AS VARCHAR) AS player_id,
        CAST(player_name AS VARCHAR) AS player_name,
        CAST(team_id AS VARCHAR) AS team_id,
        CAST(team_abbr AS VARCHAR) AS team_abbr,
        CAST(opponent_team_id AS VARCHAR) AS opponent_team_id,
        CAST(opponent_abbr AS VARCHAR) AS opponent_abbr,
        TRY_CAST(minutes AS DOUBLE) AS minutes,
        TRY_CAST(points AS DOUBLE) AS points,
        TRY_CAST(rebounds AS DOUBLE) AS rebounds,
        TRY_CAST(assists AS DOUBLE) AS assists,
        TRY_CAST(threes AS DOUBLE) AS threes,
        TRY_CAST(pra AS DOUBLE) AS pra
      FROM read_parquet('${logsGlob}')
      ORDER BY player_id, game_date, game_id
    `);
    const rows = (await reader.getRows()) as Array<
      [string | null, string | null, string | null, string | null, string | null, string | null, string | null, string | null, string | null, number | null, number | null, number | null, number | null, number | null, number | null]
    >;

    const mapped: CuratedPlayerLogRow[] = rows.map((r) => ({
      season: r[0],
      game_id: r[1],
      game_date: r[2],
      player_id: r[3],
      player_name: r[4],
      team_id: r[5],
      team_abbr: r[6],
      opponent_team_id: r[7],
      opponent_abbr: r[8],
      minutes: r[9],
      points: r[10],
      rebounds: r[11],
      assists: r[12],
      threes: r[13],
      pra: r[14],
    }));

    const built = buildFeaturesFromRows(mapped, args.season);
    features = built.features;
    duplicateRowsDropped = built.duplicateRowsDropped;
    crossPartitionDuplicateKeysDetected = built.crossPartitionDuplicateKeysDetected;
  } finally {
    conn.closeSync();
    instance.closeSync();
  }

  const dateRange = calcDateRange(features);
  const byDt = groupByDt(features);
  const partitions = [...byDt.keys()].sort();
  const outputSummaries: {
    dt: string;
    outputKey: string;
    rowsWritten: number;
    skipped: boolean;
    skipReason?: 'exists' | 'dry-run';
  }[] = [];

  for (const dt of partitions) {
    const outputKey = `${outputPrefix}/dt=${dt}/data.parquet`;
    const rows = byDt.get(dt)!;
    if (args.dryRun) {
      console.log(`  [dry-run] would write ${outputKey} (${rows.length} rows)`);
      outputSummaries.push({ dt, outputKey, rowsWritten: 0, skipped: true, skipReason: 'dry-run' });
      continue;
    }
    if (!args.overwrite && (await s3.objectExists(outputKey))) {
      console.log(`  [skip-existing] ${outputKey}`);
      outputSummaries.push({ dt, outputKey, rowsWritten: 0, skipped: true, skipReason: 'exists' });
      continue;
    }
    const tmpPq = path.join(os.tmpdir(), `slice7-features-${dt}-${randomUUID()}.parquet`);
    await writeFeaturesPartitionParquet({ rows, parquetPath: tmpPq });
    const bytes = await fs.readFile(tmpPq);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: outputKey,
        Body: bytes,
        ContentType: 'application/octet-stream',
      })
    );
    await fs.unlink(tmpPq).catch(() => {});
    console.log(`  [wrote] ${outputKey} (${rows.length} rows)`);
    outputSummaries.push({ dt, outputKey, rowsWritten: rows.length, skipped: false });
  }

  if (args.dryRun) {
    console.log('\n[dry-run] completed with no writes.');
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    return;
  }

  // Read-back validation on written output
  const tmpOut = path.join(tmpRoot, 'out');
  await fs.mkdir(tmpOut, { recursive: true });
  const outDownloaded = await downloadParquetSet({
    s3,
    s3Client,
    bucket,
    sourcePrefix: outputPrefix,
    targetDir: tmpOut,
    selectedDts: null,
  });
  const outGlob = path.join(tmpOut, '*.parquet').replace(/\\/g, '/');
  const vInst = await duckdb.DuckDBInstance.create(':memory:');
  const vConn = await vInst.connect();
  let actualRowCount = 0;
  let actualDateRange = { from: null as string | null, to: null as string | null };
  let duplicateKeyCount = 0;
  let sampleRows: PlayerGameFeature[] = [];
  try {
    const rowCountReader = await vConn.runAndReadAll(
      `SELECT COUNT(*)::BIGINT FROM read_parquet('${outGlob}')`
    );
    actualRowCount = Number((await rowCountReader.getRows())[0]?.[0] ?? 0);

    const rangeReader = await vConn.runAndReadAll(
      `SELECT MIN(CAST(game_date AS VARCHAR)), MAX(CAST(game_date AS VARCHAR))
       FROM read_parquet('${outGlob}')`
    );
    const rr = await rangeReader.getRows();
    actualDateRange = { from: (rr[0]?.[0] as string | null) ?? null, to: (rr[0]?.[1] as string | null) ?? null };

    const dupReader = await vConn.runAndReadAll(
      `SELECT COUNT(*)::BIGINT
       FROM (
         SELECT player_id, game_id, COUNT(*) AS c
         FROM read_parquet('${outGlob}')
         GROUP BY 1,2
         HAVING COUNT(*) > 1
       )`
    );
    duplicateKeyCount = Number((await dupReader.getRows())[0]?.[0] ?? 0);

    const sampleReader = await vConn.runAndReadAll(
      `SELECT
        season, game_id, CAST(game_date AS VARCHAR), player_id, player_name, team_id, team_abbr,
        opponent_team_id, opponent_abbr, prior_games,
        points_season_avg_before_game, points_l5_avg_before_game, points_l10_avg_before_game,
        rebounds_season_avg_before_game, rebounds_l5_avg_before_game, rebounds_l10_avg_before_game,
        assists_season_avg_before_game, assists_l5_avg_before_game, assists_l10_avg_before_game,
        threes_season_avg_before_game, threes_l5_avg_before_game, threes_l10_avg_before_game,
        pra_season_avg_before_game, pra_l5_avg_before_game, pra_l10_avg_before_game,
        minutes_l5_avg_before_game, minutes_l10_avg_before_game,
        actual_points, actual_rebounds, actual_assists, actual_threes, actual_pra
       FROM read_parquet('${outGlob}')
       ORDER BY game_date, player_id, game_id
       LIMIT 3`
    );
    const srows = (await sampleReader.getRows()) as Array<any[]>;
    sampleRows = srows.map((r) => ({
      season: r[0],
      game_id: r[1],
      game_date: r[2],
      player_id: r[3],
      player_name: r[4],
      team_id: r[5],
      team_abbr: r[6],
      opponent_team_id: r[7],
      opponent_abbr: r[8],
      prior_games: Number(r[9] ?? 0),
      points_season_avg_before_game: toNum(r[10]),
      points_l5_avg_before_game: toNum(r[11]),
      points_l10_avg_before_game: toNum(r[12]),
      rebounds_season_avg_before_game: toNum(r[13]),
      rebounds_l5_avg_before_game: toNum(r[14]),
      rebounds_l10_avg_before_game: toNum(r[15]),
      assists_season_avg_before_game: toNum(r[16]),
      assists_l5_avg_before_game: toNum(r[17]),
      assists_l10_avg_before_game: toNum(r[18]),
      threes_season_avg_before_game: toNum(r[19]),
      threes_l5_avg_before_game: toNum(r[20]),
      threes_l10_avg_before_game: toNum(r[21]),
      pra_season_avg_before_game: toNum(r[22]),
      pra_l5_avg_before_game: toNum(r[23]),
      pra_l10_avg_before_game: toNum(r[24]),
      minutes_l5_avg_before_game: toNum(r[25]),
      minutes_l10_avg_before_game: toNum(r[26]),
      actual_points: toNum(r[27]),
      actual_rebounds: toNum(r[28]),
      actual_assists: toNum(r[29]),
      actual_threes: toNum(r[30]),
      actual_pra: toNum(r[31]),
    }));
  } finally {
    vConn.closeSync();
    vInst.closeSync();
  }

  const manual = manualNoLookaheadCheck(features);
  console.log('\n[manual-check]');
  console.log(`  playerId: ${manual.playerId}`);
  console.log(`  target: ${manual.gameDate} / ${manual.gameId}`);
  console.log(`  priorGameIdsUsedL5: ${manual.priorGameIdsUsedL5.join(',')}`);
  console.log(`  priorGameIdsUsedL10: ${manual.priorGameIdsUsedL10.join(',')}`);
  console.log(`  manual L5/L10: ${manual.manual.l5} / ${manual.manual.l10}`);
  console.log(`  emitted L5/L10: ${manual.emitted.l5} / ${manual.emitted.l10}`);
  if (manual.status === 'failed') fatal(`Manual no-lookahead check failed: ${manual.error}`);

  const { nullCounts, nullRates } = computeNullStats(features);
  const validationStatus =
    manual.status === 'passed' &&
    actualRowCount === features.length &&
    duplicateKeyCount === 0
      ? 'passed'
      : 'failed';

  const manifest: Manifest = {
    schemaVersion: 1,
    featureVersion: FEATURE_VERSION,
    source: 'existing_ingestion',
    inputPrefix,
    outputPrefix,
    season: args.season,
    entity: 'player_game_features',
    rowCount: features.length,
    dateRange,
    partitions: outputSummaries,
    duplicateRowsDropped,
    crossPartitionDuplicateKeysDetected: crossPartitionDuplicateKeysDetected,
    nullCounts,
    nullRates,
    validationStatus,
    validation: {
      rowCountCheck: {
        expected: features.length,
        actual: actualRowCount,
        status: features.length === actualRowCount ? 'passed' : 'failed',
      },
      dateRangeCheck: {
        expected: dateRange,
        actual: actualDateRange,
        status:
          dateRange.from === actualDateRange.from && dateRange.to === actualDateRange.to
            ? 'passed'
            : 'failed',
      },
      duplicateKeyCount,
      partitionCountCheck: {
        expected: partitions.length,
        actual: outDownloaded.localPaths.length,
        status: partitions.length === outDownloaded.localPaths.length ? 'passed' : 'failed',
      },
      sampleRows,
      manualCheck: manual,
    },
    generatedAt: new Date().toISOString(),
    status: validationStatus === 'passed' ? 'success' : 'error',
  };

  await s3.putJson(manifestKey, manifest, { overwrite: true });
  console.log(`\n[manifest] ${manifestKey}`);
  console.log('\n=== Summary ===');
  console.log(`  rowCount                     : ${manifest.rowCount}`);
  console.log(`  dateRange                    : ${manifest.dateRange.from} -> ${manifest.dateRange.to}`);
  console.log(`  duplicateRowsDropped         : ${manifest.duplicateRowsDropped}`);
  console.log(`  crossPartitionDuplicateKeys  : ${manifest.crossPartitionDuplicateKeysDetected}`);
  console.log(`  nullCounts                   : ${JSON.stringify(manifest.nullCounts)}`);
  console.log(`  validationStatus             : ${manifest.validationStatus}`);

  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
}

main().catch((err) => {
  console.error('[fatal] unhandled error:', err);
  process.exit(1);
});
