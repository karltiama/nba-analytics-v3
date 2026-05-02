import 'dotenv/config';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import duckdb from '@duckdb/node-api';
import { S3Storage } from '@/lib/aws/s3';
import { buildPlayerDisplayNameLookupPayload } from '@/lib/research/player-display-name-lookup-builder';
import { playerIdDisplayNameLookupS3Keys } from '@/lib/research/player-id-display-name-lookup';

type CliArgs = {
  seasons: number[];
  dryRun: boolean;
  writeComparisonScoped: boolean;
  comparisonTag: string;
};

const DEFAULT_COMPARISON_TAG = '2023-2024-2025';

function fatal(msg: string): never {
  console.error(`[fatal] ${msg}`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) fatal(`Missing required env var: ${name}`);
  return v;
}

function parseSeasonList(raw: string): number[] {
  return [...new Set(raw.split(',').map((s) => Number(s.trim())))]
    .filter((n) => Number.isFinite(n) && n >= 1900 && n <= 3000)
    .sort((a, b) => a - b);
}

function parseArgs(argv: string[]): CliArgs {
  const flags: Record<string, string | boolean> = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq === -1) flags[raw.slice(2)] = true;
    else flags[raw.slice(2, eq)] = raw.slice(eq + 1);
  }

  let seasons: number[] = [];
  const seasonsFromFlag =
    typeof flags.seasons === 'string'
      ? flags.seasons
      : typeof process.env.npm_config_seasons === 'string'
        ? process.env.npm_config_seasons
        : undefined;
  if (typeof seasonsFromFlag === 'string' && seasonsFromFlag.trim().length > 0) {
    seasons = parseSeasonList(seasonsFromFlag);
  }

  if (seasons.length === 0) {
    const oneSeasonRaw =
      typeof flags.season === 'string'
        ? flags.season
        : typeof process.env.npm_config_season === 'string'
          ? process.env.npm_config_season
          : undefined;
    if (typeof oneSeasonRaw === 'string' && /^\d{4}$/.test(oneSeasonRaw.trim())) {
      seasons = [Number(oneSeasonRaw.trim())];
    }
  }

  if (seasons.length === 0) {
    fatal('Pass --seasons=2023,2024,2025 or a single --season=2025 (features partitions to read).');
  }

  const comparisonTagRaw =
    typeof flags['comparison-tag'] === 'string'
      ? flags['comparison-tag']
      : typeof process.env.npm_config_comparison_tag === 'string'
        ? process.env.npm_config_comparison_tag
        : DEFAULT_COMPARISON_TAG;
  const comparisonTag = comparisonTagRaw.trim() || DEFAULT_COMPARISON_TAG;

  const dryRunFromNpmConfig =
    process.env.npm_config_dry_run === 'true' || process.env.npm_config_dryrun === 'true';
  const writeScopedFromNpm =
    flags['write-comparison-scoped'] === true ||
    process.env.npm_config_write_comparison_scoped === 'true';

  return {
    seasons,
    dryRun: flags['dry-run'] === true || dryRunFromNpmConfig,
    writeComparisonScoped: writeScopedFromNpm,
    comparisonTag,
  };
}

function featureInputPrefix(season: number): string {
  return `features/league=nba/season=${season}/entity=player_game_features`;
}

