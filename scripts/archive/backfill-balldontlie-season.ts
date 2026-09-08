/**
 * Backfill raw BallDontLie API responses to S3 under
 *   raw/source=balldontlie/league=nba/season=<S>/entity=<e>/page=<n>.json
 *
 * Provenance is intentionally separate from Slice 1A (`source=existing_ingestion`).
 * This script never reads/writes Postgres.
 *
 * Resumable: pages already in S3 are skipped, but the cursor from the existing
 * page is read so subsequent pages can continue without restarting from page=1.
 *
 * Usage:
 *   tsx scripts/archive/backfill-balldontlie-season.ts --season=2025 --dry-run
 *   tsx scripts/archive/backfill-balldontlie-season.ts --season=2025
 *   tsx scripts/archive/backfill-balldontlie-season.ts --season=2025 "--entities=teams,games"
 *   tsx scripts/archive/backfill-balldontlie-season.ts --season=2025 --overwrite
 *   tsx scripts/archive/backfill-balldontlie-season.ts --season=2025 --per-page=100 --request-delay-ms=12000
 *
 * Required env: BALLDONTLIE_API_KEY (or BALDONTLIE_API_KEY), NBA_DATA_BUCKET
 * Optional env: AWS_REGION (default us-east-1), NBA_RAW_PREFIX (default raw),
 *               BALLDONTLIE_REQUEST_DELAY_MS, MAX_RETRIES.
 */

import 'dotenv/config';
import { S3Storage } from '@/lib/aws/s3';
import {
  acquireBdlAcquisitionLock,
  type AcquisitionLockHandle,
} from '@/lib/balldontlie/acquisition-lock';
import {
  BdlArchiveClient,
  readBdlApiKey,
  type BdlClientMetrics,
  type BdlEnvelope,
  type PaginationStyle,
} from '@/lib/balldontlie/archive-client';
import { assertTrialExecuteAllowed, resolveBdlRequestDelayMs } from '@/lib/balldontlie/trial-limiter';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';

type EntityName = 'teams' | 'players' | 'games' | 'player_stats';

type EntityDef = {
  /** Entity slug used in S3 key `entity=<...>` and CLI flag. */
  entity: EntityName;
  /** BDL endpoint path under v1 base. */
  endpoint: string;
  paginationStyle: PaginationStyle;
  /** Returns endpoint params for a given season. */
  paramsFor: (season: number) => Record<string, string | number | string[]>;
  notes: string;
};

const ENTITIES: readonly EntityDef[] = [
  {
    entity: 'teams',
    endpoint: '/teams',
    paginationStyle: 'page',
    paramsFor: () => ({}),
    notes: 'League-wide static dimension; not season-scoped on the BDL side.',
  },
  {
    entity: 'players',
    endpoint: '/players',
    paginationStyle: 'cursor',
    paramsFor: () => ({}),
    notes: 'BDL /players returns all players; not server-side scoped to a single season.',
  },
  {
    entity: 'games',
    endpoint: '/games',
    paginationStyle: 'cursor',
    paramsFor: (season) => ({ 'seasons[]': String(season) }),
    notes: 'Filtered by seasons[]=<season>.',
  },
  {
    entity: 'player_stats',
    endpoint: '/stats',
    paginationStyle: 'cursor',
    paramsFor: (season) => ({ 'seasons[]': String(season) }),
    notes: 'BDL endpoint is /stats; we expose it under entity=player_stats for naming clarity.',
  },
] as const;

const ENTITY_NAMES = ENTITIES.map((e) => e.entity);

type CliArgs = {
  season: number;
  entities: EntityName[] | null;
  dryRun: boolean;
  overwrite: boolean;
  perPage: number;
  requestDelayMs?: number;
  maxRetries?: number;
};

export type BackfillRunResult = {
  exitCode: number;
  season: number;
  dryRun: boolean;
  summaries: EntitySummary[];
  metrics: BdlClientMetrics;
  delayMs: number;
  trialMode: boolean;
  concurrency: 1 | 'unbounded';
  runLogKey: string;
};

type EntityManifest = {
  schemaVersion: 1;
  s3Prefix: string;
  exportMode: 'backfill';
  source: 'balldontlie';
  league: 'nba';
  season: number;
  entity: EntityName;
  endpoint: string;
  paginationStyle: PaginationStyle;
  perPage: number;
  fetchedAt: string;
  pageCount: number;
  recordCount: number;
  status: 'success' | 'partial' | 'skipped' | 'empty' | 'error' | 'dry-run';
  notes: string;
};

