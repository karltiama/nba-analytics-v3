/**
 * Standalone copy of lib/injuries/leave-report.ts for the Lambda package
 * (no Next path aliases). Keep in sync with the lib module.
 */

export const REMOVED_FROM_REPORT_STATUS = 'RemovedFromReport';

export const MIN_COMPLETE_INJURY_ROW_COUNT = 50;

export const COMPLETE_PULL_FRACTION_OF_PREVIOUS = 0.5;

export type InjuryPullCompletenessInput = {
  status: string | null | undefined;
  completed: boolean;
  rowsStored: number | null | undefined;
  rowsReturned: number | null | undefined;
  previousRowsStored: number | null | undefined;
};

export type InjuryPullCompleteness = {
  complete: boolean;
  reason: string;
};

export function isSuccessfulInjuryPullStatus(status: string | null | undefined): boolean {
  return (status ?? '').trim().toLowerCase() === 'success';
}

export function completeInjuryRowFloor(previousRowsStored: number | null | undefined): number {
  if (previousRowsStored == null || !Number.isFinite(previousRowsStored) || previousRowsStored < 1) {
    return MIN_COMPLETE_INJURY_ROW_COUNT;
  }
  return Math.max(
    MIN_COMPLETE_INJURY_ROW_COUNT,
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
    return { complete: false, reason: 'pull stored zero rows' };
  }
  const floor = completeInjuryRowFloor(input.previousRowsStored);
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
