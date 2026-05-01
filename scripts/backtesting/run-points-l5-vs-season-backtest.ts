/**
 * Slice 9: Minimal parquet-backed backtest — L5 vs season points edge vs synthetic line.
 *
 * Reads features/.../entity=player_game_features/dt=YYYY-MM-DD/data.parquet
 * from S3 (NBA_DATA_BUCKET). No ingestion / feature pipeline changes.
 *
 * Writes (Slice 11):
 *   backtests/league=nba/season=<S>/strategy=points_l5_vs_season_v1/threshold=<T>/results.jsonl
 *   .../threshold=<T>/_manifest.json
 *
 * Usage:
 *   npx tsx scripts/backtesting/run-points-l5-vs-season-backtest.ts --season=2023
 *   npx tsx scripts/backtesting/run-points-l5-vs-season-backtest.ts --season=2023 --threshold=3 --dry-run
 *   npx tsx scripts/backtesting/run-points-l5-vs-season-backtest.ts --season=2023 --overwrite
 *
 * Env: NBA_DATA_BUCKET, AWS credentials as usual.
 */

import 'dotenv/config';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import duckdb from '@duckdb/node-api';
import { S3Storage } from '@/lib/aws/s3';
import type { BacktestManifest, BacktestResult, BacktestSummary } from '@/lib/backtesting/backtest-types';
import {
  evaluatePointsL5VsSeasonSignal,
  gradeOverPointsSignal,
  STRATEGY_NAME,
  STRATEGY_VERSION,
} from '@/lib/backtesting/points-l5-vs-season-strategy';

const MIN_PRIOR_GAMES = 5;

type CliArgs = {
  season: number;
  threshold: number;
  dryRun: boolean;
  overwrite: boolean;
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

  const seasonRaw = flags['season'];
  if (typeof seasonRaw !== 'string' || !/^\d{4}$/.test(seasonRaw)) {
    fatal('Missing or invalid --season=<YYYY>. Example: --season=2023.');
  }
  const season = Number(seasonRaw);

  const thRaw = flags['threshold'];
  const threshold =
    typeof thRaw === 'string' && thRaw.length > 0 ? Number(thRaw) : typeof thRaw === 'number' ? thRaw : 3;
  if (!Number.isFinite(threshold)) fatal('Invalid --threshold (expected a number).');

  return {
    season,
    threshold,
    dryRun: flags['dry-run'] === true,
    overwrite: flags['overwrite'] === true,
  };
}

function featureInputPrefix(season: number): string {
  return `features/league=nba/season=${season}/entity=player_game_features`;
}

/** Slice 11: threshold-scoped outputs (legacy flat path still readable by report for threshold=3). */
function backtestOutputPrefix(season: number, threshold: number): string {
  return `backtests/league=nba/season=${season}/strategy=points_l5_vs_season_v1/threshold=${threshold}`;
}

async function downloadFeatureParquets(args: {
  s3: S3Storage;
  s3Client: S3Client;
  bucket: string;
  sourcePrefix: string;
  targetDir: string;
}): Promise<string[]> {
  const { s3, s3Client, bucket, sourcePrefix, targetDir } = args;
  const localPaths: string[] = [];
  for await (const obj of s3.listByPrefix(sourcePrefix)) {
    const m = obj.key.match(/\/dt=(\d{4}-\d{2}-\d{2})\/data\.parquet$/);
    if (!m) continue;
    const local = path.join(targetDir, `dt=${m[1]}.parquet`);
    const got = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: obj.key }));
    if (!got.Body) continue;
    const bytes = Buffer.from(await got.Body.transformToByteArray());
    await fs.writeFile(local, bytes);
    localPaths.push(local);
  }
  return localPaths.sort();
}

type RawFeatureRow = {
  season: string | null;
  game_id: string | null;
  game_date: string | null;
  player_id: string | null;
  prior_games: number | null;
  points_season_avg_before_game: number | null;
  points_l5_avg_before_game: number | null;
  actual_points: number | null;
};

