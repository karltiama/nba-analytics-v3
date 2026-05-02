import 'dotenv/config';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import duckdb from '@duckdb/node-api';
import { S3Storage } from '@/lib/aws/s3';
import {
  enrichProxySweepRow,
  renderProxyStrategySweepMarkdownReport,
  summarizeAllStrategies,
} from '@/lib/research/proxy-strategy-sweep';

type CliArgs = {
  season: number;
  dryRun: boolean;
};

const REQUIRED_COLUMNS = [
  'actual_points',
  'points_season_avg_before_game',
  'prior_games',
  'points_l5_avg_before_game',
  'minutes_l5_avg_before_game',
  'minutes_l10_avg_before_game',
] as const;

const OPTIONAL_COLUMNS = ['points_l5_minus_season_avg', 'minutes_l5_minus_l10_avg'] as const;

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
    fatal('Missing or invalid --season=<YYYY>. Example: --season=2025');
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

function outputPrefix(season: number): string {
  return `research/strategy-sweeps/league=nba/target=score_above_season_avg/season=${season}`;
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
    return new Set(reader.columnNames().map((n) => String(n)));
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

function selectClause(col: string): string {
  return `TRY_CAST(${col} AS DOUBLE) AS ${col}`;
}

async function loadRows(parquetPaths: string[], availableColumns: Set<string>): Promise<Record<string, unknown>[]> {
  if (parquetPaths.length === 0) return [];
  const quotedList = parquetPaths
    .map((p) => `'${p.replace(/\\/g, '/').replace(/'/g, "''")}'`)
    .join(', ');
  const projection = [
    ...REQUIRED_COLUMNS.map(selectClause),
    ...OPTIONAL_COLUMNS.filter((c) => availableColumns.has(c)).map(selectClause),
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

  const input = featureInputPrefix(args.season);
  const out = outputPrefix(args.season);
  const jsonKey = `${out}/results.json`;
  const mdKey = `${out}/report.md`;

  console.log(`season=${args.season}`);
  console.log(`input=s3://${bucket}/${input}/`);
  console.log(`output_json=s3://${bucket}/${jsonKey}`);
  console.log(`output_md=s3://${bucket}/${mdKey}`);

  const tmpDir = path.join(os.tmpdir(), `proxy-strategy-sweep-${randomUUID()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  const parquetPaths = await downloadFeatureParquets({
    s3,
    s3Client,
    bucket,
    sourcePrefix: input,
    targetDir: tmpDir,
  });
  if (parquetPaths.length === 0) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    fatal(`No feature parquet files under s3://${bucket}/${input}/`);
  }

  const columns = await listParquetColumns(parquetPaths);
  const missingRequired = REQUIRED_COLUMNS.filter((c) => !columns.has(c));
  if (missingRequired.length > 0) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    fatal(`Input parquet is missing required columns: ${missingRequired.join(', ')}`);
  }

  const rawRows = await loadRows(parquetPaths, columns);
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

  const rows = rawRows
    .map((r) => enrichProxySweepRow(r))
    .filter((r) => r.actual_points != null && r.points_season_avg_before_game != null);

  const results = summarizeAllStrategies({ season: args.season, rows });
  const generatedAt = new Date().toISOString();
  const payload = {
    season: args.season,
    target_definition: 'actual_points > points_season_avg_before_game',
    generated_at: generatedAt,
    input_path: `s3://${bucket}/${input}/`,
    output_path: `s3://${bucket}/${out}/`,
    total_rows: rows.length,
    strategies: results,
  };
  const markdown = renderProxyStrategySweepMarkdownReport({
    metadata: {
      season: args.season,
      targetDefinition: 'actual_points > points_season_avg_before_game',
      generatedAt,
      inputPath: `s3://${bucket}/${input}/`,
      outputPath: `s3://${bucket}/${out}/`,
      totalRows: rows.length,
    },
    results,
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
          total_rows: payload.total_rows,
          strategies: payload.strategies.map((s) => ({
            strategy_name: s.strategy_name,
            signal_count: s.signal_count,
            hit_rate: s.hit_rate,
          })),
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
