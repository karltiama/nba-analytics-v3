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

export function createPruneRunId(now: Date = new Date()): string {
  return `prune_${now.toISOString().replace(/[:.]/g, '-')}_${Math.random().toString(36).slice(2, 8)}`;
}

export function logPruneAudit(event: PruneAuditEvent): void {
  // Single-line JSON for log drains; never include secrets.
  console.log(JSON.stringify(event));
}
