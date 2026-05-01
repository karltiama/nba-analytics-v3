/**
 * Slice 5: Transform raw existing_ingestion player_game_logs JSONL to curated Parquet.
 *
 * Scope guardrails:
 * - source=existing_ingestion only
 * - entity=player_game_logs only
 * - no games transform
 * - no features layer
 * - no Glue/Athena/Terraform changes
 * - no backtesting strategy/API/CLI changes
 *
 * Input:
 *   s3://$NBA_DATA_BUCKET/raw/source=existing_ingestion/league=nba/season=<S>/entity=player_game_logs/dt=YYYY-MM-DD/data.jsonl
 *
 * Output:
 *   s3://$NBA_DATA_BUCKET/curated/league=nba/season=<S>/entity=player_game_logs/dt=YYYY-MM-DD/data.parquet
 *   s3://$NBA_DATA_BUCKET/curated/league=nba/season=<S>/entity=player_game_logs/_manifest.json
 *
 * Usage:
 *   tsx scripts/transform/raw-player-game-logs-to-curated-parquet.ts --season=2025 --dry-run
 *   tsx scripts/transform/raw-player-game-logs-to-curated-parquet.ts --season=2025
 *   tsx scripts/transform/raw-player-game-logs-to-curated-parquet.ts --season=2025 --overwrite
 *   tsx scripts/transform/raw-player-game-logs-to-curated-parquet.ts --season=2025 --partitions=2025-10-21,2025-10-22
 */

import 'dotenv/config';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import duckdb from '@duckdb/node-api';
import { S3Storage } from '@/lib/aws/s3';
import {
  CURATED_PLAYER_GAME_LOGS_COLUMNS,
  createNullCoercionCounts,
  normalizeRawPlayerGameLogRow,
  partitionDedupeKey,
  type CuratedPlayerGameLog,
  type NullCoercionCounts,
} from '@/lib/curated/player-game-logs-schema';
import { createNullCoercionCounts as createGameNullCoercionCounts, normalizeRawGameRow } from '@/lib/curated/games-schema';

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
    sampleRows: CuratedPlayerGameLog[];
    error?: string;
  };
};

type Manifest = {
  schemaVersion: 1;
  source: 'existing_ingestion';
  entity: 'player_game_logs';
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
  return `raw/source=existing_ingestion/league=nba/season=${season}/entity=player_game_logs`;
}

function outputPrefixForSeason(season: number): string {
  return `curated/league=nba/season=${season}/entity=player_game_logs`;
}

function inputKeyForDt(prefix: string, dt: string): string {
  return `${prefix}/dt=${dt}/data.jsonl`;
}

function outputKeyForDt(prefix: string, dt: string): string {
  return `${prefix}/dt=${dt}/data.parquet`;
}

