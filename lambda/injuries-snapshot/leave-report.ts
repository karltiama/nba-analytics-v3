/**
 * Standalone copy of lib/injuries/leave-report.ts for the Lambda package
 * (no Next path aliases). Keep in sync with the lib module.
 */

export const REMOVED_FROM_REPORT_STATUS = 'RemovedFromReport';

/** Exit at an unknown time inside a collection gap. Not recovery, clearance, or Available. */
export const COLLECTION_GAP_EXIT_STATUS = 'AbsentAfterCollectionGap';

export const INJURY_CONTINUITY_MAX_GAP_HOURS_ENV = 'INJURY_CONTINUITY_MAX_GAP_HOURS';
export const DEFAULT_INJURY_CONTINUITY_MAX_GAP_HOURS = 48;
export const INJURY_CONTINUITY_MAX_GAP_HOURS_RANGE = { min: 24, max: 168 } as const;

export function resolveContinuityMaxGapHours(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_INJURY_CONTINUITY_MAX_GAP_HOURS;
  const trimmed = raw.trim();
  const n = Number(trimmed);
  const { min, max } = INJURY_CONTINUITY_MAX_GAP_HOURS_RANGE;
  if (!/^\d+$/.test(trimmed) || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`invalid ${INJURY_CONTINUITY_MAX_GAP_HOURS_ENV}=${trimmed}: expected an integer in [${min}, ${max}]`);
  }
  return n;
}

export function isCollectionGap(args: {
  previousCompletedAt: string | Date | null | undefined;
  observedAt: string | Date;
  maxGapHours: number;
}): boolean {
  if (args.previousCompletedAt == null) return false;
  const prev = new Date(args.previousCompletedAt).getTime();
  const now = new Date(args.observedAt).getTime();
  if (!Number.isFinite(prev) || !Number.isFinite(now)) {
    throw new Error('isCollectionGap: invalid timestamp');
  }
  return now - prev > args.maxGapHours * 3_600_000;
}

export function isCollectionGapExitStatus(status: string | null | undefined): boolean {
  return (status ?? '').trim() === COLLECTION_GAP_EXIT_STATUS;
}

export function isTerminalReportHistoryStatus(status: string | null | undefined): boolean {
  return isRemovedFromReportStatus(status) || isCollectionGapExitStatus(status);
}

export const MIN_COMPLETE_INJURY_ROW_COUNT = 50;

export const COMPLETE_PULL_FRACTION_OF_PREVIOUS = 0.5;

export const INJURY_MIN_COMPLETE_ROW_COUNT_ENV = 'INJURY_MIN_COMPLETE_ROW_COUNT';
export const INJURY_MIN_COMPLETE_ROW_COUNT_RANGE = { min: 10, max: 1000 } as const;

/** Unset means 50. Anything other than an integer in [10, 1000] throws: a bad floor must not run. */
export function resolveMinCompleteInjuryRowCount(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return MIN_COMPLETE_INJURY_ROW_COUNT;
  const trimmed = raw.trim();
  const n = Number(trimmed);
  const { min, max } = INJURY_MIN_COMPLETE_ROW_COUNT_RANGE;
  if (!/^\d+$/.test(trimmed) || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`invalid ${INJURY_MIN_COMPLETE_ROW_COUNT_ENV}=${trimmed}: expected an integer in [${min}, ${max}]`);
  }
  return n;
}

export type InjuryPullCompletenessInput = {
  status: string | null | undefined;
  completed: boolean;
  rowsStored: number | null | undefined;
  rowsReturned: number | null | undefined;
  previousRowsStored: number | null | undefined;
  /** Absolute floor override; defaults to MIN_COMPLETE_INJURY_ROW_COUNT. */
  minRowCount?: number;
};

export type InjuryPullCompleteness = {
  complete: boolean;
  reason: string;
};

export function isSuccessfulInjuryPullStatus(status: string | null | undefined): boolean {
  return (status ?? '').trim().toLowerCase() === 'success';
}

export function completeInjuryRowFloor(
  previousRowsStored: number | null | undefined,
  minRowCount: number = MIN_COMPLETE_INJURY_ROW_COUNT
): number {
  if (previousRowsStored == null || !Number.isFinite(previousRowsStored) || previousRowsStored < 1) {
    return minRowCount;
  }
  return Math.max(
    minRowCount,
    Math.ceil(previousRowsStored * COMPLETE_PULL_FRACTION_OF_PREVIOUS)
  );
}

export function evaluateInjuryPullCompleteness(
  input: InjuryPullCompletenessInput
): InjuryPullCompleteness {
  if (!isSuccessfulInjuryPullStatus(input.status)) {
    return { complete: false, reason: 'pull status is not success' };
  }
  if (!input.completed) {
    return { complete: false, reason: 'pull is not completed' };
  }
  const stored = Number(input.rowsStored);
  const returned = Number(input.rowsReturned);
  if (!Number.isFinite(stored) || !Number.isFinite(returned)) {
    return { complete: false, reason: 'pull row counts are missing' };
  }
  if (stored !== returned) {
    return { complete: false, reason: 'rows_stored does not equal rows_returned' };
  }
  if (stored <= 0) {
    return { complete: false, reason: 'empty_successful_provider_response' };
  }
  const floor = completeInjuryRowFloor(input.previousRowsStored, input.minRowCount);
  if (stored < floor) {
    return {
      complete: false,
      reason: `pull row count ${stored} is below completeness floor ${floor}`,
    };
  }
  return { complete: true, reason: 'successful complete pull' };
}

export function detectRemovedPlayerIds(
  previousPlayerIds: Iterable<string>,
  nextPlayerIds: Iterable<string>
): string[] {
  const next = new Set(Array.from(nextPlayerIds).map(String));
  const removed: string[] = [];
  for (const rawId of previousPlayerIds) {
    const id = String(rawId);
    if (!id) continue;
    if (!next.has(id)) removed.push(id);
  }
  return removed.sort();
}

export function isRemovedFromReportStatus(status: string | null | undefined): boolean {
  return (status ?? '').trim() === REMOVED_FROM_REPORT_STATUS;
}
