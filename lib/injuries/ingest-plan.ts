/**
 * Pure injury ingest planner: history on meaningful change, leave-report
 * before current DELETE, no mass-clear on failed/partial/abnormal pulls.
 */

import {
  REMOVED_FROM_REPORT_STATUS,
  detectRemovedPlayerIds,
  evaluateInjuryPullCompleteness,
  isRemovedFromReportStatus,
} from './leave-report';

export type InjuryFieldSnapshot = {
  playerId: string;
  teamId: string | null;
  status: string | null;
  description: string | null;
  returnDateRaw: string | null;
};

export type InjuryPullRow = InjuryFieldSnapshot & {
  snapshotAt: string;
};

export type PlannedHistoryInsert = InjuryFieldSnapshot & {
  snapshotAt: string;
  pullRunId: number;
  kind: 'first' | 'change' | 'leave_report';
};

export type InjuryIngestPlan = {
  historyInserts: PlannedHistoryInsert[];
  currentUpserts: InjuryPullRow[];
  currentDeletes: string[];
  massClearBlocked: boolean;
  completenessReason: string;
};

export function injuryTupleChanged(
  prev: Omit<InjuryFieldSnapshot, 'playerId'> | null | undefined,
  next: Omit<InjuryFieldSnapshot, 'playerId'>
): boolean {
  if (!prev) return true;
  return (
    prev.status !== next.status ||
    prev.description !== next.description ||
    prev.returnDateRaw !== next.returnDateRaw ||
    prev.teamId !== next.teamId
  );
}

export function planInjuryIngest(args: {
  pullRunId: number;
  pullStatus: string;
  completed: boolean;
  rowsStored: number;
  rowsReturned: number;
  previousCompleteRowCount: number | null;
  /** Observation time of this pull (pulled_at / first raw created_at). Used for leave-report rows. */
  observedAt: string;
  pullRows: InjuryPullRow[];
  previousCurrent: Map<string, InjuryFieldSnapshot>;
  /** player_ids that already have RemovedFromReport history for this pull_run_id */
  existingLeaveReportPlayerIds?: Iterable<string>;
}): InjuryIngestPlan {
  const completeness = evaluateInjuryPullCompleteness({
    status: args.pullStatus,
    completed: args.completed,
    rowsStored: args.rowsStored,
    rowsReturned: args.rowsReturned,
    previousRowsStored: args.previousCompleteRowCount,
  });

  const historyInserts: PlannedHistoryInsert[] = [];
  const currentUpserts: InjuryPullRow[] = [];
  const seen = new Set<string>();

  for (const row of args.pullRows) {
    const playerId = String(row.playerId);
    if (!playerId || seen.has(playerId)) continue;
    seen.add(playerId);

    const nextFields: InjuryFieldSnapshot = {
      playerId,
      teamId: row.teamId,
      status: row.status,
      description: row.description,
      returnDateRaw: row.returnDateRaw,
    };
    const prev = args.previousCurrent.get(playerId) ?? null;
    if (injuryTupleChanged(prev, nextFields)) {
      historyInserts.push({
        ...nextFields,
        snapshotAt: row.snapshotAt,
        pullRunId: args.pullRunId,
        kind: prev ? 'change' : 'first',
      });
    }
    currentUpserts.push({ ...row, playerId });
  }

  const existingLeave = new Set(
    Array.from(args.existingLeaveReportPlayerIds ?? []).map(String)
  );

  if (!completeness.complete) {
    return {
      historyInserts,
      currentUpserts,
      currentDeletes: [],
      massClearBlocked: true,
      completenessReason: completeness.reason,
    };
  }

  const removedIds = detectRemovedPlayerIds(args.previousCurrent.keys(), seen);
  const currentDeletes: string[] = [];

  for (const playerId of removedIds) {
    currentDeletes.push(playerId);
    if (existingLeave.has(playerId)) continue;
    const prev = args.previousCurrent.get(playerId);
    if (!prev) continue;
    if (isRemovedFromReportStatus(prev.status)) continue;
    historyInserts.push({
      playerId,
      teamId: prev.teamId,
      status: REMOVED_FROM_REPORT_STATUS,
      description: prev.description,
      returnDateRaw: prev.returnDateRaw,
      snapshotAt: args.observedAt,
      pullRunId: args.pullRunId,
      kind: 'leave_report',
    });
  }

  return {
    historyInserts,
    currentUpserts,
    currentDeletes,
    massClearBlocked: false,
    completenessReason: completeness.reason,
  };
}
