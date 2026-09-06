/**
 * Compact platform-health statuses. Frozen September ingestion is not a failure.
 */

export type HealthStatus =
  | 'HEALTHY'
  | 'FROZEN_EXPECTED'
  | 'STALE'
  | 'DEGRADED'
  | 'FAILED'
  | 'UNKNOWN';

export const HEALTH_STATUS_RANK: Record<HealthStatus, number> = {
  HEALTHY: 0,
  FROZEN_EXPECTED: 1,
  UNKNOWN: 2,
  STALE: 3,
  DEGRADED: 4,
  FAILED: 5,
};

export const LIVE_INGEST_STALE_HOURS = {
  props: 12,
  odds: 24,
  injuries: 36,
  default: 24,
} as const;

export const STUCK_STARTED_MINUTES = 30;
export const UNEXPECTED_INGEST_WHILE_FROZEN_HOURS = 6;

/** Visibility-only recommendations. No external notifications are sent. */
export const HEALTH_WARNING_THRESHOLDS = {
  liveIngestStaleHours: LIVE_INGEST_STALE_HOURS,
  stuckStartedMinutes: STUCK_STARTED_MINUTES,
  unexpectedIngestWhileFrozenHours: UNEXPECTED_INGEST_WHILE_FROZEN_HOURS,
  coverageUnresolvedWarnAbove: 0,
  dbPlanPercentWarn: 80,
} as const;

export function rollupHealthStatus(statuses: HealthStatus[]): HealthStatus {
  if (statuses.length === 0) return 'UNKNOWN';
  return statuses.reduce((worst, status) =>
    HEALTH_STATUS_RANK[status] > HEALTH_STATUS_RANK[worst] ? status : worst
  );
}

export function classifyIngestionSource(input: {
  frozen: boolean;
  latestStatus: string | null;
  lastSuccessAt: Date | null;
  lastStartedAt: Date | null;
  now: Date;
  staleHours?: number;
  stuckMinutes?: number;
}): { status: HealthStatus; reason: string } {
  const staleHours = input.staleHours ?? LIVE_INGEST_STALE_HOURS.default;
  const stuckMinutes = input.stuckMinutes ?? STUCK_STARTED_MINUTES;
  const latest = (input.latestStatus ?? '').trim().toLowerCase();

  const startedAgeMs =
    input.lastStartedAt != null ? input.now.getTime() - input.lastStartedAt.getTime() : null;
  const stuckStarted =
    latest === 'started' &&
    startedAgeMs != null &&
    startedAgeMs > stuckMinutes * 60 * 1000;
  const recentStartWhileFrozen =
    latest === 'started' &&
    startedAgeMs != null &&
    startedAgeMs < UNEXPECTED_INGEST_WHILE_FROZEN_HOURS * 60 * 60 * 1000;

  if (stuckStarted && !input.frozen) {
    return {
      status: 'DEGRADED',
      reason: `pull run stuck in started for more than ${stuckMinutes}m`,
    };
  }

  if (input.frozen) {
    if (recentStartWhileFrozen) {
      return {
        status: 'DEGRADED',
        reason: 'ingestion started while freeze should prevent provider runs',
      };
    }
    const recentSuccess =
      input.lastSuccessAt != null &&
      input.now.getTime() - input.lastSuccessAt.getTime() <
        UNEXPECTED_INGEST_WHILE_FROZEN_HOURS * 60 * 60 * 1000;
    if (recentSuccess) {
      return {
        status: 'DEGRADED',
        reason: 'ingestion succeeded while freeze should prevent provider runs',
      };
    }
    if (latest === 'error') {
      return {
        status: 'FROZEN_EXPECTED',
        reason: 'frozen: last run errored; provider calls should be skipped',
      };
    }
    return {
      status: 'FROZEN_EXPECTED',
      reason: 'frozen: no live ingestion expected',
    };
  }

  if (!input.lastSuccessAt && latest === '') {
    return { status: 'UNKNOWN', reason: 'no pull-run history' };
  }
  if (latest === 'error') {
    return { status: 'FAILED', reason: 'latest pull run failed' };
  }
  if (!input.lastSuccessAt) {
    return { status: 'STALE', reason: 'no successful pull run' };
  }
  const ageHours = (input.now.getTime() - input.lastSuccessAt.getTime()) / (60 * 60 * 1000);
  if (ageHours > staleHours) {
    return {
      status: 'STALE',
      reason: `last success ${ageHours.toFixed(1)}h ago (threshold ${staleHours}h)`,
    };
  }
  return { status: 'HEALTHY', reason: 'recent successful pull' };
}