type EntitySummary = {
  entity: EntityName;
  status: EntityManifest['status'];
  pageCount: number;
  recordCount: number;
  written: number;
  skipped: number;
  durationMs: number;
  error?: string;
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
    fatal('Missing or invalid --season=<YYYY>. Example: --season=2025.');
  }

  const entitiesRaw = flags['entities'];
  let entities: EntityName[] | null = null;
  if (typeof entitiesRaw === 'string' && entitiesRaw.trim().length > 0) {
    const parsed = entitiesRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const unknown = parsed.filter((n) => !(ENTITY_NAMES as readonly string[]).includes(n));
    if (unknown.length > 0) {
      fatal(
        `Unknown --entities: ${unknown.join(', ')}. Known entities: ${ENTITY_NAMES.join(', ')}`
      );
    }
    entities = parsed as EntityName[];
  }

  const perPageRaw = flags['per-page'];
  let perPage = 100;
  if (typeof perPageRaw === 'string') {
    const n = Number(perPageRaw);
    if (!Number.isFinite(n) || n < 1 || n > 100) fatal('--per-page must be 1..100 (BDL caps at 100).');
    perPage = Math.floor(n);
  }

  const reqDelayRaw = flags['request-delay-ms'];
  const requestDelayMs =
    typeof reqDelayRaw === 'string' ? Math.max(0, Math.floor(Number(reqDelayRaw))) : undefined;
  if (requestDelayMs !== undefined && !Number.isFinite(requestDelayMs)) {
    fatal('--request-delay-ms must be a non-negative integer.');
  }

  const maxRetriesRaw = flags['max-retries'];
  const maxRetries =
    typeof maxRetriesRaw === 'string' ? Math.max(0, Math.floor(Number(maxRetriesRaw))) : undefined;
  if (maxRetries !== undefined && !Number.isFinite(maxRetries)) {
    fatal('--max-retries must be a non-negative integer.');
  }

  return {
    season: Number(seasonRaw as string),
    entities,
    dryRun: flags['dry-run'] === true,
    overwrite: flags['overwrite'] === true,
    perPage,
    requestDelayMs,
    maxRetries,
  };
}

function buildEntityPrefix(rawPrefix: string, season: number, entity: EntityName): string {
  return `${rawPrefix}/source=balldontlie/league=nba/season=${season}/entity=${entity}`;
}

function pageKey(entityPrefix: string, pageIndex: number): string {
  return `${entityPrefix}/page=${pageIndex}.json`;
}

function manifestKey(entityPrefix: string): string {
  return `${entityPrefix}/_manifest.json`;
}

function recordCount(env: BdlEnvelope): number {
  return Array.isArray(env.data) ? env.data.length : 0;
}

function nextCursorFrom(env: BdlEnvelope): number | string | null {
  return env.meta?.next_cursor ?? null;
}

function nextPageFrom(env: BdlEnvelope): number | null {
  const np = env.meta?.next_page;
  return typeof np === 'number' ? np : null;
}

