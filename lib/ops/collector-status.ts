/**
 * Operator-facing ingestion status.
 * AWS collector state, web-process permissions, and database freshness
 * are separate. An unset web flag is not evidence that a Lambda is frozen.
 */

import { rollupHealthStatus, type HealthStatus } from './health-status';

export type CollectorStatus = 'HEALTHY' | 'DEGRADED' | 'FROZEN' | 'UNKNOWN' | 'BLOCKED';

export type AwsAccess = 'QUERIED' | 'UNAVAILABLE' | 'NOT_QUERIED';

export type ScheduleEvidence = 'ENABLED' | 'DISABLED' | 'UNKNOWN' | 'NOT_DEPLOYED';

export type ExecutionEvidence = 'RECENT' | 'MISSED' | 'NONE' | 'ERRORS' | 'UNKNOWN';

export type WriteEvidence = 'RECENT' | 'STALE' | 'MISSING' | 'NOT_EXPECTED';

export type ObservedFreshness = 'FRESH' | 'STALE' | 'UNAVAILABLE';

export type ScheduleLabel = 'ENABLED' | 'DISABLED' | 'NOT_DEPLOYED' | 'UNKNOWN' | 'BLOCKED';

export type WebIngestionState = 'ALLOWED' | 'RESTRICTED';

export function classifyWebIngestion(input: {
  liveIngestionEnabled: boolean;
  freezeSkipsMutations: boolean;
}): { state: WebIngestionState; reason: string } {
  if (input.freezeSkipsMutations) {
    return {
      state: 'RESTRICTED',
      reason:
        'This web process skips ingestion mutations because DATA_MODE, OFFSEASON_MODE, or CRON_DRY_RUN is not live.',
    };
  }
  if (!input.liveIngestionEnabled) {
    return {
      state: 'RESTRICTED',
      reason:
        'LIVE_INGESTION_ENABLED is unset or not 1/true on this web process. That does not disable an independently deployed AWS collector.',
    };
  }
  return {
    state: 'ALLOWED',
    reason: 'This web process is allowed to run live ingestion mutations.',
  };
}

/** Freshness of a stored timestamp. Never calls a stale write fresh, and never consults freeze flags. */
export function classifyObservedFreshness(input: {
  lastWriteAt: Date | null;
  now: Date;
  slaHours: number;
}): { state: ObservedFreshness; ageHours: number | null; reason: string } {
  if (input.lastWriteAt == null || Number.isNaN(input.lastWriteAt.getTime())) {
    return { state: 'UNAVAILABLE', ageHours: null, reason: 'no confirmed database write' };
  }
  const ageHours = (input.now.getTime() - input.lastWriteAt.getTime()) / (60 * 60 * 1000);
  if (ageHours < 0) {
    return { state: 'UNAVAILABLE', ageHours, reason: 'database write timestamp is in the future' };
  }
  if (ageHours > input.slaHours) {
    return {
      state: 'STALE',
      ageHours,
      reason: `last write ${ageHours.toFixed(1)}h ago (SLA ${input.slaHours}h)`,
    };
  }
  return { state: 'FRESH', ageHours, reason: 'database write is within SLA' };
}

/**
 * Collector status from AWS and database evidence only.
 * `idleNoEligibleWork` means a run correctly had nothing to collect.
 */
