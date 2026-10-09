/**
 * Pure injury ingest planner: history on meaningful change, leave-report
 * before current DELETE, no mass-clear on failed/partial/abnormal pulls.
 */

import {
  COLLECTION_GAP_EXIT_STATUS,
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
  kind: 'first' | 'change' | 'leave_report' | 'gap_exit';
};

export type InjuryIngestPlan = {
  historyInserts: PlannedHistoryInsert[];
  currentUpserts: InjuryPullRow[];
  currentDeletes: string[];
  massClearBlocked: boolean;
  completenessReason: string;
  /** True only when the pull is complete and follows a collection gap: this pull is the new baseline. */
  baseline: boolean;
  /** Removed ids whose history already ends with an exit row; deleted from current, no new history. */
  alreadyTerminatedIds: string[];
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
  /** player_ids that already have an exit row (RemovedFromReport or gap marker) for this pull_run_id */
  existingLeaveReportPlayerIds?: Iterable<string>;
  /** Every player id on this report, including quarantined identities; they are not removals. */
  reportPlayerIds?: Iterable<string>;
  minCompleteRowCount?: number;
  /** The previous complete pull is older than the continuity window (see isCollectionGap). */
  collectionGap?: boolean;
  /** player_ids whose latest history row is already an exit (RemovedFromReport or gap marker). */
  terminatedPlayerIds?: Iterable<string>;
}): InjuryIngestPlan {
  const completeness = evaluateInjuryPullCompleteness({
    status: args.pullStatus,
    completed: args.completed,
    rowsStored: args.rowsStored,
    rowsReturned: args.rowsReturned,
    previousRowsStored: args.previousCompleteRowCount,
    minRowCount: args.minCompleteRowCount,
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
      baseline: false,
      alreadyTerminatedIds: [],
    };
  }

  const baseline = args.collectionGap === true;
  const terminated = new Set(Array.from(args.terminatedPlayerIds ?? []).map(String));
  const onReport = new Set(seen);
  for (const id of args.reportPlayerIds ?? []) onReport.add(String(id));
  const removedIds = detectRemovedPlayerIds(args.previousCurrent.keys(), onReport);
  const currentDeletes: string[] = [];
  const alreadyTerminatedIds: string[] = [];

  for (const playerId of removedIds) {
    currentDeletes.push(playerId);
    if (existingLeave.has(playerId)) continue;
    const prev = args.previousCurrent.get(playerId);
    if (!prev) continue;
    if (isRemovedFromReportStatus(prev.status) || terminated.has(playerId)) {
      alreadyTerminatedIds.push(playerId);
      continue;
    }
    historyInserts.push(
      baseline
        ? {
            playerId,
            teamId: prev.teamId,
            status: COLLECTION_GAP_EXIT_STATUS,
            description: null,
            returnDateRaw: null,
            snapshotAt: args.observedAt,
            pullRunId: args.pullRunId,
            kind: 'gap_exit',
          }
        : {
            playerId,
            teamId: prev.teamId,
            status: REMOVED_FROM_REPORT_STATUS,
            description: prev.description,
            returnDateRaw: prev.returnDateRaw,
            snapshotAt: args.observedAt,
            pullRunId: args.pullRunId,
            kind: 'leave_report',
          }
    );
  }

  return {
    historyInserts,
    currentUpserts,
    currentDeletes,
    massClearBlocked: false,
    completenessReason: completeness.reason,
    baseline,
    alreadyTerminatedIds,
  };
}

export type InjuryMembershipRow = {
  pullRunId: number;
  playerId: string;
  inReport: boolean;
  observedAt: string;
};

/** Persist who was on the report without treating non-members as healthy. */
export function planInjuryPullMembership(args: {
  pullRunId: number;
  observedAt: string;
  inReportPlayerIds: Iterable<string>;
  notInReportPlayerIds?: Iterable<string>;
}): InjuryMembershipRow[] {
  const seen = new Set<string>();
  const rows: InjuryMembershipRow[] = [];
  for (const raw of args.inReportPlayerIds) {
    const playerId = String(raw);
    if (!playerId || seen.has(playerId)) continue;
    seen.add(playerId);
    rows.push({
      pullRunId: args.pullRunId,
      playerId,
      inReport: true,
      observedAt: args.observedAt,
    });
  }
  for (const raw of args.notInReportPlayerIds ?? []) {
    const playerId = String(raw);
    if (!playerId || seen.has(playerId)) continue;
    seen.add(playerId);
    rows.push({
      pullRunId: args.pullRunId,
      playerId,
      inReport: false,
      observedAt: args.observedAt,
    });
  }
  return rows;
}