async function loadFeatureRowsFromParquet(parquetPaths: string[]): Promise<RawFeatureRow[]> {
  if (parquetPaths.length === 0) return [];
  const quotedList = parquetPaths
    .map((p) => `'${p.replace(/\\/g, '/').replace(/'/g, "''")}'`)
    .join(', ');
  const instance = await duckdb.DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    const reader = await conn.runAndReadAll(`
      SELECT
        CAST(season AS VARCHAR) AS season,
        CAST(game_id AS VARCHAR) AS game_id,
        CAST(game_date AS VARCHAR) AS game_date,
        CAST(player_id AS VARCHAR) AS player_id,
        TRY_CAST(prior_games AS BIGINT) AS prior_games,
        TRY_CAST(points_season_avg_before_game AS DOUBLE) AS points_season_avg_before_game,
        TRY_CAST(points_l5_avg_before_game AS DOUBLE) AS points_l5_avg_before_game,
        TRY_CAST(actual_points AS DOUBLE) AS actual_points
      FROM read_parquet([${quotedList}])
      ORDER BY game_date, player_id, game_id
    `);
    const rows = (await reader.getRows()) as Array<
      [string | null, string | null, string | null, string | null, bigint | number | null, number | null, number | null, number | null]
    >;
    return rows.map((r) => ({
      season: r[0],
      game_id: r[1],
      game_date: r[2],
      player_id: r[3],
      prior_games: r[4] == null ? null : Number(r[4]),
      points_season_avg_before_game: r[5],
      points_l5_avg_before_game: r[6],
      actual_points: r[7],
    }));
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

function emptySkipped(): BacktestSummary['skippedReasons'] {
  return { insufficient_prior_games: 0, missing_feature_values: 0, no_signal: 0 };
}

function addSkipped(acc: BacktestSummary['skippedReasons'], delta: BacktestSummary['skippedReasons']) {
  acc.insufficient_prior_games += delta.insufficient_prior_games;
  acc.missing_feature_values += delta.missing_feature_values;
  acc.no_signal += delta.no_signal;
}

function printSummary(summary: BacktestSummary, manifestBase: Omit<BacktestManifest, 'createdAt' | 'status'>) {
  console.log(JSON.stringify({ ...manifestBase, ...summary }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bucket = requireEnv('NBA_DATA_BUCKET');
  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  const s3Client = new S3Client({ region });
  const s3 = new S3Storage({ bucket, client: s3Client });

  const inputPrefix = featureInputPrefix(args.season);
  const outputPrefix = backtestOutputPrefix(args.season, args.threshold);
  const manifestKey = `${outputPrefix}/_manifest.json`;
  const resultsKey = `${outputPrefix}/results.jsonl`;

  if (!args.dryRun && !args.overwrite && (await s3.objectExists(manifestKey))) {
    console.error(
      `[skip] ${manifestKey} already exists. Pass --overwrite to replace outputs, or use --dry-run.`
    );
    process.exit(0);
  }

  const tmpDir = path.join(os.tmpdir(), `slice9-backtest-${randomUUID()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  let paths: string[] = [];
  try {
    paths = await downloadFeatureParquets({
      s3,
      s3Client,
      bucket,
      sourcePrefix: inputPrefix,
      targetDir: tmpDir,
    });
  } catch (e) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw e;
  }

  if (paths.length === 0) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    fatal(`No feature parquet files under s3://${bucket}/${inputPrefix}/`);
  }

  console.error(`[info] downloaded ${paths.length} parquet file(s) from s3://${bucket}/${inputPrefix}/`);

  const rawRows = await loadFeatureRowsFromParquet(paths);
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

  const skippedReasons = emptySkipped();
  const results: BacktestResult[] = [];
  let sumEdge = 0;
  let sumMargin = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;

  for (const raw of rawRows) {
    const seasonStr = raw.season?.trim() || String(args.season);
    const gameId = raw.game_id?.trim();
    const gameDate = raw.game_date?.trim();
    const playerId = raw.player_id?.trim();
    if (!gameId || !gameDate || !playerId) {
      addSkipped(skippedReasons, {
        insufficient_prior_games: 0,
        missing_feature_values: 1,
        no_signal: 0,
      });
      continue;
    }

    const prior = raw.prior_games ?? 0;
    if (prior < MIN_PRIOR_GAMES) {
      addSkipped(skippedReasons, {
        insufficient_prior_games: 1,
        missing_feature_values: 0,
        no_signal: 0,
      });
      continue;
    }

    const seasonAvg = raw.points_season_avg_before_game;
    const l5 = raw.points_l5_avg_before_game;
    if (seasonAvg == null || l5 == null) {
      addSkipped(skippedReasons, {
        insufficient_prior_games: 0,
        missing_feature_values: 1,
        no_signal: 0,
      });
      continue;
    }

    if (l5 - seasonAvg < args.threshold) {
      addSkipped(skippedReasons, {
        insufficient_prior_games: 0,
        missing_feature_values: 0,
        no_signal: 1,
      });
      continue;
    }

    const signal = evaluatePointsL5VsSeasonSignal({
      row: {
        prior_games: prior,
        points_season_avg_before_game: seasonAvg,
        points_l5_avg_before_game: l5,
        actual_points: raw.actual_points,
        season: seasonStr,
        player_id: playerId,
        game_id: gameId,
        game_date: gameDate,
      },
      config: {
        season: args.season,
        threshold: args.threshold,
        minPriorGames: MIN_PRIOR_GAMES,
      },
    });

    if (!signal) {
      fatal('evaluatePointsL5VsSeasonSignal returned null after prechecks; logic bug.');
    }

    const ap = raw.actual_points;
    if (ap == null || !Number.isFinite(ap)) {
      addSkipped(skippedReasons, {
        insufficient_prior_games: 0,
        missing_feature_values: 1,
        no_signal: 0,
      });
      continue;
    }

    const outcome = gradeOverPointsSignal(signal, ap);
    if (outcome === 'win') wins += 1;
    else if (outcome === 'loss') losses += 1;
    else pushes += 1;

    sumEdge += signal.edge;
    sumMargin += ap - signal.syntheticLine;

    results.push({
      ...signal,
      actual_points: ap,
      outcome,
    });
  }

  const rowsScanned = rawRows.length;
  const signalsGenerated = results.length;
  const skippedRows =
    skippedReasons.insufficient_prior_games +
    skippedReasons.missing_feature_values +
    skippedReasons.no_signal;

  if (rowsScanned !== signalsGenerated + skippedRows) {
    fatal(
      `Internal manifest mismatch: rowsScanned=${rowsScanned} signals=${signalsGenerated} skipped=${skippedRows}`
    );
  }

  const winRate = signalsGenerated > 0 ? wins / signalsGenerated : null;
  const averageEdge = signalsGenerated > 0 ? sumEdge / signalsGenerated : null;
  const averageActualMargin = signalsGenerated > 0 ? sumMargin / signalsGenerated : null;

  const summary: BacktestSummary = {
    rowsScanned,
    signalsGenerated,
    wins,
    losses,
    pushes,
    winRate,
    averageEdge,
    averageActualMargin,
    skippedRows,
    skippedReasons: { ...skippedReasons },
  };

  const manifestBase: Omit<BacktestManifest, 'createdAt' | 'status'> = {
    strategyName: STRATEGY_NAME,
    strategyVersion: STRATEGY_VERSION,
    season: args.season,
    threshold: args.threshold,
    inputFeaturePrefix: inputPrefix,
    outputPrefix,
    rowsScanned: summary.rowsScanned,
    signalsGenerated: summary.signalsGenerated,
    wins: summary.wins,
    losses: summary.losses,
    pushes: summary.pushes,
    winRate: summary.winRate,
    averageEdge: summary.averageEdge,
    averageActualMargin: summary.averageActualMargin,
    skippedRows: summary.skippedRows,
    skippedReasons: summary.skippedReasons,
  };

  if (args.dryRun) {
    const dryManifest: BacktestManifest = {
      ...manifestBase,
      createdAt: new Date().toISOString(),
      status: 'dry-run',
    };
    console.log(JSON.stringify(dryManifest, null, 2));
    console.error('[dry-run] summary printed above; no S3 writes.');
    return;
  }

  const wr = await s3.putJsonLines(resultsKey, results, { overwrite: args.overwrite });
  if (!wr.written && wr.reason === 'exists') {
    fatal(`Refusing to overwrite ${resultsKey} without --overwrite.`);
  }

  const manifest: BacktestManifest = {
    ...manifestBase,
    createdAt: new Date().toISOString(),
    status: 'success',
  };
  const wm = await s3.putJson(`${outputPrefix}/_manifest.json`, manifest, { overwrite: args.overwrite });
  if (!wm.written && wm.reason === 'exists') {
    fatal(`Refusing to overwrite ${manifestKey} without --overwrite.`);
  }

  printSummary(summary, manifestBase);
  console.error(`[ok] wrote s3://${bucket}/${resultsKey} (${results.length} lines)`);
  console.error(`[ok] wrote s3://${bucket}/${manifestKey}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
