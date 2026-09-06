/**
 * Assemble a compact platform-health report from existing tables, manifests,
 * and coverage gates. Missing sections become UNKNOWN rather than throwing.
 */

import { query, queryOne } from '@/lib/db';
import pool from '@/lib/db';
import {
  isFrozenInjuryServing,
  resolveInjuryFreshnessHours,
} from '@/lib/injuries/freshness';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { getAnalyticsSeason } from '@/lib/season';
import {
  buildManifestKey,
  RAW_INJURIES_ARCHIVE_SPEC,
  RAW_ODDS_ARCHIVE_SPEC,
  RAW_PROPS_ARCHIVE_SPEC,
  validateManifestMetadata,
  type ArchiveEntitySpec,
  type ArchiveS3Reader,
} from '@/lib/prune/archive-gate';
import { evaluateOddsCompactCoverage } from '@/lib/prune/odds-coverage-gate';
import { evaluateInjuryTransitionCoverage } from '@/lib/prune/injury-coverage-gate';
import { countPendingClosingLinesForPruneEligible } from '@/lib/prune/closing-lines';
import { createArchiveS3FromEnv } from '@/lib/prune/run-prune-props';
import { buildEntityPrefix, type EntityManifest } from '@/scripts/archive/archive-entity-core';
import {
  classifyArchiveManifest,
  classifyCoverage,
  classifyIngestionSource,
  classifyInjuryServing,
  classifyPruneOutcome,
  HEALTH_WARNING_THRESHOLDS,
  LIVE_INGEST_STALE_HOURS,
  rollupHealthStatus,
  type HealthStatus,
} from './health-status';

export const PRIORITY_RELATIONS = [
  'raw.player_prop_snapshots_v2',
  'raw.odds_snapshots',
  'raw.player_injuries',
  'raw.player_game_stats',
  'analytics.game_odds_history',
  'analytics.player_game_logs',
  'analytics.player_injury_status_history',
  'research.prop_decision_lines',
] as const;

export type HealthSection = {
  status: HealthStatus;
  reason: string;
};

export type IngestionSourceHealth = HealthSection & {
  source: string;
  tracked: boolean;
  latestStatus: string | null;
  lastSuccessAt: string | null;
  lastStartedAt: string | null;
  rowsStored: number | null;
};

export type ArchiveEntityHealth = HealthSection & {
  entity: string;
  sourceTable: string;
  season: number;
  manifestStatus: string | null;
  recordCount: number | null;
  partitionCount: number | null;
  exportedAt: string | null;
};

export type CoverageHealth = HealthSection & {
  kind: string;
  unresolved: number | null;
};

export type PlatformHealthReport = {
  generatedAt: string;
  overall: HealthStatus;
  freeze: {
    dataMode: string;
    offseason: boolean;
    cronDryRun: boolean;
    frozen: boolean;
  };
  database: HealthSection & {
    sizePretty: string | null;
    sizeBytes: number | null;
    largest: Array<{ name: string; sizePretty: string; sizeBytes: number }>;
    rowCounts: Array<{ name: string; rows: number | null }>;
  };
  ingestion: IngestionSourceHealth[];
  injuryServing: HealthSection & {
    latestSnapshotAt: string | null;
    ageHours: number | null;
    authoritative: boolean;
  };
  archives: ArchiveEntityHealth[];
  coverage: CoverageHealth[];
  prune: HealthSection & {
    note: string;
  };
  s3: HealthSection & {
    note: string;
    entities: Array<{ entity: string; recordCount: number | null; exportedAt: string | null }>;
  };
  thresholds: typeof HEALTH_WARNING_THRESHOLDS;
};

const CACHE_TTL_MS = 60_000;
let cachedReport: { expiresAt: number; report: PlatformHealthReport } | null = null;

export function clearPlatformHealthCache(): void {
  cachedReport = null;
}

type CoverageDb = {
  query: (
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

function coverageDb(): CoverageDb {
  return {
    query: async (sql, params) => {
      const rows = await query<Record<string, unknown>>(sql, params);
      return { rows };
    },
  };
}

async function safeSection<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error('[platform-health]', err instanceof Error ? err.message : err);
    return fallback;
  }
}