async function backfillEntity(opts: {
  entity: EntityDef;
  args: CliArgs;
  s3: S3Storage;
  client: BdlArchiveClient;
  rawPrefix: string;
}): Promise<EntitySummary> {
  const { entity, args, s3, client, rawPrefix } = opts;
  const start = Date.now();
  const entityPrefix = buildEntityPrefix(rawPrefix, args.season, entity.entity);
  const baseParams = entity.paramsFor(args.season);

  console.log(`\n[entity] ${entity.entity}  (BDL ${entity.endpoint})`);
  console.log(`         pagination=${entity.paginationStyle}  perPage=${args.perPage}`);
  console.log(`         params=${JSON.stringify(baseParams)}`);

  let pageIndex = 1;
  let cursor: number | string | null = null;
  let pageNumberForPaged = 1;
  let totalRecords = 0;
  let written = 0;
  let skipped = 0;
  let dryRunPagesPlanned = 0;
  let status: EntityManifest['status'] = 'success';

  // Resume: walk forward through any already-archived pages, harvesting their
  // cursor / next_page so we know where to pick up.
  if (!args.overwrite && !args.dryRun) {
    while (true) {
      const key = pageKey(entityPrefix, pageIndex);
      if (!(await s3.objectExists(key))) break;

      const existing = await s3.getJson<BdlEnvelope>(key);
      if (!existing) break;
      const recs = recordCount(existing);
      totalRecords += recs;
      skipped += 1;
      console.log(`  [skip-existing] page=${pageIndex} (${recs} records)`);

      if (entity.paginationStyle === 'cursor') {
        const next = nextCursorFrom(existing);
        if (next === null) {
          console.log(`  [resume] page=${pageIndex} was the last archived page (no next_cursor); entity already complete.`);
          return finalize({
            entity,
            entityPrefix,
            args,
            pageCount: pageIndex,
            totalRecords,
            written,
            skipped,
            start,
            status: 'success',
          }, s3);
        }
        cursor = next;
      } else {
        const next = nextPageFrom(existing);
        if (next === null) {
          console.log(`  [resume] page=${pageIndex} was the last archived page (no next_page); entity already complete.`);
          return finalize({
            entity,
            entityPrefix,
            args,
            pageCount: pageIndex,
            totalRecords,
            written,
            skipped,
            start,
            status: 'success',
          }, s3);
        }
        pageNumberForPaged = next;
      }
      pageIndex += 1;
    }
  }

  // Walk new pages from BDL (cursor / page provided by paginate).
  const startCursor = entity.paginationStyle === 'cursor' ? cursor : undefined;
  const startPage = entity.paginationStyle === 'page' ? pageNumberForPaged : undefined;

  if (args.dryRun) {
    console.log(
      `  [dry-run]       would call BDL ${entity.endpoint} starting at ` +
        (entity.paginationStyle === 'cursor'
          ? `cursor=${startCursor ?? '(initial)'}`
          : `page=${startPage ?? 1}`) +
        ` and write pages to ${entityPrefix}/page=N.json`
    );
    return finalize(
      {
        entity,
        entityPrefix,
        args,
        pageCount: dryRunPagesPlanned,
        totalRecords,
        written,
        skipped,
        start,
        status: 'dry-run',
      },
      s3
    );
  }

  for await (const page of client.paginate({
    path: entity.endpoint,
    params: baseParams,
    paginationStyle: entity.paginationStyle,
    perPage: args.perPage,
    startCursor,
    startPage,
  })) {
    const key = pageKey(entityPrefix, pageIndex);
    const recs = recordCount(page.body);

    // Defensive: if --overwrite was passed, allow re-writing existing keys.
    // Otherwise, this branch only fires for newly-fetched pages (resume path
    // already handled existing pages above).
    const result = await s3.putJson(key, page.body, { overwrite: args.overwrite });
    if (result.written) {
      written += 1;
      totalRecords += recs;
      console.log(`  [wrote]         ${key} (${recs} records${page.hasMore ? '' : ', last page'})`);
    } else {
      skipped += 1;
      totalRecords += recs;
      console.log(`  [skip-existing] ${key} (${recs} records)`);
    }

    pageIndex += 1;
    if (!page.hasMore) break;
  }

  return finalize(
    {
      entity,
      entityPrefix,
      args,
      pageCount: written + skipped,
      totalRecords,
      written,
      skipped,
      start,
      status,
    },
    s3
  );
}

async function finalize(
  data: {
    entity: EntityDef;
    entityPrefix: string;
    args: CliArgs;
    pageCount: number;
    totalRecords: number;
    written: number;
    skipped: number;
    start: number;
    status: EntityManifest['status'];
  },
  s3: S3Storage
): Promise<EntitySummary> {
  const { entity, entityPrefix, args, pageCount, totalRecords, written, skipped, start, status } =
    data;

  const computedStatus: EntityManifest['status'] =
    status !== 'success'
      ? status
      : pageCount === 0
      ? 'empty'
      : written === 0 && skipped > 0
      ? 'skipped'
      : 'success';

  const manifest: EntityManifest = {
    schemaVersion: 1,
    s3Prefix: entityPrefix,
    exportMode: 'backfill',
    source: 'balldontlie',
    league: 'nba',
    season: args.season,
    entity: entity.entity,
    endpoint: entity.endpoint,
    paginationStyle: entity.paginationStyle,
    perPage: args.perPage,
    fetchedAt: new Date().toISOString(),
    pageCount,
    recordCount: totalRecords,
    status: computedStatus,
    notes:
      computedStatus === 'dry-run'
        ? `Dry-run: BDL was not called. ${entity.notes}`
        : `Raw BallDontLie API response archive before access expires. ${entity.notes}`,
  };

  const mKey = manifestKey(entityPrefix);
  if (args.dryRun) {
    console.log(`  [dry-run]       would write ${mKey}`);
  } else {
    await s3.putJson(mKey, manifest, { overwrite: true });
    console.log(`  [manifest]      ${mKey}`);
  }

  return {
    entity: entity.entity,
    status: computedStatus,
    pageCount,
    recordCount: totalRecords,
    written,
    skipped,
    durationMs: Date.now() - start,
  };
}

