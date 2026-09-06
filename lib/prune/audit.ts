export type PruneAuditEvent = {
  event: 'prune_props';
  runId: string;
  timestamp: string;
  authenticated: boolean;
  pruneEnabled: string;
  dataMode: string | null;
  offseasonMode: string;
  cronDryRun: string;
  materializeAllowed: boolean;
  pruneAllowed: boolean;
  rowsBefore: {
    rawV2: number | null;
    analyticsCurrent: number | null;
  };
  rowsEligible: {
    rawV2: number | null;
    analyticsCurrent: number | null;
  };
  rowsDeleted: {
    rawV2: number;
    analyticsCurrent: number;
  };
  rowsAfter: {
    rawV2: number | null;
    analyticsCurrent: number | null;
  };
  materialized: number;
  pendingClosingLines: number | null;
  archiveVerification: {
    ok: boolean | null;
    reason: string | null;
    seasons: Array<{ season: number; ok: boolean; reason: string; recordCount: number | null }>;
  };
  maxDelete: {
    raw: { allowed: boolean | null; reason: string | null; eligiblePercent: number | null };
    current: { allowed: boolean | null; reason: string | null; eligiblePercent: number | null };
  };
  outcome: 'skipped' | 'aborted' | 'completed' | 'error';
  reason: string;
};

export type OddsPruneAuditEvent = {
  event: 'prune_odds';
  runId: string;
  timestamp: string;
  authenticated: boolean;
  entity: 'raw_odds_snapshots';
  sourceTable: 'raw.odds_snapshots';
  pruneEnabled: string;
  dataMode: string | null;
  offseasonMode: string;
  cronDryRun: string;
  pruneAllowed: boolean;
  dryRun: boolean;
  execute: boolean;
  retentionDays: number;
  cutoffEt: string | null;
  rowsBefore: number | null;
  rowsEligible: number | null;
  rowsRetained: number | null;
  eligibleGameIds: number | null;
  eligibleOldest: string | null;
  eligibleNewest: string | null;
  rowsDeleted: number;
  rowsAfter: number | null;
  archiveVerification: {
    ok: boolean | null;
    reason: string | null;
    seasons: Array<{ season: number; ok: boolean; reason: string; recordCount: number | null }>;
  };
  coverage: {
    ok: boolean | null;
    reason: string | null;
    missingHistory: number | null;
    missingCurrent: number | null;
  };
  maxDelete: {
    allowed: boolean | null;
    reason: string | null;
    eligiblePercent: number | null;
  };
  outcome: 'skipped' | 'aborted' | 'completed' | 'error';
  reason: string;
};

export type InjuriesPruneAuditEvent = {
  event: 'prune_injuries';
  runId: string;
  timestamp: string;
  authenticated: boolean;
  entity: 'raw_player_injuries';
  sourceTable: 'raw.player_injuries';
  pruneEnabled: string;
  dataMode: string | null;
  offseasonMode: string;
  cronDryRun: string;
  pruneAllowed: boolean;
  pruneAllowLargeDelete: boolean;
  dryRun: boolean;
  execute: boolean;
  retentionDays: number;
  cutoffEt: string | null;
  rowsBefore: number | null;
  rowsEligible: number | null;
  rowsRetained: number | null;
  eligiblePlayerIds: number | null;
  eligibleOldest: string | null;
  eligibleNewest: string | null;
  rowsDeleted: number;
  rowsAfter: number | null;
  archiveVerification: {
    ok: boolean | null;
    reason: string | null;
    seasons: Array<{ season: number; ok: boolean; reason: string; recordCount: number | null }>;
  };
  coverage: {
    ok: boolean | null;
    reason: string | null;
    unresolvedLeaveReports: number | null;
    missingFirstSeen: number | null;
    missingChanges: number | null;
    duplicateLeaveReports: number | null;
  };
  maxDelete: {
    allowed: boolean | null;
    reason: string | null;
    eligiblePercent: number | null;
  };
  outcome: 'skipped' | 'aborted' | 'completed' | 'error';
  reason: string;
};

export type AnyPruneAuditEvent =
  | PruneAuditEvent
  | OddsPruneAuditEvent
  | InjuriesPruneAuditEvent;

export function createPruneRunId(now: Date = new Date()): string {
  return `prune_${now.toISOString().replace(/[:.]/g, '-')}_${Math.random().toString(36).slice(2, 8)}`;
}

export function logPruneAudit(event: AnyPruneAuditEvent): void {
  // Single-line JSON for log drains; never include secrets.
  console.log(JSON.stringify(event));
}
