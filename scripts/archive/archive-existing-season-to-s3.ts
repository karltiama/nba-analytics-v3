/**
 * Archive existing 2025-26 NBA season data from Postgres to S3.
 *
 * Read-only against Postgres. Resumable: skips S3 keys that already exist
 * unless --overwrite is passed. Manifest is always rewritten so it reflects
 * the latest known state.
 *
 * Usage:
 *   tsx scripts/archive/archive-existing-season-to-s3.ts --season=2025 --dry-run
 *   tsx scripts/archive/archive-existing-season-to-s3.ts --season=2025
 *   tsx scripts/archive/archive-existing-season-to-s3.ts --season=2025 --entities=teams,players,player_game_logs
 *   tsx scripts/archive/archive-existing-season-to-s3.ts --season=2025 --overwrite
 *   tsx scripts/archive/archive-existing-season-to-s3.ts --season=2025 --batch-size=2000
 *
 * Env:
 *   SUPABASE_DB_URL       (required)
 *   NBA_DATA_BUCKET       (required - target S3 bucket)
 *   NBA_RAW_PREFIX        (optional, default 'raw')
 *   AWS_REGION            (optional, default 'us-east-1')
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { S3Storage } from '@/lib/aws/s3';
import {
  ENTITIES,
  ENTITY_NAMES,
  findEntity,
  type EntityDef,
  type SeasonContext,
} from './entity-registry';

type CliArgs = {
  season: number;
  entities: string[] | null;
  dryRun: boolean;
  overwrite: boolean;
  batchSize: number;
};

type EntityManifest = {
  schemaVersion: 1;
  s3Prefix: string;
  exportMode: 'full';
  source: 'existing_ingestion';
  league: 'nba';
  season: number;
  entity: string;
  sourceTable: string;
  exportedAt: string;
  recordCount: number;
  dateRange: { from: string; to: string } | null;
  partitions: string[];
  status: 'success' | 'partial' | 'empty' | 'skipped' | 'error';
  notes: string | null;
};

type EntitySummary = {
  entity: string;
  status: EntityManifest['status'];
  recordCount: number;
  partitions: number;
  written: number;
  skipped: number;
  empty: number;
  durationMs: number;
  error?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> & { _flags: Record<string, string | boolean> } = {
    _flags: {},
  };

  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq === -1) {
      args._flags[raw.slice(2)] = true;
    } else {
      args._flags[raw.slice(2, eq)] = raw.slice(eq + 1);
    }
  }

  const seasonRaw = args._flags['season'];
  if (typeof seasonRaw !== 'string' || !/^\d{4}$/.test(seasonRaw)) {
    fatal(
      'Missing or invalid --season=<YYYY>. Example: --season=2025 (for the 2025-26 NBA season).'
    );
  }

  const entitiesRaw = args._flags['entities'];
  let entities: string[] | null = null;
  if (typeof entitiesRaw === 'string' && entitiesRaw.trim().length > 0) {
    entities = entitiesRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const unknown = entities.filter((n) => !ENTITY_NAMES.includes(n));
    if (unknown.length > 0) {
      fatal(
        `Unknown --entities: ${unknown.join(', ')}. Known entities: ${ENTITY_NAMES.join(', ')}`
      );
    }
  }

  const batchSizeRaw = args._flags['batch-size'];
  let batchSize = 1000;
  if (typeof batchSizeRaw === 'string') {
    const n = Number(batchSizeRaw);
    if (!Number.isFinite(n) || n < 1) fatal('--batch-size must be a positive integer.');
    batchSize = Math.floor(n);
  }

  return {
    season: Number(seasonRaw as string),
    entities,
    dryRun: args._flags['dry-run'] === true,
    overwrite: args._flags['overwrite'] === true,
    batchSize,
  };
}

function fatal(msg: string): never {
  console.error(`[fatal] ${msg}`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) fatal(`Missing required env var: ${name}`);
  return v;
}

async function computeSeasonContext(db: Pool, season: number): Promise<SeasonContext> {
  const r = await db.query<{ start: string | null; end: string | null }>(
    `select to_char(min(start_time at time zone 'America/New_York')::date, 'YYYY-MM-DD') as start,
            to_char(max(start_time at time zone 'America/New_York')::date, 'YYYY-MM-DD') as end
     from analytics.games
     where season = $1::text and start_time is not null`,
    [String(season)]
  );
  const row = r.rows[0];
  if (!row || !row.start || !row.end) {
    fatal(
      `analytics.games has no rows for season=${season}. Refusing to archive an empty window. ` +
        `Pass a different --season, or run your daily ingestion first.`
    );
  }
  return { season, seasonStart: row.start, seasonEnd: row.end };
}

function buildEntityPrefix(rawPrefix: string, season: number, entity: string): string {
  return `${rawPrefix}/source=existing_ingestion/league=nba/season=${season}/entity=${entity}`;
}

function buildPartitionKey(entityPrefix: string, partition: string | null): string {
  return partition === null
    ? `${entityPrefix}/data.jsonl`
    : `${entityPrefix}/dt=${partition}/data.jsonl`;
}

async function archiveEntity(opts: {
  entity: EntityDef;
  db: Pool;
  s3: S3Storage;
  rawPrefix: string;
  args: CliArgs;
  ctx: SeasonContext;
}): Promise<EntitySummary> {
  const { entity, db, s3, rawPrefix, args, ctx } = opts;
  const start = Date.now();
  const entityPrefix = buildEntityPrefix(rawPrefix, args.season, entity.entity);

  console.log(`\n[entity] ${entity.entity}  (${entity.sourceTable})`);
  console.log(`         partition=${entity.partitionStrategy}  paginationKey=${entity.paginationKey}`);

  let partitions: (string | null)[];
  if (entity.partitionStrategy === 'date') {
    if (!entity.listPartitions) {
      throw new Error(`Entity ${entity.entity} declares date partition but no listPartitions`);
    }
    const parts = await entity.listPartitions(db, ctx);
    partitions = parts;
    console.log(`         discovered ${parts.length} partition(s)`);
  } else {
    partitions = [null];
  }

  let totalRecords = 0;
  let written = 0;
  let skipped = 0;
  let empty = 0;
  const writtenPartitions: string[] = [];

  for (const partition of partitions) {
    const key = buildPartitionKey(entityPrefix, partition);
    const tag = partition === null ? '<single>' : partition;

    // Dry-run path skips S3 round-trips entirely so the user can preview the
    // plan without AWS credentials. A real run will still resume/skip-existing.
    if (!args.dryRun && !args.overwrite && (await s3.objectExists(key))) {
      console.log(`  [skip-existing] ${key}`);
      skipped += 1;
      continue;
    }

    const count = await entity.countRows(db, ctx, partition);
    if (count === 0) {
      console.log(`  [skip-empty]    ${key}`);
      empty += 1;
      continue;
    }

    if (args.dryRun) {
      console.log(`  [dry-run]       would write ${key}  (${count} rows)`);
      totalRecords += count;
      written += 1;
      writtenPartitions.push(tag);
      continue;
    }

    let cursor: unknown | null = null;
    let fetched = 0;
    const collected: unknown[] = [];
    while (true) {
      const { rows, nextCursor } = await entity.fetchBatch(
        db,
        ctx,
        partition,
        cursor,
        args.batchSize
      );
      if (rows.length === 0) break;
      collected.push(...rows);
      fetched += rows.length;
      cursor = nextCursor;
      if (cursor === null) break;
    }

    if (fetched !== count) {
      console.warn(
        `  [warn] count mismatch on ${key}: expected ${count}, fetched ${fetched} (table may have changed mid-run)`
      );
    }

    const result = await s3.putJsonLines(key, collected, { overwrite: true });
    totalRecords += result.count ?? fetched;
    written += 1;
    writtenPartitions.push(tag);
    console.log(`  [wrote]         ${key}  (${result.count ?? fetched} rows)`);
  }

  const status: EntityManifest['status'] =
    written === 0 && skipped === 0 ? 'empty' : written === 0 && skipped > 0 ? 'skipped' : 'success';

  const dateRange =
    entity.partitionStrategy === 'date' && writtenPartitions.length > 0
      ? {
          from: writtenPartitions[0],
          to: writtenPartitions[writtenPartitions.length - 1],
        }
      : null;

  const manifest: EntityManifest = {
    schemaVersion: 1,
    s3Prefix: entityPrefix,
    exportMode: 'full',
    source: 'existing_ingestion',
    league: 'nba',
    season: args.season,
    entity: entity.entity,
    sourceTable: entity.sourceTable,
    exportedAt: new Date().toISOString(),
    recordCount: totalRecords,
    dateRange,
    partitions: entity.partitionStrategy === 'date' ? writtenPartitions : [],
    status,
    notes: entity.notes ?? null,
  };

  const manifestKey = `${entityPrefix}/_manifest.json`;
  if (args.dryRun) {
    console.log(`  [dry-run]       would write ${manifestKey}`);
    console.log(`  [dry-run]       manifest preview:`);
    console.log(indent(JSON.stringify(manifest, null, 2), '                  '));
  } else {
    await s3.putJson(manifestKey, manifest, { overwrite: true });
    console.log(`  [manifest]      ${manifestKey}`);
  }

  return {
    entity: entity.entity,
    status,
    recordCount: totalRecords,
    partitions: writtenPartitions.length,
    written,
    skipped,
    empty,
    durationMs: Date.now() - start,
  };
}

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const dbUrl = requireEnv('SUPABASE_DB_URL');
  const bucket = requireEnv('NBA_DATA_BUCKET');
  const rawPrefix = (process.env.NBA_RAW_PREFIX ?? 'raw').replace(/^\/+|\/+$/g, '') || 'raw';
  const region = process.env.AWS_REGION?.trim() || 'us-east-1';

  console.log('=== Archive existing season to S3 ===');
  console.log(`  season       : ${args.season}`);
  console.log(`  bucket       : s3://${bucket}/${rawPrefix}/source=existing_ingestion/...`);
  console.log(`  region       : ${region}`);
  console.log(`  entities     : ${args.entities ? args.entities.join(',') : '(all)'}`);
  console.log(`  dry-run      : ${args.dryRun}`);
  console.log(`  overwrite    : ${args.overwrite}`);
  console.log(`  batch-size   : ${args.batchSize}`);

  const useSsl = dbUrl.includes('supabase.co') || dbUrl.includes('pooler.supabase.com');
  const db = new Pool({
    connectionString: dbUrl,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    max: 1,
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 60000),
  });

  const s3 = new S3Storage({ bucket, region });

  let exitCode = 0;
  const startedAt = new Date().toISOString();
  const summaries: EntitySummary[] = [];

  try {
    const ctx = await computeSeasonContext(db, args.season);
    console.log(`  seasonWindow : ${ctx.seasonStart} -> ${ctx.seasonEnd} (ET)`);

    const selected: EntityDef[] = args.entities
      ? args.entities.map((n) => findEntity(n)!).filter(Boolean)
      : [...ENTITIES];

    for (const entity of selected) {
      try {
        const summary = await archiveEntity({ entity, db, s3, rawPrefix, args, ctx });
        summaries.push(summary);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[error] entity=${entity.entity}: ${msg}`);
        summaries.push({
          entity: entity.entity,
          status: 'error',
          recordCount: 0,
          partitions: 0,
          written: 0,
          skipped: 0,
          empty: 0,
          durationMs: 0,
          error: msg,
        });
        exitCode = 1;
      }
    }

    const runLog = {
      schemaVersion: 1,
      source: 'existing_ingestion' as const,
      league: 'nba' as const,
      season: args.season,
      seasonWindow: { from: ctx.seasonStart, to: ctx.seasonEnd },
      startedAt,
      completedAt: new Date().toISOString(),
      args: {
        entities: args.entities ?? '(all)',
        dryRun: args.dryRun,
        overwrite: args.overwrite,
        batchSize: args.batchSize,
      },
      entities: summaries,
    };

    const runLogKey = `${rawPrefix}/source=existing_ingestion/league=nba/season=${args.season}/_run_log.json`;
    if (args.dryRun) {
      console.log(`\n[dry-run] would write ${runLogKey}`);
    } else {
      await s3.putJson(runLogKey, runLog, { overwrite: true });
      console.log(`\n[run-log] ${runLogKey}`);
    }

    console.log('\n=== Summary ===');
    for (const s of summaries) {
      const durationSec = (s.durationMs / 1000).toFixed(1);
      const tail = s.error ? `  ERROR: ${s.error}` : '';
      console.log(
        `  ${s.entity.padEnd(28)} ${s.status.padEnd(8)} rows=${String(s.recordCount).padStart(7)} ` +
          `parts=${String(s.partitions).padStart(3)} wrote=${s.written} skipped=${s.skipped} empty=${s.empty} ` +
          `(${durationSec}s)${tail}`
      );
    }
    console.log(args.dryRun ? '\n[dry-run] no S3 objects were written.' : '\nDone.');
  } finally {
    await db.end().catch(() => {});
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[fatal] unhandled error:', err);
  process.exit(1);
});