export function classifyCollectorOperations(input: {
  awsAccess: AwsAccess;
  schedule: ScheduleEvidence;
  execution: ExecutionEvidence;
  writes: WriteEvidence;
  idleNoEligibleWork?: boolean;
  /** Errors observed in the metrics window. A recovered run does not hide the count. */
  recentErrorCount?: number | null;
}): { status: CollectorStatus; reason: string; warning: string | null } {
  if (input.schedule === 'UNKNOWN' && input.awsAccess === 'UNAVAILABLE') {
    return applyRecentErrors(
      { status: 'BLOCKED', reason: 'AWS operational evidence could not be read' },
      input.recentErrorCount
    );
  }
  if (input.schedule === 'UNKNOWN') {
    return applyRecentErrors(
      { status: 'UNKNOWN', reason: 'AWS schedule state was not established' },
      input.recentErrorCount
    );
  }

  const noExecution = input.execution === 'NONE' || input.execution === 'UNKNOWN';
  if ((input.schedule === 'DISABLED' || input.schedule === 'NOT_DEPLOYED') && noExecution) {
    return applyRecentErrors(
      {
        status: 'FROZEN',
        reason:
          input.schedule === 'NOT_DEPLOYED'
            ? 'collector is not deployed'
            : 'AWS schedule is disabled and no recent execution was observed',
      },
      input.recentErrorCount
    );
  }
  if (input.schedule === 'DISABLED' || input.schedule === 'NOT_DEPLOYED') {
    return applyRecentErrors(
      {
        status: 'DEGRADED',
        reason: 'AWS schedule is disabled but execution evidence still shows activity or errors',
      },
      input.recentErrorCount
    );
  }

  if (input.execution === 'MISSED') {
    return applyRecentErrors(
      { status: 'DEGRADED', reason: 'enabled collector missed its expected execution window' },
      input.recentErrorCount
    );
  }
  if (input.execution === 'UNKNOWN') {
    return applyRecentErrors(
      { status: 'UNKNOWN', reason: 'schedule is enabled but execution evidence was not read' },
      input.recentErrorCount
    );
  }

  const writes =
    input.idleNoEligibleWork && input.writes !== 'RECENT' ? 'NOT_EXPECTED' : input.writes;

  let base: { status: CollectorStatus; reason: string };
  if (writes === 'NOT_EXPECTED' && input.execution === 'RECENT') {
    base = {
      status: 'HEALTHY',
      reason:
        'collector is enabled and has no eligible work, so no database write was expected. The stored record can still be stale.',
    };
  } else if (writes === 'NOT_EXPECTED') {
    base = {
      status: 'UNKNOWN',
      reason: 'no database write was expected, and no recent execution was observed',
    };
  } else if (input.execution === 'RECENT' && writes === 'RECENT') {
    base = {
      status: 'HEALTHY',
      reason: 'schedule enabled, recent execution, and a recent database write',
    };
  } else if (input.execution === 'RECENT' && (writes === 'MISSING' || writes === 'STALE')) {
    base = {
      status: 'DEGRADED',
      reason: 'collector ran but the expected database write is missing or stale',
    };
  } else if (input.execution === 'NONE') {
    base = {
      status: 'DEGRADED',
      reason: 'enabled collector has no recent execution',
    };
  } else {
    base = { status: 'UNKNOWN', reason: 'collector state is not determined' };
  }
  return applyRecentErrors(base, input.recentErrorCount);
}

function applyRecentErrors(
  base: { status: CollectorStatus; reason: string },
  recentErrorCount: number | null | undefined
): { status: CollectorStatus; reason: string; warning: string | null } {
  const errors = recentErrorCount ?? 0;
  if (!Number.isFinite(errors) || errors <= 0) {
    return { ...base, warning: base.status === 'HEALTHY' ? null : base.reason };
  }
  const note = `${errors} execution error(s) in the snapshot window`;
  if (base.status === 'HEALTHY') {
    return {
      status: 'HEALTHY',
      reason: base.reason,
      warning: `${note}; a later execution and a fresh write were observed`,
    };
  }
  if (base.status === 'UNKNOWN' || base.status === 'BLOCKED') {
    return { ...base, warning: `${note}. ${base.reason}` };
  }
  return {
    status: 'DEGRADED',
    reason: `${note}. ${base.reason}`,
    warning: `${note}. ${base.reason}`,
  };
}