async function downloadFeatureParquets(args: {
  s3: S3Storage;
  s3Client: S3Client;
  bucket: string;
  season: number;
  sourcePrefix: string;
  targetDir: string;
}): Promise<string[]> {
  const { s3, s3Client, bucket, season, sourcePrefix, targetDir } = args;
  const localPaths: string[] = [];
  for await (const obj of s3.listByPrefix(sourcePrefix)) {
    const m = obj.key.match(/\/dt=(\d{4}-\d{2}-\d{2})\/data\.parquet$/);
    if (!m) continue;
    const local = path.join(targetDir, `season=${season}_dt=${m[1]}.parquet`);
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

async function loadOrderedIdNameRows(parquetPaths: string[], columns: Set<string>): Promise<{
  rows: Array<{ player_id: unknown; player_name: unknown }>;
  totalRowCount: number;
}> {
  if (parquetPaths.length === 0) return { rows: [], totalRowCount: 0 };
  const quotedList = parquetPaths
    .map((p) => `'${p.replace(/\\/g, '/').replace(/'/g, "''")}'`)
    .join(', ');

  const hasSeason = columns.has('season');
  const hasGameDate = columns.has('game_date');

  const seasonOrder = hasSeason
    ? 'COALESCE(TRY_CAST(season AS INTEGER), 0) ASC NULLS LAST'
    : '0 ASC';
  const dateOrder = hasGameDate
    ? 'COALESCE(TRY_CAST(game_date AS DATE), DATE \'1970-01-01\') ASC NULLS LAST'
    : 'DATE \'1970-01-01\' ASC';

  const instance = await duckdb.DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    const countReader = await conn.runAndReadAll(`SELECT COUNT(*)::BIGINT AS c FROM read_parquet([${quotedList}])`);
    const countRows = await countReader.getRowObjectsJS();
    const totalRowCount = Number((countRows[0] as { c?: unknown })?.c ?? 0);

    const reader = await conn.runAndReadAll(`
      SELECT player_id, player_name
      FROM read_parquet([${quotedList}])
      ORDER BY ${seasonOrder}, ${dateOrder}, CAST(player_id AS VARCHAR)
    `);
    const rows = (await reader.getRowObjectsJS()) as Array<{ player_id: unknown; player_name: unknown }>;
    return { rows, totalRowCount };
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

  const [globalKey, comparisonScopedKey] = playerIdDisplayNameLookupS3Keys(args.comparisonTag);

  console.log(`seasons=${args.seasons.join(',')}`);
  console.log(`comparison_tag=${args.comparisonTag}`);
  console.log(`dry_run=${args.dryRun}`);
  console.log(`write_comparison_scoped=${args.writeComparisonScoped}`);
  console.log(`global_s3_key=s3://${bucket}/${globalKey}`);
  if (args.writeComparisonScoped) {
    console.log(`comparison_scoped_s3_key=s3://${bucket}/${comparisonScopedKey}`);
  }

  const tmpDir = path.join(os.tmpdir(), `player-display-name-lookup-${randomUUID()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  let allPaths: string[] = [];
  try {
    for (const season of args.seasons) {
      const prefix = featureInputPrefix(season);
      const paths = await downloadFeatureParquets({
        s3,
        s3Client,
        bucket,
        season,
        sourcePrefix: prefix,
        targetDir: tmpDir,
      });
      if (paths.length === 0) {
        fatal(`No feature parquet files under s3://${bucket}/${prefix}/`);
      }
      allPaths = allPaths.concat(paths);
    }

    const columns = await listParquetColumns(allPaths);
    if (!columns.has('player_id')) fatal('Input parquet is missing required column: player_id');
    if (!columns.has('player_name')) fatal('Input parquet is missing required column: player_name');

    const { rows, totalRowCount } = await loadOrderedIdNameRows(allPaths, columns);
    const payload = buildPlayerDisplayNameLookupPayload({
      rows,
      source: 'player_game_features',
    });

    console.log('');
    console.log(`source_parquet_files=${allPaths.length}`);
    console.log(`total_data_rows=${totalRowCount.toLocaleString()}`);
    console.log(`unique_players_with_display_name=${payload.entry_count.toLocaleString()}`);

    if (args.dryRun) {
      console.log('[dry-run] Skipping S3 writes.');
      return;
    }

    const globalRes = await s3.putJson(globalKey, payload, { overwrite: true });
    console.log(`wrote_global=${globalRes.written} reason=${globalRes.reason} s3://${bucket}/${globalKey}`);

    if (args.writeComparisonScoped) {
      const scopedRes = await s3.putJson(comparisonScopedKey, payload, { overwrite: true });
      console.log(
        `wrote_comparison_scoped=${scopedRes.written} reason=${scopedRes.reason} s3://${bucket}/${comparisonScopedKey}`
      );
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
