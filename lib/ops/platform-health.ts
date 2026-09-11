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
import {
  classifyFeedFreshness,
  classifyIdentityObservability,
  classifyMissedRun,
  classifyQueueHealth,
  classifyReservedConcurrency,
  classifyScheduleCompleteness,
  classifyScheduleMismatch,
  classifyVolumeAnomaly,
  correlateExecutionAndFreshness,
  FEED_SLA_HOURS,
  INGESTION_FAMILY_CATALOG,
  resolveFeedConfig,
  SCHEDULE_2026_EXPECTED_RS,
  SCHEDULE_2026_PROVIDER_PUBLISHED,
  type AwsScheduleObserved,
  type ExecutionCorrelation,
  type FeedConfigState,
  type FreshnessState,
  type MissedRunStatus,
  type ReservedConcurrencyState,
} from './ingestion-observability';
import { INGESTION_CADENCE } from './ingestion-cadence';
import {
  classifyProviderCapabilityHealth,
  PROVIDER_CAPABILITY_CATALOG,
  type ProviderCapabilityState,
} from './provider-capability';
import type { AwsLambdaLiveStatus, AwsQueueLiveStatus } from './aws-ingestion-status';
import { classifyPostgameOpsHealth } from '@/lib/postgame';

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

export type IdentityHealth = HealthSection & {
  unresolved: number;
  conflicts: number;
  resolved: number;
  classCCanonical: number;
  alert: boolean;
};

export type IngestionFamilyHealth = HealthSection & {
  id: string;
  label: string;
  config: FeedConfigState;
  freshness: FreshnessState;
  freshnessSource: string;
  lastSuccessAt: string | null;
  lastInvocationAt: string | null;
  lastInvocationSuccess: 'UNKNOWN' | null;
  awsState: AwsScheduleObserved | 'NOT_DEPLOYED' | 'UNKNOWN';
  missedRun: MissedRunStatus;
  correlation: ExecutionCorrelation;
};

export type ScheduleCompletenessHealth = HealthSection & {
  localCount: number | null;
  providerPublished: number;
  expectedRs: number;
  unpublished: number;
  reconciliation: string;
};

export type QueueHealth = HealthSection & {
  id: string;
  label: string;
  deployed: boolean | null;
  deployState: 'DEPLOYED' | 'NOT_DEPLOYED' | 'UNKNOWN';
  queueDepth: number | null;
  inFlight: number | null;
  oldestAgeSeconds: number | null;
  dlqDepth: number | null;
  reservedConcurrencyApplied: boolean | null;
  reservedConcurrency: ReservedConcurrencyState;
};

export type ProviderCapabilityHealth = HealthSection & {
  id: string;
  label: string;
  state: ProviderCapabilityState;
};

export type PostgameOpsHealth = HealthSection & {
  tablePresent: boolean;
  schemaState: 'PRESENT' | 'NOT_APPLIED' | 'UNKNOWN';
  queueDeployed: boolean | null;
  workerDeployed: boolean | null;
  failedCount: number;
  blockedCount: number;
  waitingCount: number;
  readyCount: number;
  byStage: Array<{ stage: string; status: string; n: number }>;
  boxProvider: ProviderCapabilityState;
};

export type OpsAwsSnapshot = {
  queried?: boolean;
  scheduleObserved?: AwsScheduleObserved;
  queueDepth?: number | null;
  oldestAgeSeconds?: number | null;
  dlqDepth?: number | null;
  reservedConcurrencyApplied?: boolean | null;
  lambdas?: AwsLambdaLiveStatus[];
  queues?: AwsQueueLiveStatus[];
};