/** DISABLED is returned only when a schedule was actually observed disabled. */
export function formatScheduleEvidence(input: {
  schedule: ScheduleEvidence;
  awsAccess: AwsAccess;
}): ScheduleLabel {
  if (input.schedule === 'ENABLED') return 'ENABLED';
  if (input.schedule === 'DISABLED') return 'DISABLED';
  if (input.schedule === 'NOT_DEPLOYED') return 'NOT_DEPLOYED';
  if (input.awsAccess === 'UNAVAILABLE') return 'BLOCKED';
  return 'UNKNOWN';
}

export function collectorToHealth(status: CollectorStatus): HealthStatus {
  if (status === 'FROZEN') return 'FROZEN_EXPECTED';
  return status;
}

export function deriveExecutionEvidence(input: {
  queried: boolean;
  lastInvocationAt: Date | null;
  errors24h: number | null;
  now: Date;
  intervalHours: number | null;
  graceHours: number;
  slaHours: number;
}): ExecutionEvidence {
  if (!input.queried) return 'UNKNOWN';
  // Error counts are applied after recovery is known. They do not replace execution evidence.
  void input.errors24h;
  if (input.lastInvocationAt == null || Number.isNaN(input.lastInvocationAt.getTime())) return 'NONE';
  const ageMs = input.now.getTime() - input.lastInvocationAt.getTime();
  if (ageMs < 0) return 'UNKNOWN';
  const cadenceMs =
    input.intervalHours != null
      ? (input.intervalHours + input.graceHours) * 60 * 60 * 1000
      : null;
  const slaMs = input.slaHours * 60 * 60 * 1000;
  if (ageMs <= slaMs) return 'RECENT';
  if (cadenceMs != null) return 'MISSED';
  return 'UNKNOWN';
}

export function scheduleEvidenceForFamily(input: {
  lambdaDeployState?: 'DEPLOYED' | 'NOT_DEPLOYED' | 'UNKNOWN' | null;
  lambdaSchedule?: 'ENABLED' | 'DISABLED' | 'UNKNOWN' | null;
  lambdaListed: boolean;
  anyLambdaListed: boolean;
  globalSchedule?: 'ENABLED' | 'DISABLED' | 'UNKNOWN' | null;
  defaultConfig: string;
}): ScheduleEvidence {
  if (input.lambdaDeployState === 'NOT_DEPLOYED') return 'NOT_DEPLOYED';
  if (input.lambdaSchedule === 'ENABLED' || input.lambdaSchedule === 'DISABLED') {
    return input.lambdaSchedule;
  }
  if (
    !input.lambdaListed &&
    (input.defaultConfig === 'NOT_DEPLOYED' || input.defaultConfig === 'MANUAL_ONLY')
  ) {
    return 'NOT_DEPLOYED';
  }
  if (
    !input.lambdaListed &&
    !input.anyLambdaListed &&
    (input.globalSchedule === 'ENABLED' || input.globalSchedule === 'DISABLED')
  ) {
    return input.globalSchedule;
  }
  return 'UNKNOWN';
}

export function isIdlePullStatus(status: string | null | undefined): boolean {
  return /^(skipped|runtime_skip|no_eligible|idle)$/i.test((status ?? '').trim());
}

/**
 * Player-props controller invocations are scheduled 08:00–23:59 America/New_York.
 * Near-tip and closing crons in infra/lambda.tf use that window. rate(30 minutes)
 * applies only when no broad cron list is configured. Outside the window, no pull is scheduled.
 */
export function isPropsControllerScheduled(now: Date): boolean {
  const hourText = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  const hour = Number(hourText);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return true;
  return hour >= 8 && hour <= 23;
}

export function rollupEnabledCollectors(
  families: Array<{ scheduleLabel: ScheduleLabel; status: HealthStatus }>
): HealthStatus {
  const enabled = families.filter((row) => row.scheduleLabel === 'ENABLED');
  if (enabled.length === 0) return 'UNKNOWN';
  return rollupHealthStatus(enabled.map((row) => row.status));
}