async function loadPullRun(table: string): Promise<{
  latestStatus: string | null;
  lastSuccessAt: string | null;
  lastStartedAt: string | null;
  rowsStored: number | null;
}> {
  const latest = await queryOne<{
    status: string | null;
    pulled_at: string | Date | null;
    completed_at: string | Date | null;
    rows_stored: number | string | null;
  }>(
    `SELECT status, pulled_at, completed_at, rows_stored
     FROM ${table}
     ORDER BY pull_run_id DESC
     LIMIT 1`
  );
  const lastSuccess = await queryOne<{ pulled_at: string | Date | null }>(
    `SELECT pulled_at
     FROM ${table}
     WHERE status = 'success'
     ORDER BY pull_run_id DESC
     LIMIT 1`
  );
  return {
    latestStatus: latest?.status ?? null,
    lastSuccessAt: lastSuccess?.pulled_at ? new Date(lastSuccess.pulled_at).toISOString() : null,
    lastStartedAt: latest?.pulled_at ? new Date(latest.pulled_at).toISOString() : null,
    rowsStored: latest?.rows_stored != null ? Number(latest.rows_stored) : null,
  };
}

async function loadDatabase(): Promise<PlatformHealthReport['database']> {
  const size = await queryOne<{ pretty: string; bytes: string }>(
    `SELECT pg_size_pretty(pg_database_size(current_database())) AS pretty,
            pg_database_size(current_database())::text AS bytes`
  );
  const largest = await query<{ name: string; pretty: string; bytes: string }>(
    `SELECT n.nspname || '.' || c.relname AS name,
            pg_size_pretty(pg_total_relation_size(c.oid)) AS pretty,
            pg_total_relation_size(c.oid)::text AS bytes
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('raw', 'analytics', 'research', 'public')
       AND c.relkind IN ('r', 'm')
     ORDER BY pg_total_relation_size(c.oid) DESC
     LIMIT 8`
  );
  const rowCounts: Array<{ name: string; rows: number | null }> = [];
  for (const name of PRIORITY_RELATIONS) {
    try {
      const row = await queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM ${name}`);
      rowCounts.push({ name, rows: Number(row?.n ?? 0) });
    } catch {
      rowCounts.push({ name, rows: null });
    }
  }
  return {
    status: size ? 'HEALTHY' : 'UNKNOWN',
    reason: size ? 'database size readable' : 'database size unavailable',
    sizePretty: size?.pretty ?? null,
    sizeBytes: size?.bytes != null ? Number(size.bytes) : null,
    largest: largest.map((r) => ({
      name: r.name,
      sizePretty: r.pretty,
      sizeBytes: Number(r.bytes),
    })),
    rowCounts,
  };
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function collectPlatformHealth(opts?: {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  s3?: ArchiveS3Reader | null;
}): Promise<PlatformHealthReport> {
  const env = opts?.env ?? process.env;
  const now = opts?.now ?? new Date();
  const mode = readIngestionMode(env);
  const frozen = mode.shouldSkipMutations;
  const season = Number(getAnalyticsSeason(env, now));
  const rawPrefix = (env.NBA_RAW_PREFIX?.trim() || 'raw').replace(/\/+$/, '');

  const database = await safeSection(loadDatabase, {
    status: 'UNKNOWN' as const,
    reason: 'database metrics unavailable',
    sizePretty: null,
    sizeBytes: null,
    largest: [],
    rowCounts: PRIORITY_RELATIONS.map((name) => ({ name, rows: null })),
  });

  const ingestSpecs: Array<{
    source: string;
    table: string | null;
    staleHours: number;
  }> = [
    { source: 'schedule', table: null, staleHours: LIVE_INGEST_STALE_HOURS.default },
    { source: 'props', table: 'raw.player_prop_pull_runs', staleHours: LIVE_INGEST_STALE_HOURS.props },
    { source: 'odds', table: 'raw.odds_pull_runs', staleHours: LIVE_INGEST_STALE_HOURS.odds },
    { source: 'injuries', table: 'raw.injury_pull_runs', staleHours: LIVE_INGEST_STALE_HOURS.injuries },
    { source: 'boxscores', table: null, staleHours: LIVE_INGEST_STALE_HOURS.default },
  ];

  const ingestion: IngestionSourceHealth[] = [];
  for (const spec of ingestSpecs) {
    if (!spec.table) {
      ingestion.push({
        source: spec.source,
        tracked: false,
        latestStatus: null,
        lastSuccessAt: null,
        lastStartedAt: null,
        rowsStored: null,
        status: frozen ? 'FROZEN_EXPECTED' : 'UNKNOWN',
        reason: frozen
          ? 'frozen: no pull-run table; live ingest not expected'
          : 'no pull-run table for this source',
      });
      continue;
    }
    const loaded = await safeSection(
      () => loadPullRun(spec.table!),
      {
        latestStatus: null,
        lastSuccessAt: null,
        lastStartedAt: null,
        rowsStored: null,
      }
    );
    const classified = classifyIngestionSource({
      frozen,
      latestStatus: loaded.latestStatus,
      lastSuccessAt: toDate(loaded.lastSuccessAt),
      lastStartedAt: toDate(loaded.lastStartedAt),
      now,
      staleHours: spec.staleHours,
    });
    ingestion.push({
      source: spec.source,
      tracked: true,
      ...loaded,
      ...classified,
    });
  }

  const injurySnap = await safeSection(
    () =>
      queryOne<{ snapshot_at: string | Date | null; pulled_at: string | Date | null }>(
        `SELECT c.snapshot_at, r.pulled_at
         FROM analytics.player_injury_status_current c
         LEFT JOIN raw.injury_pull_runs r ON r.pull_run_id = c.pull_run_id
         ORDER BY c.snapshot_at DESC NULLS LAST
         LIMIT 1`
      ),
    null
  );
  const latestInjuryAt = injurySnap?.snapshot_at
    ? new Date(injurySnap.snapshot_at)
    : null;
  const injuryClass = classifyInjuryServing({
    frozen: frozen || isFrozenInjuryServing(env),
    snapshotAt: latestInjuryAt && !Number.isNaN(latestInjuryAt.getTime()) ? latestInjuryAt : null,
    now,
    freshnessHours: resolveInjuryFreshnessHours(env.INJURY_FRESHNESS_HOURS),
  });
  const ageHours =
    latestInjuryAt && !Number.isNaN(latestInjuryAt.getTime())
      ? (now.getTime() - latestInjuryAt.getTime()) / (60 * 60 * 1000)
      : null;
  const injuryServing: PlatformHealthReport['injuryServing'] = {
    ...injuryClass,
    latestSnapshotAt: latestInjuryAt ? latestInjuryAt.toISOString() : null,
    ageHours,
  };

  const s3 =
    opts?.s3 !== undefined ? opts.s3 : createArchiveS3FromEnv(env);
  const archiveSpecs: ArchiveEntitySpec[] = [
    RAW_PROPS_ARCHIVE_SPEC,
    RAW_ODDS_ARCHIVE_SPEC,
    RAW_INJURIES_ARCHIVE_SPEC,
  ];
  const archives: ArchiveEntityHealth[] = [];
  for (const spec of archiveSpecs) {
    const prefix = buildEntityPrefix(rawPrefix, season, spec.entity);
    const manifestKey = buildManifestKey(prefix);
    let fetchError = false;
    const manifest = s3
      ? await (async () => {
          try {
            return await s3.getJson<EntityManifest>(manifestKey);
          } catch {
            fetchError = true;
            return null;
          }
        })()
      : null;
    const meta = validateManifestMetadata(manifest, season, spec);
    const classified = !s3
      ? { status: 'UNKNOWN' as const, reason: 'archive S3 client not configured' }
      : fetchError
        ? { status: 'UNKNOWN' as const, reason: 'archive manifest unread (credentials or network)' }
        : classifyArchiveManifest({
            present: manifest != null,
            status: manifest?.status ?? null,
            recordCount: manifest?.recordCount ?? null,
          });
    archives.push({
      entity: spec.entity,
      sourceTable: spec.sourceTable,
      season,
      manifestStatus: manifest?.status ?? null,
      recordCount: manifest?.recordCount ?? null,
      partitionCount: manifest?.partitions?.length ?? null,
      exportedAt: manifest?.exportedAt ?? null,
      status: !meta.ok && manifest != null ? 'FAILED' : classified.status,
      reason: !meta.ok && manifest != null ? meta.reason : classified.reason,
    });
  }

  const oddsCoverage = await safeSection(
    () => evaluateOddsCompactCoverage(coverageDb(), { olderThanDays: 30 }),
    null
  );
  const injuryCoverage = await safeSection(
    () => evaluateInjuryTransitionCoverage(coverageDb()),
    null
  );
  const propsPending = await safeSection(
    () => countPendingClosingLinesForPruneEligible(pool, 3),
    null
  );

  const oddsUnresolved = oddsCoverage
    ? oddsCoverage.missingHistory.length + oddsCoverage.missingCurrent.length
    : null;
  const injuryUnresolved = injuryCoverage
    ? injuryCoverage.unresolvedLeaveReports +
      injuryCoverage.missingFirstSeen +
      injuryCoverage.missingChanges +
      injuryCoverage.duplicateLeaveReports
    : null;

  const coverage: CoverageHealth[] = [
    { kind: 'props_closing_lines', unresolved: propsPending, ...classifyCoverage(propsPending) },
    { kind: 'odds_history_current', unresolved: oddsUnresolved, ...classifyCoverage(oddsUnresolved) },
    {
      kind: 'injury_meaningful_history',
      unresolved: injuryUnresolved,
      ...classifyCoverage(injuryUnresolved),
    },
  ];

  const pruneClass = classifyPruneOutcome({
    dryRun: true,
    outcome: null,
    pruneAllowed: null,
    maxDeleteAllowed: null,
    archiveOk: null,
    coverageOk: null,
  });
  const prune: PlatformHealthReport['prune'] = {
    ...pruneClass,
    note:
      'Prune audits are console JSON only (not stored in Postgres). A max-delete refusal is a safe skip, not a generic failure. Execute remains gated by freeze/env.',
  };

  const s3Section: PlatformHealthReport['s3'] = {
    status: rollupHealthStatus(archives.map((a) => a.status)),
    reason: 'manifest-derived; byte totals are not scanned on page load',
    note: 'Use scripts/ops/platform-health-snapshot.ts --s3-bytes for approximate prefix sizes.',
    entities: archives.map((a) => ({
      entity: a.entity,
      recordCount: a.recordCount,
      exportedAt: a.exportedAt,
    })),
  };

  const overall = rollupHealthStatus([
    database.status,
    ...ingestion.filter((i) => i.tracked).map((i) => i.status),
    injuryServing.status,
    ...archives.map((a) => a.status),
    ...coverage.map((c) => c.status),
    ...(prune.status === 'UNKNOWN' ? [] : [prune.status]),
  ]);

  return {
    generatedAt: now.toISOString(),
    overall: frozen && overall === 'HEALTHY' ? 'FROZEN_EXPECTED' : overall,
    freeze: {
      dataMode: mode.dataMode || '(missing)',
      offseason: mode.offseason,
      cronDryRun: mode.cronDryRun,
      frozen,
    },
    database,
    ingestion,
    injuryServing,
    archives,
    coverage,
    prune,
    s3: s3Section,
    thresholds: HEALTH_WARNING_THRESHOLDS,
  };
}

export async function getCachedPlatformHealth(opts?: {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  s3?: ArchiveS3Reader | null;
  force?: boolean;
}): Promise<PlatformHealthReport> {
  const bypass =
    Boolean(opts?.force) ||
    opts?.now != null ||
    opts?.s3 !== undefined ||
    opts?.env != null;
  if (!bypass && cachedReport && Date.now() < cachedReport.expiresAt) {
    return cachedReport.report;
  }
  const report = await collectPlatformHealth(opts);
  if (!bypass) {
    cachedReport = { expiresAt: Date.now() + CACHE_TTL_MS, report };
  }
  return report;
}