export type PlatformHealthReport = {
  generatedAt: string;
  overall: HealthStatus;
  freeze: {
    dataMode: string;
    offseason: boolean;
    cronDryRun: boolean;
    frozen: boolean;
    liveIngestionEnabled: boolean;
  };
  database: HealthSection & {
    sizePretty: string | null;
    sizeBytes: number | null;
    largest: Array<{ name: string; sizePretty: string; sizeBytes: number }>;
    rowCounts: Array<{ name: string; rows: number | null }>;
  };
  ingestion: IngestionSourceHealth[];
  families: IngestionFamilyHealth[];
  identity: IdentityHealth;
  scheduleCompleteness: ScheduleCompletenessHealth;
  scheduleMismatch: HealthSection & { observed: AwsScheduleObserved };
  queues: QueueHealth;
  queueCards: QueueHealth[];
  providers: ProviderCapabilityHealth[];
  aws: HealthSection & { queried: boolean; available: boolean };
  postgame: PostgameOpsHealth;
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

async function loadIdentityQuarantine(): Promise<{
  unresolved: number;
  conflicts: number;
  resolved: number;
  classCCanonical: number;
}> {
  const byStatus = await query<{ status: string; n: string }>(
    `SELECT status, count(*)::text AS n
     FROM analytics.player_identity_unresolved
     GROUP BY status`
  );
  const classC = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n
     FROM analytics.player_entities e
     WHERE EXISTS (
       SELECT 1 FROM analytics.player_provider_ids n
       WHERE n.player_entity_id = e.player_entity_id AND n.provider = 'nba'
     )
     AND NOT EXISTS (
       SELECT 1 FROM analytics.player_provider_ids b
       WHERE b.player_entity_id = e.player_entity_id AND b.provider = 'balldontlie'
     )`
  );
  const count = (status: string) =>
    byStatus.filter((r) => r.status === status).reduce((a, r) => a + Number(r.n), 0);
  return {
    unresolved: count('UNRESOLVED'),
    conflicts: count('CONFLICT'),
    resolved: count('RESOLVED'),
    classCCanonical: Number(classC?.n ?? 0),
  };
}

async function loadPostgameStageCounts(): Promise<{
  rows: Array<{ stage: string; status: string; n: number }>;
  schemaState: 'PRESENT' | 'NOT_APPLIED' | 'UNKNOWN';
}> {
  try {
    const rows = await query<{ stage: string; status: string; n: string }>(
      `SELECT stage, status, count(*)::text AS n
       FROM analytics.postgame_game_stages
       GROUP BY stage, status`
    );
    return {
      rows: rows.map((row) => ({
        stage: row.stage,
        status: row.status,
        n: Number(row.n),
      })),
      schemaState: 'PRESENT',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (/does not exist|relation .*postgame_game_stages/i.test(message)) {
      return { rows: [], schemaState: 'NOT_APPLIED' };
    }
    throw err;
  }
}

async function loadServingFreshness(sql: string): Promise<string | null> {
  const row = await queryOne<{ ts: string | Date | null }>(sql);
  return row?.ts ? new Date(row.ts).toISOString() : null;
}

export async function collectPlatformHealth(opts?: {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  s3?: ArchiveS3Reader | null;
  aws?: OpsAwsSnapshot | null;
  liveIngestionEnabled?: boolean;
  goatSubscriptionActive?: boolean;
}): Promise<PlatformHealthReport> {
  const env = opts?.env ?? process.env;
  const now = opts?.now ?? new Date();
  const mode = readIngestionMode(env);
  const frozen = mode.shouldSkipMutations;
  const liveIngestionEnabled =
    opts?.liveIngestionEnabled ??
    (env.LIVE_INGESTION_ENABLED === 'true' || env.LIVE_INGESTION_ENABLED === '1');
  const goatSubscriptionActive = opts?.goatSubscriptionActive ?? env.BDL_GOAT_SUBSCRIPTION === '1';
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

  const identityLoaded = await safeSection(loadIdentityQuarantine, {
    unresolved: 0,
    conflicts: 0,
    resolved: 0,
    classCCanonical: 0,
  });
  const identityClass = classifyIdentityObservability(identityLoaded);
  const identity: IdentityHealth = {
    ...identityLoaded,
    status: identityClass.health,
    reason: identityClass.reason,
    alert: identityClass.alert,
  };

  const lastSuccessBySource = new Map(
    ingestion.map((row) => [row.source, row.lastSuccessAt] as const)
  );
  const nightlyFreshness = await safeSection(
    () =>
      loadServingFreshness(
        `SELECT max(updated_at) AS ts FROM analytics.games WHERE season = '2026'`
      ),
    null
  );
  const bbrefFreshness = await safeSection(
    () => loadServingFreshness(`SELECT max(updated_at) AS ts FROM bbref_player_game_stats`),
    null
  );
  const awsLambdas = opts?.aws?.lambdas ?? [];
  const awsQueues = opts?.aws?.queues ?? [];
  const families: IngestionFamilyHealth[] = INGESTION_FAMILY_CATALOG.map((family) => {
    const config = resolveFeedConfig({
      family,
      liveIngestionEnabled,
      freezeSkipsMutations: frozen,
      goatSubscriptionActive,
    });
    const last =
      family.id === 'schedule_nightly_bdl' || family.id === 'game_status_sync'
        ? nightlyFreshness
        : family.id === 'bbref_boxscore'
          ? bbrefFreshness
          : family.id === 'injuries'
            ? lastSuccessBySource.get('injuries') ?? injuryServing.latestSnapshotAt
            : family.id === 'game_odds'
              ? lastSuccessBySource.get('odds')
              : family.id === 'player_props_controller' || family.id === 'player_props_worker'
                ? lastSuccessBySource.get('props')
                : null;
    const freshness = classifyFeedFreshness({
      config,
      lastSuccessAt: toDate(last ?? null),
      now,
      slaHours: FEED_SLA_HOURS[family.id],
    });
    const lambda = awsLambdas.find((row) => row.familyId === family.id);
    const cadence = INGESTION_CADENCE[family.id];
    const invocationQueried = Boolean(lambda?.queried);
    const lastInvocationAt = toDate(lambda?.lastInvocationAt ?? null);
    const familySchedule = lambda?.scheduleObserved ?? (opts?.aws?.scheduleObserved ?? 'UNKNOWN');
    const missed = classifyMissedRun({
      config,
      scheduleObserved: familySchedule,
      intervalHours: cadence.intervalHours,
      graceHours: cadence.graceHours,
      lastInvocationAt,
      invocationQueried,
      now,
    });
    const ingestRow =
      family.id === 'injuries'
        ? ingestion.find((row) => row.source === 'injuries')
        : family.id === 'game_odds'
          ? ingestion.find((row) => row.source === 'odds')
          : family.id === 'player_props_controller' || family.id === 'player_props_worker'
            ? ingestion.find((row) => row.source === 'props')
            : undefined;
    const volume = classifyVolumeAnomaly({
      config,
      status: ingestRow?.latestStatus === 'partial' ? 'partial' : ingestRow?.latestStatus === 'error' || ingestRow?.latestStatus === 'failed' ? 'failed' : 'success',
      outputCount: ingestRow?.rowsStored ?? 0,
      expectedMinOutput:
        config === 'ACTIVE' &&
        (family.id === 'injuries' || family.id === 'game_odds' || family.id === 'player_props_worker')
          ? 1
          : null,
    });
    const correlated = correlateExecutionAndFreshness({
      config,
      missedRun: missed.status,
      freshness: freshness.state,
      lastInvocationAt,
      invocationQueried,
      volumeHealth: volume.health,
    });
    const status = rollupHealthStatus([
      freshness.health,
      correlated.health,
      ...(missed.status === 'CADENCE_UNSET' || missed.status === 'UNKNOWN' ? [] : [missed.health]),
    ]);
    return {
      id: family.id,
      label: family.label,
      config,
      freshness: freshness.state,
      freshnessSource: family.freshnessSource,
      lastSuccessAt: last ?? null,
      lastInvocationAt: lambda?.lastInvocationAt ?? null,
      lastInvocationSuccess: lambda ? 'UNKNOWN' : null,
      awsState: lambda?.deployState === 'NOT_DEPLOYED' ? 'NOT_DEPLOYED' : familySchedule,
      missedRun: missed.status,
      correlation: correlated.grade,
      status,
      reason: [correlated.reason, missed.reason, freshness.reason].filter(Boolean).join(' · '),
    };
  });

  const local2026 = await safeSection(async () => {
    const row = await queryOne<{ n: string }>(
      `SELECT count(*)::text AS n FROM analytics.games WHERE season = '2026'`
    );
    return row?.n != null ? Number(row.n) : null;
  }, null);
  const completenessClass = classifyScheduleCompleteness({
    localCount: local2026,
    providerPublished: SCHEDULE_2026_PROVIDER_PUBLISHED,
    expectedRs: SCHEDULE_2026_EXPECTED_RS,
  });
  const scheduleCompleteness: ScheduleCompletenessHealth = {
    status: completenessClass.health,
    reason: completenessClass.reason,
    reconciliation: completenessClass.reconciliation,
    localCount: local2026,
    providerPublished: SCHEDULE_2026_PROVIDER_PUBLISHED,
    expectedRs: SCHEDULE_2026_EXPECTED_RS,
    unpublished: SCHEDULE_2026_EXPECTED_RS - SCHEDULE_2026_PROVIDER_PUBLISHED,
  };

  const observed = opts?.aws?.scheduleObserved ?? 'UNKNOWN';
  const mismatchClass = classifyScheduleMismatch({
    liveIngestionEnabled,
    observed,
  });
  const scheduleMismatch: PlatformHealthReport['scheduleMismatch'] = {
    status: mismatchClass.health,
    reason: mismatchClass.reason,
    observed,
  };

  const propsFamily = families.find((f) => f.id === 'player_props_worker');
  const makeQueueCard = (
    id: string,
    label: string,
    live: AwsQueueLiveStatus | undefined,
    config: FeedConfigState,
    reservedApplied: boolean | null
  ): QueueHealth => {
    const deployed = live?.deployed ?? (id === 'postgame_stage' ? false : null);
    const classified = classifyQueueHealth({
      config,
      queueDepth: live?.visible ?? (id === 'player_props' ? opts?.aws?.queueDepth ?? null : null),
      oldestAgeSeconds:
        live?.oldestAgeSeconds ?? (id === 'player_props' ? opts?.aws?.oldestAgeSeconds ?? null : null),
      dlqDepth: live?.dlqDepth ?? (id === 'player_props' ? opts?.aws?.dlqDepth ?? null : null),
      reservedConcurrencyApplied: reservedApplied,
      deployed,
    });
    const reservedState = classifyReservedConcurrency(reservedApplied);
    return {
      id,
      label,
      deployed,
      deployState: live?.deployState ?? (deployed === false ? 'NOT_DEPLOYED' : 'UNKNOWN'),
      status: classified.health,
      reason: classified.reason,
      queueDepth: live?.visible ?? (id === 'player_props' ? opts?.aws?.queueDepth ?? null : null),
      inFlight: live?.notVisible ?? null,
      oldestAgeSeconds:
        live?.oldestAgeSeconds ?? (id === 'player_props' ? opts?.aws?.oldestAgeSeconds ?? null : null),
      dlqDepth: live?.dlqDepth ?? (id === 'player_props' ? opts?.aws?.dlqDepth ?? null : null),
      reservedConcurrencyApplied: reservedApplied,
      reservedConcurrency: id === 'player_props' ? reservedState.state : 'NOT_APPLICABLE',
    };
  };

  const propsLive = awsQueues.find((row) => row.id === 'player_props');
  const postgameLive = awsQueues.find((row) => row.id === 'postgame_stage');
  const queueHealth = makeQueueCard(
    'player_props',
    'Player props',
    propsLive,
    propsFamily?.config ?? 'FROZEN',
    opts?.aws?.reservedConcurrencyApplied ?? null
  );
  const postgameQueueHealth = makeQueueCard(
    'postgame_stage',
    'Postgame stages',
    postgameLive,
    'NOT_DEPLOYED',
    null
  );
  const queueCards = [queueHealth, postgameQueueHealth];

  const postgameLoaded = await safeSection(loadPostgameStageCounts, {
    rows: [] as Array<{ stage: string; status: string; n: number }>,
    schemaState: 'UNKNOWN' as const,
  });
  const postgameRows = postgameLoaded.rows ?? [];
  const countStatus = (status: string) =>
    postgameRows.filter((row) => row.status === status).reduce((sum, row) => sum + row.n, 0);
  const postgameWorker = awsLambdas.find((row) => row.id === 'postgame_stage_worker');
  const postgameClass = classifyPostgameOpsHealth({
    tablePresent: postgameLoaded.schemaState === 'PRESENT',
    frozen,
    failedCount: countStatus('FAILED'),
  });
  const queueNotDeployed = postgameQueueHealth.deployState === 'NOT_DEPLOYED';
  const workerNotDeployed = postgameWorker?.deployState === 'NOT_DEPLOYED' || postgameWorker == null;
  const schemaNotApplied = postgameLoaded.schemaState === 'NOT_APPLIED';
  const postgameNotDeployed = queueNotDeployed && workerNotDeployed && schemaNotApplied;
  const postgame: PostgameOpsHealth = {
    status: postgameNotDeployed
      ? 'FROZEN_EXPECTED'
      : postgameLoaded.schemaState === 'NOT_APPLIED'
        ? 'FROZEN_EXPECTED'
        : postgameClass.health,
    reason: postgameNotDeployed
      ? 'postgame queue/worker/schema NOT_DEPLOYED'
      : postgameLoaded.schemaState === 'NOT_APPLIED'
        ? 'analytics.postgame_game_stages NOT_APPLIED'
        : postgameClass.reason,
    tablePresent: postgameLoaded.schemaState === 'PRESENT',
    schemaState: postgameLoaded.schemaState,
    queueDeployed: postgameQueueHealth.deployed,
    workerDeployed: postgameWorker?.exists ?? (workerNotDeployed ? false : null),
    failedCount: countStatus('FAILED'),
    blockedCount: countStatus('BLOCKED'),
    waitingCount: countStatus('WAITING'),
    readyCount: countStatus('READY'),
    byStage: postgameRows,
    boxProvider: 'BLOCKED_BY_SUBSCRIPTION',
  };

  const providers: ProviderCapabilityHealth[] = PROVIDER_CAPABILITY_CATALOG.map((row) => {
    const classified = classifyProviderCapabilityHealth(row.state);
    return {
      id: row.id,
      label: row.label,
      state: row.state,
      status: classified.health,
      reason: classified.reason,
    };
  });

  const awsSection = {
    status: opts?.aws?.queried === false || opts?.aws == null
      ? ('UNKNOWN' as const)
      : opts.aws.scheduleObserved === 'UNKNOWN' && !awsLambdas.some((row) => row.queried)
        ? ('UNKNOWN' as const)
        : ('HEALTHY' as const),
    reason:
      opts?.aws == null
        ? 'AWS snapshot not queried'
        : opts.aws.queried === false
          ? 'AWS snapshot skipped or unavailable'
          : 'bounded Court Context AWS snapshot',
    queried: Boolean(opts?.aws?.queried),
    available: Boolean(awsLambdas.length || awsQueues.length),
  };

  const overall = rollupHealthStatus([
    database.status,
    ...ingestion.filter((i) => i.tracked).map((i) => i.status),
    injuryServing.status,
    identity.status,
    ...archives.map((a) => a.status),
    ...coverage.map((c) => c.status),
    ...(prune.status === 'UNKNOWN' ? [] : [prune.status]),
    ...(scheduleCompleteness.status === 'UNKNOWN' ? [] : [scheduleCompleteness.status]),
    ...(scheduleMismatch.status === 'UNKNOWN' ? [] : [scheduleMismatch.status]),
    ...(queueHealth.status === 'STALE' || queueHealth.status === 'DEGRADED' || queueHealth.status === 'FAILED'
      ? [queueHealth.status]
      : []),
    ...(postgameQueueHealth.status === 'DEGRADED' || postgameQueueHealth.status === 'FAILED'
      ? [postgameQueueHealth.status]
      : []),
    ...(postgame.status === 'UNKNOWN' || postgame.status === 'FROZEN_EXPECTED' ? [] : [postgame.status]),
    ...families
      .map((f) => f.status)
      .filter((status) => status === 'STALE' || status === 'DEGRADED' || status === 'FAILED'),
  ]);

  return {
    generatedAt: now.toISOString(),
    overall: frozen && overall === 'HEALTHY' ? 'FROZEN_EXPECTED' : overall,
    freeze: {
      dataMode: mode.dataMode || '(missing)',
      offseason: mode.offseason,
      cronDryRun: mode.cronDryRun,
      frozen,
      liveIngestionEnabled,
    },
    database,
    ingestion,
    families,
    identity,
    scheduleCompleteness,
    scheduleMismatch,
    queues: queueHealth,
    queueCards,
    providers,
    aws: awsSection,
    postgame,
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
  const env = opts?.env ?? process.env;
  let aws: OpsAwsSnapshot | undefined;
  if (env.OPS_SKIP_AWS !== '1' && env.VITEST !== 'true') {
    try {
      const { fetchAwsIngestionSnapshot } = await import('./aws-ingestion-status');
      aws = await fetchAwsIngestionSnapshot({ env, timeoutMs: 8_000 });
    } catch {
      aws = { queried: true, scheduleObserved: 'UNKNOWN' };
    }
  }
  const report = await collectPlatformHealth({ ...opts, aws });
  if (!bypass) {
    cachedReport = { expiresAt: Date.now() + CACHE_TTL_MS, report };
  }
  return report;
}