function gamesInputKeyForDt(season: number, dt: string): string {
  return `raw/source=existing_ingestion/league=nba/season=${season}/entity=games/dt=${dt}/data.jsonl`;
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
  rows: CuratedPlayerGameLog[];
  outputParquetPath: string;
}): Promise<void> {
  const { rows, outputParquetPath } = args;
  const tmpJsonlPath = path.join(
    os.tmpdir(),
    `slice5-player-logs-${randomUUID()}.jsonl`
  );
  const ndjsonBody =
    rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length > 0 ? '\n' : '');
  await fs.writeFile(tmpJsonlPath, ndjsonBody, 'utf8');

  const normalizedJsonlPath = tmpJsonlPath.replace(/\\/g, '/');
  const normalizedParquetPath = outputParquetPath.replace(/\\/g, '/');

  const instance = await duckdb.DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    const selectSql =
      `SELECT ` +
      [
        `CAST(season AS VARCHAR) AS season`,
        `CAST(game_id AS VARCHAR) AS game_id`,
        `CAST(game_date AS DATE) AS game_date`,
        `CAST(player_id AS VARCHAR) AS player_id`,
        `CAST(player_name AS VARCHAR) AS player_name`,
        `CAST(team_id AS VARCHAR) AS team_id`,
        `CAST(team_abbr AS VARCHAR) AS team_abbr`,
        `CAST(opponent_team_id AS VARCHAR) AS opponent_team_id`,
        `CAST(opponent_abbr AS VARCHAR) AS opponent_abbr`,
        `CAST(minutes AS DOUBLE) AS minutes`,
        `CAST(points AS DOUBLE) AS points`,
        `CAST(rebounds AS DOUBLE) AS rebounds`,
        `CAST(assists AS DOUBLE) AS assists`,
        `CAST(threes AS DOUBLE) AS threes`,
        `CAST(pra AS DOUBLE) AS pra`,
      ].join(', ') +
      ` FROM read_ndjson_auto('${normalizedJsonlPath}')`;

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
      `SELECT MIN(game_date)::VARCHAR AS mn, MAX(game_date)::VARCHAR AS mx
       FROM read_parquet('${normalizedParquetPath}')`
    );
    const rangeRows = await rangeReader.getRows();
    const from = (rangeRows[0]?.[0] as string | null) ?? null;
    const to = (rangeRows[0]?.[1] as string | null) ?? null;

    const sampleReader = await conn.runAndReadAll(
      `SELECT ${CURATED_PLAYER_GAME_LOGS_COLUMNS.join(', ')}
       FROM read_parquet('${normalizedParquetPath}')
       ORDER BY game_date, player_id, game_id
       LIMIT 3`
    );
    const sampleRows = (await sampleReader.getRows()) as Array<
      [string, string, string, string, string | null, string | null, string | null, string | null, string | null, number | null, number | null, number | null, number | null, number | null, number | null]
    >;

    const sampleMapped: CuratedPlayerGameLog[] = sampleRows.map((r) => ({
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

    return {
      status: 'passed',
      rowCount,
      dateRange: { from, to },
      sampleRows: sampleMapped,
    };
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

function addCounts(
  target: NullCoercionCounts,
  inc: NullCoercionCounts
): NullCoercionCounts {
  target.minutes += inc.minutes;
  target.points += inc.points;
  target.rebounds += inc.rebounds;
  target.assists += inc.assists;
  target.threes += inc.threes;
  target.pra += inc.pra;
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

  console.log('=== Slice 5 Transform: player_game_logs raw -> curated parquet ===');
  console.log(`  season       : ${args.season}`);
  console.log(`  bucket       : ${bucket}`);
  console.log(`  inputPrefix  : s3://${bucket}/${inputPrefix}/`);
  console.log(`  outputPrefix : s3://${bucket}/${outputPrefix}/`);
  console.log(`  dryRun       : ${args.dryRun}`);
  console.log(`  overwrite    : ${args.overwrite}`);
  if (args.partitions) {
    console.log(`  partitions   : ${args.partitions.join(',')}`);
  }

  await ensureDuckdbAvailable();

  const partitions = await discoverRawPartitions(s3, inputPrefix, args.partitions);
  if (partitions.length === 0) {
    fatal('No raw player_game_logs partitions discovered under input prefix.');
  }
  console.log(`\\nDiscovered ${partitions.length} partition(s).`);

  const summaries: PartitionSummary[] = [];
  const aggregateNullCoercions = createNullCoercionCounts();
  let aggregateRowsWritten = 0;
  let aggregateRawRows = 0;
  let aggregateDropped = 0;
  let aggregateBoundaryRowsDropped = 0;

  // For slice scope: still log cross-partition duplicates during aggregate validation.
  const seenAcrossPartitions = new Set<string>();
  let crossPartitionDuplicateKeysDetected = 0;

  for (const dt of partitions) {
    const inputKey = inputKeyForDt(inputPrefix, dt);
    const outputKey = outputKeyForDt(outputPrefix, dt);
    console.log(`\\n[partition ${dt}]`);

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
    const gameNullCoercions = createGameNullCoercionCounts();
    const dedupe = new Set<string>();
    let duplicateRowsDropped = 0;
    let boundaryRowsDropped = 0;
    const normalized: CuratedPlayerGameLog[] = [];
    const finalGameIds = new Set<string>();
    const rawGamesRows = await readJsonlRows(s3Client, bucket, gamesInputKeyForDt(args.season, dt)).catch(
      () => []
    );
    for (const gameRow of rawGamesRows) {
      const mappedGame = normalizeRawGameRow({
        row: gameRow,
        season: args.season,
        partitionDate: dt,
        nullCoercionCounts: gameNullCoercions,
      });
      if (!mappedGame) continue;
      if (mappedGame.season !== String(args.season) || mappedGame.game_date !== dt) continue;
      finalGameIds.add(mappedGame.game_id);
    }

    for (const row of rawRows) {
      const mapped = normalizeRawPlayerGameLogRow({
        row,
        season: args.season,
        partitionDate: dt,
        nullCoercionCounts: nullCoercions,
      });
      if (!mapped) continue;
      if (mapped.season !== String(args.season) || mapped.game_date !== dt) {
        boundaryRowsDropped += 1;
        continue;
      }
      if (finalGameIds.size > 0 && !finalGameIds.has(mapped.game_id)) {
        boundaryRowsDropped += 1;
        continue;
      }
      const key = partitionDedupeKey(mapped);
      if (dedupe.has(key)) {
        duplicateRowsDropped += 1;
        continue;
      }
      dedupe.add(key);
      normalized.push(mapped);
      if (seenAcrossPartitions.has(key)) {
        crossPartitionDuplicateKeysDetected += 1;
      } else {
        seenAcrossPartitions.add(key);
      }
    }

    addCounts(aggregateNullCoercions, nullCoercions);
    aggregateDropped += duplicateRowsDropped;
    aggregateBoundaryRowsDropped += boundaryRowsDropped;

    const tmpParquetPath = path.join(
      os.tmpdir(),
      `slice5-player-logs-${dt}-${randomUUID()}.parquet`
    );
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
    if (boundaryRowsDropped > 0) {
      console.log(`  [boundary-drop] rows dropped due to season/dt/final-game mismatch: ${boundaryRowsDropped}`);
    }
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
    console.log('\\n[dry-run] Completed without writing parquet or manifest.');
    return;
  }

  if (crossPartitionDuplicateKeysDetected > 0) {
    console.warn(
      `[warn] cross-partition duplicates detected for (player_id,game_id): ${crossPartitionDuplicateKeysDetected}`
    );
  }

  const validationStatus: Manifest['validationStatus'] =
    crossPartitionDuplicateKeysDetected > 0 ? 'warning' : 'passed';
  const anySkippedExists = summaries.some((s) => s.skipReason === 'exists');
  const status: Manifest['status'] = anySkippedExists ? 'partial' : 'success';

  const manifest: Manifest = {
    schemaVersion: 1,
    source: 'existing_ingestion',
    entity: 'player_game_logs',
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
  console.log(`\\n[manifest] ${manifestKey}`);

  console.log('\\n=== Summary ===');
  console.log(`  rawInputRowCount          : ${manifest.rawInputRowCount}`);
  console.log(`  curatedRowCount           : ${manifest.rowCount}`);
  console.log(`  duplicateRowsDropped      : ${manifest.duplicateRowsDropped}`);
  console.log(`  boundaryRowsDropped       : ${aggregateBoundaryRowsDropped}`);
  console.log(
    `  nullCoercionCounts        : ${JSON.stringify(manifest.nullCoercionCounts)}`
  );
  console.log(
    `  crossPartitionDuplicates  : ${manifest.crossPartitionDuplicateKeysDetected}`
  );
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