export function classifyArchiveManifest(input: {
  present: boolean;
  status: string | null;
  recordCount: number | null;
}): { status: HealthStatus; reason: string } {
  if (!input.present) {
    return { status: 'UNKNOWN', reason: 'manifest missing' };
  }
  const status = (input.status ?? '').toLowerCase();
  if (status !== 'success') {
    return { status: 'FAILED', reason: `manifest status=${input.status ?? 'unknown'}` };
  }
  if (input.recordCount == null || input.recordCount <= 0) {
    return { status: 'FAILED', reason: 'manifest recordCount is not positive' };
  }
  return { status: 'HEALTHY', reason: 'archive manifest success' };
}

export function classifyCoverage(unresolved: number | null): {
  status: HealthStatus;
  reason: string;
} {
  if (unresolved == null || !Number.isFinite(unresolved)) {
    return { status: 'UNKNOWN', reason: 'coverage metric unavailable' };
  }
  if (unresolved > 0) {
    return { status: 'DEGRADED', reason: `unresolved count ${unresolved}` };
  }
  return { status: 'HEALTHY', reason: '0 unresolved' };
}

export function classifyPruneOutcome(input: {
  dryRun: boolean;
  outcome: 'skipped' | 'aborted' | 'completed' | 'error' | null;
  pruneAllowed: boolean | null;
  maxDeleteAllowed: boolean | null;
  archiveOk: boolean | null;
  coverageOk: boolean | null;
}): { status: HealthStatus; reason: string } {
  if (input.outcome == null) {
    return { status: 'UNKNOWN', reason: 'prune audits are log-only; no queryable last event' };
  }
  if (input.outcome === 'error') {
    return { status: 'FAILED', reason: 'prune job error' };
  }
  if (input.archiveOk === false || input.coverageOk === false) {
    return { status: 'FAILED', reason: 'prune blocked by archive or coverage gate' };
  }
  if (input.outcome === 'aborted' && input.maxDeleteAllowed === false) {
    return {
      status: 'HEALTHY',
      reason: input.dryRun
        ? 'dry-run refused safely by max-delete'
        : 'execute refused safely by max-delete',
    };
  }
  if (input.outcome === 'skipped' && input.pruneAllowed === false) {
    return { status: 'FROZEN_EXPECTED', reason: 'prune skipped by freeze/env gate' };
  }
  if (input.outcome === 'completed') {
    return {
      status: 'HEALTHY',
      reason: input.dryRun ? 'dry-run completed without deletes' : 'prune completed',
    };
  }
  if (input.outcome === 'aborted') {
    return { status: 'DEGRADED', reason: 'prune aborted' };
  }
  return { status: 'UNKNOWN', reason: 'unrecognized prune outcome' };
}

export function classifyInjuryServing(input: {
  frozen: boolean;
  snapshotAt: Date | null;
  now: Date;
  freshnessHours: number;
}): { status: HealthStatus; authoritative: boolean; reason: string } {
  if (input.frozen) {
    return {
      status: 'FROZEN_EXPECTED',
      authoritative: false,
      reason: 'frozen/offseason: current injury rows are not authoritative',
    };
  }
  if (!input.snapshotAt) {
    return { status: 'UNKNOWN', authoritative: false, reason: 'no current injury snapshot' };
  }
  const ageHours = (input.now.getTime() - input.snapshotAt.getTime()) / (60 * 60 * 1000);
  if (ageHours > input.freshnessHours) {
    return {
      status: 'STALE',
      authoritative: false,
      reason: `injury snapshot ${ageHours.toFixed(1)}h old (threshold ${input.freshnessHours}h)`,
    };
  }
  return {
    status: 'HEALTHY',
    authoritative: true,
    reason: 'injury snapshot is within freshness window',
  };
}
