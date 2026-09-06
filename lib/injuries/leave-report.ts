/**
 * Leave-report (clearance) semantics for injury history.
 *
 * Source only proves: the player was present on successful complete report N
 * and absent from the next successful complete report N+1.
 * That is NOT provider-supplied Available. Historical status is RemovedFromReport.
 */

export const REMOVED_FROM_REPORT_STATUS = 'RemovedFromReport';

/** Absolute floor: empty/tiny payloads cannot mass-clear. Observed successful pulls are >= 110. */
export const MIN_COMPLETE_INJURY_ROW_COUNT = 50;

/** A pull smaller than this fraction of the previous complete pull is incomplete. */
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

/**
 * Successful, complete, consecutive pulls only.
 * Failed / incomplete / mismatched stored-vs-returned / abnormally small → not complete.
 */
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

/** True when N and N+1 are adjacent pull_run_ids with no intervening run of any status. */
export function areConsecutiveInjuryPullIds(
  prevPullRunId: number,
  nextPullRunId: number
): boolean {
  return (
    Number.isInteger(prevPullRunId) &&
    Number.isInteger(nextPullRunId) &&
    nextPullRunId === prevPullRunId + 1
  );
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

/**
 * Provider-supplied injury statuses that may be shown as current availability.
 * RemovedFromReport / Cleared / Available are not provider-current injuries.
 */
export function isActiveReportedInjuryStatus(status: string | null | undefined): boolean {
  const trimmed = (status ?? '').trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (lower === 'removedfromreport') return false;
  if (lower === 'cleared') return false;
  if (lower === 'available') return false;
  return true;
}
