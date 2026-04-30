/**
 * Slice 6: Transform raw existing_ingestion games JSONL to curated Parquet.
 *
 * Scope guardrails:
 * - source=existing_ingestion only
 * - entity=games only
 * - no player_game_features
 * - no Glue/Athena/Terraform changes
 * - no backtesting strategy/API/CLI changes
 *
 * Input:
 *   s3://$NBA_DATA_BUCKET/raw/source=existing_ingestion/league=nba/season=<S>/entity=games/dt=YYYY-MM-DD/data.jsonl
 *
 * Output:
 *   s3://$NBA_DATA_BUCKET/curated/league=nba/season=<S>/entity=games/dt=YYYY-MM-DD/data.parquet
 *   s3://$NBA_DATA_BUCKET/curated/league=nba/season=<S>/entity=games/_manifest.json
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
  CURATED_GAMES_COLUMNS,
  createNullCoercionCounts,
  normalizeRawGameRow,
  partitionDedupeKey,
  type CuratedGame,
  type NullCoercionCounts,
} from '@/lib/curated/games-schema';

type CliArgs = {
  season: number;
  dryRun: boolean;
  overwrite: boolean;
  partitions: string[] | null;
};

type PartitionSummary = {
  dt: string;
  inputKey: string;
  outputKey: string;
  rawRows: number;
  rowsWritten: number;
  duplicateRowsDropped: number;
  skipped: boolean;
  skipReason?: 'exists' | 'empty' | 'dry-run';
  validation: {
    status: 'passed' | 'failed';
    rowCount: number;
    dateRange: { from: string | null; to: string | null };
    sampleRows: CuratedGame[];
    error?: string;
  };
};

type Manifest = {
  schemaVersion: 1;
  source: 'existing_ingestion';
  entity: 'games';
  season: number;
  inputPrefix: string;
  outputPrefix: string;
  rowCount: number;
  rawInputRowCount: number;
  duplicateRowsDropped: number;
  nullCoercionCounts: NullCoercionCounts;
  dateRange: { from: string | null; to: string | null };
  partitions: Array<{
    dt: string;
    inputKey: string;
    outputKey: string;
    rawRows: number;
    rowsWritten: number;
    duplicateRowsDropped: number;
    skipped: boolean;
    skipReason?: string;
  }>;
  validationStatus: 'passed' | 'warning' | 'failed';
  crossPartitionDuplicateKeysDetected: number;
  createdAt: string;
  status: 'success' | 'partial' | 'dry-run' | 'error';
  notes: string | null;
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
    partitions = partitionsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const bad = partitions.filter((p) => !/^\d{4}-\d{2}-\d{2}$/.test(p));
    if (bad.length > 0) {
      fatal(`Invalid --partitions values: ${bad.join(', ')}. Expected YYYY-MM-DD`);
    }
  }

  return {
    season: Number(seasonRaw),
    dryRun: flags['dry-run'] === true,
    overwrite: flags.overwrite === true,
    partitions,
  };
}

function inputPrefixForSeason(season: number): string {
  return `raw/source=existing_ingestion/league=nba/season=${season}/entity=games`;
}

function outputPrefixForSeason(season: number): string {
  return `curated/league=nba/season=${season}/entity=games`;
}

function inputKeyForDt(prefix: string, dt: string): string {
  return `${prefix}/dt=${dt}/data.jsonl`;
}

function outputKeyForDt(prefix: string, dt: string): string {
  return `${prefix}/dt=${dt}/data.parquet`;
}

async function discoverRawPartitions(
  s3: S3Storage,
  inputPrefix: string,
  selected: string[] | null
): Promise<string[]> {
  const out = new Set<string>();
  for await (const obj of s3.listByPrefix(inputPrefix)) {
    const m = obj.key.match(/\/dt=(\d{4}-\d{2}-\d{2})\/data\.jsonl$/);
    if (!m) continue;
    const dt = m[1];
    if (selected && !selected.includes(dt)) continue;
    out.add(dt);
  }
  return [...out].sort();
}

async function readJsonlRows(
  client: S3Client,
  bucket: string,
  key: string
): Promise<Record<string, unknown>[]> {
  const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!out.Body) return [];
  const text = await out.Body.transformToString();
  if (!text.trim()) return [];

  const rows: Record<string, unknown>[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    rows.push(JSON.parse(line) as Record<string, unknown>);
  }
  return rows;
}

async function ensureDuckdbAvailable(): Promise<void> {
  try {
    const instance = await duckdb.DuckDBInstance.create(':memory:');
    const conn = await instance.connect();
    const reader = await conn.runAndReadAll('select 1 as ok');
    await reader.getRows();
    conn.closeSync();
    instance.closeSync();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fatal(
      `DuckDB is unavailable in this environment. Stopping as requested. ` +
        `Install/runtime error: ${msg}`
    );
  }
}

async function writePartitionParquet(args: {
  rows: CuratedGame[];
  outputParquetPath: string;
}): Promise<void> {
  const { rows, outputParquetPath } = args;
  const tmpJsonlPath = path.join(os.tmpdir(), `slice6-games-${randomUUID()}.jsonl`);
  const ndjsonBody =
    rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length > 0 ? '\n' : '');
  await fs.writeFile(tmpJsonlPath, ndjsonBody, 'utf8');

  const normalizedJsonlPath = tmpJsonlPath.replace(/\\/g, '/');
  const normalizedParquetPath = outputParquetPath.replace(/\\/g, '/');

  const instance = await duckdb.DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    const sourceSql =
      `read_ndjson(` +
      `'${normalizedJsonlPath}', ` +
      `columns = {` +
      `season: 'VARCHAR', ` +
      `game_id: 'VARCHAR', ` +
      `game_date: 'VARCHAR', ` +
      `start_time: 'VARCHAR', ` +
      `status: 'VARCHAR', ` +
      `home_team_id: 'VARCHAR', ` +
      `away_team_id: 'VARCHAR', ` +
      `home_team_abbr: 'VARCHAR', ` +
      `away_team_abbr: 'VARCHAR', ` +
      `home_score: 'VARCHAR', ` +
      `away_score: 'VARCHAR', ` +
      `venue: 'VARCHAR', ` +
      `is_postseason: 'VARCHAR', ` +
      `game_type: 'VARCHAR'` +
      `}, ` +
      `format = 'newline_delimited'` +
      `)`;

    const selectSql =
      `SELECT ` +
      [
        `CAST(season AS VARCHAR) AS season`,
        `CAST(game_id AS VARCHAR) AS game_id`,
        `TRY_CAST(game_date AS DATE) AS game_date`,
        `CAST(start_time AS VARCHAR) AS start_time`,
        `CAST(status AS VARCHAR) AS status`,
        `CAST(home_team_id AS VARCHAR) AS home_team_id`,
        `CAST(away_team_id AS VARCHAR) AS away_team_id`,
        `CAST(home_team_abbr AS VARCHAR) AS home_team_abbr`,
        `CAST(away_team_abbr AS VARCHAR) AS away_team_abbr`,
        `TRY_CAST(home_score AS DOUBLE) AS home_score`,
        `TRY_CAST(away_score AS DOUBLE) AS away_score`,
        `CAST(venue AS VARCHAR) AS venue`,
        `CASE
           WHEN lower(trim(is_postseason)) IN ('true', 't', '1', 'yes') THEN TRUE
           WHEN lower(trim(is_postseason)) IN ('false', 'f', '0', 'no') THEN FALSE
           ELSE NULL
         END AS is_postseason`,
        `CAST(game_type AS VARCHAR) AS game_type`,
      ].join(', ') +
      ` FROM ${sourceSql}`;
    await conn.run(
      `COPY (${selectSql}) TO '${normalizedParquetPath}' (FORMAT PARQUET, COMPRESSION ZSTD)`
    );
  } finally {
    conn.closeSync();
    instance.closeSync();
    await fs.unlink(tmpJsonlPath).catch(() => {});
  }
}

async function validateParquet(parquetPath: string): Promise<PartitionSummary['validation']> {
  const normalizedParquetPath = parquetPath.replace(/\\/g, '/');
  const instance = await duckdb.DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    const countReader = await conn.runAndReadAll(
      `SELECT COUNT(*)::BIGINT AS c FROM read_parquet('${normalizedParquetPath}')`
    );
    const countRows = await countReader.getRows();
    const rowCount = Number(countRows[0]?.[0] ?? 0);

    const rangeReader = await conn.runAndReadAll(
      `SELECT MIN(CAST(game_date AS VARCHAR)) AS mn, MAX(CAST(game_date AS VARCHAR)) AS mx
       FROM read_parquet('${normalizedParquetPath}')`
    );
    const rangeRows = await rangeReader.getRows();
    const from = (rangeRows[0]?.[0] as string | null) ?? null;
    const to = (rangeRows[0]?.[1] as string | null) ?? null;

    const sampleReader = await conn.runAndReadAll(
      `SELECT
         season,
         game_id,
         CAST(game_date AS VARCHAR) AS game_date,
         start_time,
         status,
         home_team_id,
         away_team_id,
         home_team_abbr,
         away_team_abbr,
         home_score,
         away_score,
         venue,
         is_postseason,
         game_type
       FROM read_parquet('${normalizedParquetPath}')
       ORDER BY game_date, game_id
       LIMIT 3`
    );
    const rows = (await sampleReader.getRows()) as Array<
      [
        string,
        string,
        string,
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
        number | null,
        number | null,
        string | null,
        boolean | null,
        string | null,
      ]
    >;
    const sampleRows: CuratedGame[] = rows.map((r) => ({
      season: r[0],
      game_id: r[1],
      game_date: r[2],
      start_time: r[3],
      status: r[4],
      home_team_id: r[5],
      away_team_id: r[6],
      home_team_abbr: r[7],
      away_team_abbr: r[8],
      home_score: r[9],
      away_score: r[10],
      venue: r[11],
      is_postseason: r[12],
      game_type: r[13],
    }));

    return { status: 'passed', rowCount, dateRange: { from, to }, sampleRows };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: 'failed',
      rowCount: 0,
      dateRange: { from: null, to: null },
      sampleRows: [],
      error: msg,
    };
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

function addCounts(target: NullCoercionCounts, inc: NullCoercionCounts): NullCoercionCounts {
  target.home_score += inc.home_score;
  target.away_score += inc.away_score;
  return target;
}

function toDateRange(partitions: PartitionSummary[]): { from: string | null; to: string | null } {
  const dts = partitions
    .filter((p) => p.validation.dateRange.from && p.validation.dateRange.to && p.rowsWritten > 0)
    .map((p) => [p.validation.dateRange.from!, p.validation.dateRange.to!] as const)
    .flat();
  if (dts.length === 0) return { from: null, to: null };
  dts.sort();
  return { from: dts[0], to: dts[dts.length - 1] };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const bucket = requireEnv('NBA_DATA_BUCKET');
  const region = process.env.AWS_REGION?.trim() || 'us-east-1';

  const inputPrefix = inputPrefixForSeason(args.season);
  const outputPrefix = outputPrefixForSeason(args.season);

  const s3 = new S3Storage({ bucket, region });
  const s3Client = new S3Client({ region });

  console.log('=== Slice 6 Transform: games raw -> curated parquet ===');
  console.log(`  season       : ${args.season}`);
  console.log(`  bucket       : ${bucket}`);
  console.log(`  inputPrefix  : s3://${bucket}/${inputPrefix}/`);
  console.log(`  outputPrefix : s3://${bucket}/${outputPrefix}/`);
  console.log(`  dryRun       : ${args.dryRun}`);
  console.log(`  overwrite    : ${args.overwrite}`);
  if (args.partitions) console.log(`  partitions   : ${args.partitions.join(',')}`);

  await ensureDuckdbAvailable();
  const partitions = await discoverRawPartitions(s3, inputPrefix, args.partitions);
  if (partitions.length === 0) fatal('No raw games partitions discovered under input prefix.');
  console.log(`\nDiscovered ${partitions.length} partition(s).`);

  const summaries: PartitionSummary[] = [];
  const aggregateNullCoercions = createNullCoercionCounts();
  let aggregateRowsWritten = 0;
  let aggregateRawRows = 0;
  let aggregateDropped = 0;
  const seenAcrossPartitions = new Set<string>();
  let crossPartitionDuplicateKeysDetected = 0;

  for (const dt of partitions) {
    const inputKey = inputKeyForDt(inputPrefix, dt);
    const outputKey = outputKeyForDt(outputPrefix, dt);
    console.log(`\n[partition ${dt}]`);

    if (args.dryRun) {
      console.log(`  [dry-run]      would read  ${inputKey}`);
      console.log(`  [dry-run]      would write ${outputKey}`);
      summaries.push({
        dt,
        inputKey,
        outputKey,
        rawRows: 0,
        rowsWritten: 0,
        duplicateRowsDropped: 0,
        skipped: true,
        skipReason: 'dry-run',
        validation: {
          status: 'passed',
          rowCount: 0,
          dateRange: { from: null, to: null },
          sampleRows: [],
        },
      });
      continue;
    }

    if (!args.overwrite && (await s3.objectExists(outputKey))) {
      console.log(`  [skip-existing] ${outputKey}`);
      summaries.push({
        dt,
        inputKey,
        outputKey,
        rawRows: 0,
        rowsWritten: 0,
        duplicateRowsDropped: 0,
        skipped: true,
        skipReason: 'exists',
        validation: {
          status: 'passed',
          rowCount: 0,
          dateRange: { from: null, to: null },
          sampleRows: [],
        },
      });
      continue;
    }

    const rawRows = await readJsonlRows(s3Client, bucket, inputKey);
    aggregateRawRows += rawRows.length;
    if (rawRows.length === 0) {
      console.log(`  [skip-empty]    ${inputKey}`);
      summaries.push({
        dt,
        inputKey,
        outputKey,
        rawRows: 0,
        rowsWritten: 0,
        duplicateRowsDropped: 0,
        skipped: true,
        skipReason: 'empty',
        validation: {
          status: 'passed',
          rowCount: 0,
          dateRange: { from: null, to: null },
          sampleRows: [],
        },
      });
      continue;
    }

    const nullCoercions = createNullCoercionCounts();
    const dedupe = new Set<string>();
    let duplicateRowsDropped = 0;
    const normalized: CuratedGame[] = [];

    for (const row of rawRows) {
      const mapped = normalizeRawGameRow({
        row,
        season: args.season,
        partitionDate: dt,
        nullCoercionCounts: nullCoercions,
      });
      if (!mapped) continue;
      const key = partitionDedupeKey(mapped);
      if (dedupe.has(key)) {
        duplicateRowsDropped += 1;
        continue;
      }
      dedupe.add(key);
      normalized.push(mapped);
      if (seenAcrossPartitions.has(key)) crossPartitionDuplicateKeysDetected += 1;
      else seenAcrossPartitions.add(key);
    }

    addCounts(aggregateNullCoercions, nullCoercions);
    aggregateDropped += duplicateRowsDropped;

    const tmpParquetPath = path.join(os.tmpdir(), `slice6-games-${dt}-${randomUUID()}.parquet`);
    await writePartitionParquet({ rows: normalized, outputParquetPath: tmpParquetPath });

    const validation = await validateParquet(tmpParquetPath);
    if (validation.status === 'failed') {
      await fs.unlink(tmpParquetPath).catch(() => {});
      fatal(`Parquet validation failed for dt=${dt}: ${validation.error}`);
    }

    const parquetBytes = await fs.readFile(tmpParquetPath);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: outputKey,
        Body: parquetBytes,
        ContentType: 'application/octet-stream',
      })
    );
    await fs.unlink(tmpParquetPath).catch(() => {});

    aggregateRowsWritten += validation.rowCount;
    console.log(
      `  [wrote]         ${outputKey} (raw=${rawRows.length}, curated=${validation.rowCount}, dropped=${duplicateRowsDropped})`
    );
    console.log(
      `  [validate]      count=${validation.rowCount}, range=${validation.dateRange.from ?? 'null'} -> ${validation.dateRange.to ?? 'null'}`
    );
    if (validation.sampleRows.length > 0) {
      console.log(`  [validate]      sample=${JSON.stringify(validation.sampleRows[0])}`);
    }

    summaries.push({
      dt,
      inputKey,
      outputKey,
      rawRows: rawRows.length,
      rowsWritten: validation.rowCount,
      duplicateRowsDropped,
      skipped: false,
      validation,
    });
  }

  if (args.dryRun) {
    console.log('\n[dry-run] Completed without writing parquet or manifest.');
    return;
  }

  if (crossPartitionDuplicateKeysDetected > 0) {
    console.warn(
      `[warn] cross-partition duplicates detected for game_id: ${crossPartitionDuplicateKeysDetected}`
    );
  }

  const validationStatus: Manifest['validationStatus'] =
    crossPartitionDuplicateKeysDetected > 0 ? 'warning' : 'passed';
  const anySkippedExists = summaries.some((s) => s.skipReason === 'exists');
  const status: Manifest['status'] = anySkippedExists ? 'partial' : 'success';

  const manifest: Manifest = {
    schemaVersion: 1,
    source: 'existing_ingestion',
    entity: 'games',
    season: args.season,
    inputPrefix,
    outputPrefix,
    rowCount: aggregateRowsWritten,
    rawInputRowCount: aggregateRawRows,
    duplicateRowsDropped: aggregateDropped,
    nullCoercionCounts: aggregateNullCoercions,
    dateRange: toDateRange(summaries),
    partitions: summaries.map((s) => ({
      dt: s.dt,
      inputKey: s.inputKey,
      outputKey: s.outputKey,
      rawRows: s.rawRows,
      rowsWritten: s.rowsWritten,
      duplicateRowsDropped: s.duplicateRowsDropped,
      skipped: s.skipped,
      skipReason: s.skipReason,
    })),
    validationStatus,
    crossPartitionDuplicateKeysDetected,
    createdAt: new Date().toISOString(),
    status,
    notes:
      validationStatus === 'warning'
        ? 'Cross-partition duplicates detected; dedupe in this slice is partition-local only.'
        : null,
  };

  const manifestKey = `${outputPrefix}/_manifest.json`;
  await s3.putJson(manifestKey, manifest, { overwrite: true });
  console.log(`\n[manifest] ${manifestKey}`);

  console.log('\n=== Summary ===');
  console.log(`  rawInputRowCount          : ${manifest.rawInputRowCount}`);
  console.log(`  curatedRowCount           : ${manifest.rowCount}`);
  console.log(`  duplicateRowsDropped      : ${manifest.duplicateRowsDropped}`);
  console.log(`  nullCoercionCounts        : ${JSON.stringify(manifest.nullCoercionCounts)}`);
  console.log(`  crossPartitionDuplicates  : ${manifest.crossPartitionDuplicateKeysDetected}`);
  console.log(
    `  dateRange                 : ${manifest.dateRange.from ?? 'null'} -> ${manifest.dateRange.to ?? 'null'}`
  );
  const skipped = summaries.filter((s) => s.skipped);
  if (skipped.length > 0) {
    console.log(
      `  skippedPartitions         : ${skipped
        .map((s) => `${s.dt}:${s.skipReason ?? 'unknown'}`)
        .join(', ')}`
    );
  }
}

main().catch((err) => {
  console.error('[fatal] unhandled error:', err);
  process.exit(1);
});
