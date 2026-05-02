import 'dotenv/config';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import duckdb from '@duckdb/node-api';
import { S3Storage } from '@/lib/aws/s3';
import {
  buildProxyTarget,
  computeDeltaFeatures,
  rankFeatureScores,
  renderFeatureRankingMarkdownReport,
  scoreFeature,
} from '@/lib/research/feature-ranking';

type CliArgs = {
  season: number;
  dryRun: boolean;
};

const OPTIONAL_CANDIDATE_FEATURES = [
  'prior_games',
  'points_season_avg_before_game',
  'points_l3_avg_before_game',
  'points_l5_avg_before_game',
  'points_l10_avg_before_game',
  'minutes_l5_avg_before_game',
  'minutes_l10_avg_before_game',
  'points_l10_stddev_before_game',
  'hit_rate_above_season_avg_l10',
] as const;

const DELTA_FEATURES = [
  'points_l5_minus_season_avg',
  'points_l10_minus_season_avg',
  'minutes_l5_minus_l10_avg',
] as const;

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
  const seasonRaw =
    typeof flags.season === 'string'
      ? flags.season
      : typeof process.env.npm_config_season === 'string'
        ? process.env.npm_config_season
        : undefined;
  if (typeof seasonRaw !== 'string' || !/^\d{4}$/.test(seasonRaw)) {
    fatal('Missing or invalid --season=<YYYY>. Example: --season=2024');
  }
  const dryRunFromNpmConfig =
    process.env.npm_config_dry_run === 'true' || process.env.npm_config_dryrun === 'true';
  return {
    season: Number(seasonRaw),
    dryRun: flags['dry-run'] === true || dryRunFromNpmConfig,
  };
}

function featureInputPrefix(season: number): string {
  return `features/league=nba/season=${season}/entity=player_game_features`;
}