export async function runBackfillBalldontlieSeason(
  argv: string[],
  opts?: { skipLock?: boolean }
): Promise<BackfillRunResult> {
  const args = parseArgs(argv);

  const bucket = requireEnv('NBA_DATA_BUCKET');
  const rawPrefix = (process.env.NBA_RAW_PREFIX ?? 'raw').replace(/^\/+|\/+$/g, '') || 'raw';
  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  const delay = resolveBdlRequestDelayMs({ requestedDelayMs: args.requestDelayMs });

  if (!args.dryRun) {
    assertTrialExecuteAllowed();
    const mode = readIngestionMode();
    const pin = getAnalyticsSeason();
    const unsafe: string[] = [];
    if (mode.dataMode !== 'replay') unsafe.push(`DATA_MODE=${mode.dataMode || '(empty)'}`);
    if (!mode.offseason) unsafe.push('OFFSEASON_MODE not 1');
    if (!mode.cronDryRun) unsafe.push('CRON_DRY_RUN not 1');
    if (pin !== '2025') unsafe.push(`season pin ${pin}`);
    if (unsafe.length) {
      throw new Error(`Refusing BDL archive execute: ${unsafe.join('; ')}`);
    }
  }

  const apiKey = args.dryRun
    ? (process.env.BALLDONTLIE_API_KEY?.trim() ||
        process.env.BALDONTLIE_API_KEY?.trim() ||
        'dry-run-placeholder')
    : readBdlApiKey();

  console.log('=== Backfill BallDontLie season to S3 ===');
  console.log(`  season            : ${args.season}`);
  console.log(`  bucket            : s3://${bucket}/${rawPrefix}/source=balldontlie/...`);
  console.log(`  region            : ${region}`);
  console.log(`  entities          : ${args.entities ? args.entities.join(',') : '(all)'}`);
  console.log(`  dry-run           : ${args.dryRun}`);
  console.log(`  overwrite         : ${args.overwrite}`);
  console.log(`  per-page          : ${args.perPage}`);
  console.log(`  request-delay-ms  : ${delay.delayMs} (${delay.source})`);
  console.log(`  trial-mode        : ${delay.trialMode}`);
  console.log(`  concurrency       : ${delay.concurrency}`);
  console.log(`  max-retries       : ${args.maxRetries ?? process.env.MAX_RETRIES ?? '3 (default)'}`);
  console.log(`  postgres          : none (S3 archive only)`);

  let lock: AcquisitionLockHandle | null = null;
  if (!args.dryRun && !opts?.skipLock) {
    lock = acquireBdlAcquisitionLock();
    console.log(`  lock              : acquired ${lock.path}`);
  }

  try {
    const s3 = new S3Storage({ bucket, region });
    const client = new BdlArchiveClient({
      apiKey,
      requestDelayMs: args.requestDelayMs,
      maxRetries: args.maxRetries,
    });

    const selected: EntityDef[] = args.entities
      ? args.entities
          .map((n) => ENTITIES.find((e) => e.entity === n))
          .filter((e): e is EntityDef => e !== undefined)
      : [...ENTITIES];

    const startedAt = new Date().toISOString();
    const summaries: EntitySummary[] = [];
    let exitCode = 0;

    for (const entity of selected) {
      try {
        const summary = await backfillEntity({ entity, args, s3, client, rawPrefix });
        summaries.push(summary);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[error] entity=${entity.entity}: ${msg}`);
        summaries.push({
          entity: entity.entity,
          status: 'error',
          pageCount: 0,
          recordCount: 0,
          written: 0,
          skipped: 0,
          durationMs: 0,
          error: msg,
        });
        exitCode = 1;
      }
    }

    const runLog = {
      schemaVersion: 1,
      source: 'balldontlie' as const,
      league: 'nba' as const,
      season: args.season,
      startedAt,
      completedAt: new Date().toISOString(),
      args: {
        entities: args.entities ?? '(all)',
        dryRun: args.dryRun,
        overwrite: args.overwrite,
        perPage: args.perPage,
      },
      metrics: client.getMetrics(),
      entities: summaries,
    };

    const runLogKey = `${rawPrefix}/source=balldontlie/league=nba/season=${args.season}/_run_log.json`;
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
        `  ${s.entity.padEnd(14)} ${s.status.padEnd(8)} pages=${String(s.pageCount).padStart(4)} ` +
          `records=${String(s.recordCount).padStart(7)} wrote=${s.written} skipped=${s.skipped} ` +
          `(${durationSec}s)${tail}`
      );
    }
    console.log(args.dryRun ? '\n[dry-run] no S3 objects were written and BDL was not called.' : '\nDone.');

    return {
      exitCode,
      season: args.season,
      dryRun: args.dryRun,
      summaries,
      metrics: client.getMetrics(),
      delayMs: delay.delayMs,
      trialMode: delay.trialMode,
      concurrency: delay.concurrency,
      runLogKey,
    };
  } finally {
    lock?.release();
  }
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').includes('backfill-balldontlie-season');
if (invokedDirectly) {
  runBackfillBalldontlieSeason(process.argv.slice(2))
    .then((r) => process.exit(r.exitCode))
    .catch((err) => {
      console.error('[fatal] unhandled error:', err);
      process.exit(1);
    });
}