function reportOutputPrefix(season: number): string {
  return `research/feature-selection/league=nba/target=score_above_season_avg/season=${season}`;
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

async function listParquetColumns(parquetPaths: string[]): Promise<Set<string>> {
  if (parquetPaths.length === 0) return new Set();
  const quotedList = parquetPaths
    .map((p) => `'${p.replace(/\\/g, '/').replace(/'/g, "''")}'`)
    .join(', ');
  const instance = await duckdb.DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    const reader = await conn.runAndReadAll(`SELECT * FROM read_parquet([${quotedList}]) LIMIT 0`);
    const names = reader.columnNames().map((n) => String(n));
    return new Set(names);
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

function selectClauseForColumn(column: string): string {
  return `TRY_CAST(${column} AS DOUBLE) AS ${column}`;
}

async function loadRows(parquetPaths: string[], availableColumns: Set<string>): Promise<Record<string, unknown>[]> {
  if (parquetPaths.length === 0) return [];
  const quotedList = parquetPaths
    .map((p) => `'${p.replace(/\\/g, '/').replace(/'/g, "''")}'`)
    .join(', ');

  const selectedOptional = OPTIONAL_CANDIDATE_FEATURES.filter((c) => availableColumns.has(c));
  const projection = [
    'TRY_CAST(actual_points AS DOUBLE) AS actual_points',
    'TRY_CAST(points_season_avg_before_game AS DOUBLE) AS points_season_avg_before_game',
    ...selectedOptional.map(selectClauseForColumn),
  ].join(',\n        ');

  const instance = await duckdb.DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    const reader = await conn.runAndReadAll(`
      SELECT
        ${projection}
      FROM read_parquet([${quotedList}])
    `);
    return (await reader.getRowObjectsJS()) as Record<string, unknown>[];
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bucket = requireEnv('NBA_DATA_BUCKET');
  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  const s3Client = new S3Client({ region });
  const s3 = new S3Storage({ bucket, client: s3Client });

  const inputPrefix = featureInputPrefix(args.season);
  const outputPrefix = reportOutputPrefix(args.season);
  const jsonKey = `${outputPrefix}/feature_scores.json`;
  const mdKey = `${outputPrefix}/report.md`;

  console.log(`season=${args.season}`);
  console.log(`input=s3://${bucket}/${inputPrefix}/`);
  console.log(`output_json=s3://${bucket}/${jsonKey}`);
  console.log(`output_md=s3://${bucket}/${mdKey}`);

  const tmpDir = path.join(os.tmpdir(), `feature-ranking-${randomUUID()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  const parquetPaths = await downloadFeatureParquets({
    s3,
    s3Client,
    bucket,
    sourcePrefix: inputPrefix,
    targetDir: tmpDir,
  });
  if (parquetPaths.length === 0) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    fatal(`No feature parquet files under s3://${bucket}/${inputPrefix}/`);
  }

  const availableColumns = await listParquetColumns(parquetPaths);
  if (!availableColumns.has('actual_points') || !availableColumns.has('points_season_avg_before_game')) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    fatal('Input parquet is missing required columns: actual_points and/or points_season_avg_before_game');
  }

  const rawRows = await loadRows(parquetPaths, availableColumns);
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

  const usableRows: Array<Record<string, unknown> & { target_score_above_season_avg: boolean }> = [];
  for (const row of rawRows) {
    const target = buildProxyTarget({
      actual_points: toNullableNumber(row.actual_points),
      points_season_avg_before_game: toNullableNumber(row.points_season_avg_before_game),
    });
    if (target == null) continue;

    const withDeltas = { ...row };
    const deltas = computeDeltaFeatures(withDeltas);
    for (const deltaName of DELTA_FEATURES) {
      if (!(deltaName in withDeltas)) {
        withDeltas[deltaName] = deltas[deltaName];
      }
    }

    usableRows.push({
      ...withDeltas,
      target_score_above_season_avg: target,
    });
  }

  const existingCandidateFeatures = OPTIONAL_CANDIDATE_FEATURES.filter((f) => availableColumns.has(f));
  const featuresToScore = [...existingCandidateFeatures, ...DELTA_FEATURES];
  const rankedScores = rankFeatureScores(
    featuresToScore.map((featureName) => scoreFeature(usableRows, featureName))
  );

  const generatedAt = new Date().toISOString();
  const payload = {
    season: args.season,
    target_definition: 'actual_points > points_season_avg_before_game',
    generated_at: generatedAt,
    input_path: `s3://${bucket}/${inputPrefix}/`,
    output_path: `s3://${bucket}/${outputPrefix}/`,
    total_rows_analyzed: rawRows.length,
    total_usable_rows: usableRows.length,
    features_scored: rankedScores.length,
    feature_scores: rankedScores,
  };

  const markdown = renderFeatureRankingMarkdownReport({
    metadata: {
      season: args.season,
      targetDefinition: 'actual_points > points_season_avg_before_game',
      generatedAt,
      inputPath: `s3://${bucket}/${inputPrefix}/`,
      outputPath: `s3://${bucket}/${outputPrefix}/`,
      totalRowsAnalyzed: rawRows.length,
      totalUsableRows: usableRows.length,
    },
    scores: rankedScores,
  });

  if (args.dryRun) {
    console.log('[dry-run] no report files were written.');
    console.log(
      JSON.stringify(
        {
          season: args.season,
          input_path: payload.input_path,
          output_json: `s3://${bucket}/${jsonKey}`,
          output_md: `s3://${bucket}/${mdKey}`,
          total_rows_analyzed: payload.total_rows_analyzed,
          total_usable_rows: payload.total_usable_rows,
          features_scored: payload.features_scored,
        },
        null,
        2
      )
    );
    return;
  }

  await s3.putText(jsonKey, JSON.stringify(payload, null, 2) + '\n', {
    overwrite: true,
    contentType: 'application/json; charset=utf-8',
  });
  await s3.putText(mdKey, markdown, {
    overwrite: true,
    contentType: 'text/markdown; charset=utf-8',
  });

  console.log(`[ok] wrote s3://${bucket}/${jsonKey}`);
  console.log(`[ok] wrote s3://${bucket}/${mdKey}`);
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
