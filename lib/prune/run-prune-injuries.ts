/**
 * Injury prune runner for raw.player_injuries only.
 *
 * Execute gate order:
 *  1. PRUNE_ENABLED=1 + DATA_MODE=live_api + OFFSEASON_MODE=0 + CRON_DRY_RUN=0
 *  2. verified S3 archive (raw_player_injuries)
 *  3. meaningful-history coverage (first/change/leave-report)
 *  4. retention eligibility (ET created_at date, default 7d)
 *  5. max-delete guard
 *  6. optional DELETE from raw.player_injuries
 *  7. structured audit
 *
 * dryRun=true still evaluates archive/coverage/max-delete and never deletes.
 * Missing/malformed env on the execute path → no DELETE.
 * PRUNE_ALLOW_LARGE_DELETE=1 cannot bypass archive or coverage.
 */

import type { Pool } from 'pg';
import {
  createPruneRunId,
  logPruneAudit,
  type InjuriesPruneAuditEvent,
} from '@/lib/prune/audit';
import {
  verifyRawInjuriesArchiveGate,
  type ArchiveS3Reader,
} from '@/lib/prune/archive-gate';
import { evaluateDestructivePruneGate, type PruneEnvSnapshot } from '@/lib/prune/env-gate';
import { evaluateMaxDeleteGuard } from '@/lib/prune/max-delete-guard';
import { evaluateInjuryTransitionCoverage } from '@/lib/prune/injury-coverage-gate';
import {
  countRawInjuriesTotal,
  deleteRawInjuriesEligibleBatches,
  listSeasonsWithEligibleRawInjuries,
  loadInjuryCandidateStats,
  loadInjuryCutoffEt,
  resolveInjuryRawRetentionDays,
} from '@/lib/injuries/retention';
import { createArchiveS3FromEnv } from '@/lib/prune/run-prune-props';

export type InjuriesDeleteFn = (pool: Pool, retentionDays: number) => Promise<number>;

export type RunPruneInjuriesInput = {
  pool: Pool;
  env?: Record<string, string | undefined>;
  authenticated: boolean;
  s3?: ArchiveS3Reader | null;
  now?: Date;
  dryRun?: boolean;
  deleteEligible?: InjuriesDeleteFn;
};

export type RunPruneInjuriesResult = {
  httpStatus: number;
  body: Record<string, unknown>;
  audit: InjuriesPruneAuditEvent;
};

function emptyAudit(
  runId: string,
  timestamp: string,
  authenticated: boolean,
  snapshot: PruneEnvSnapshot,
  dryRun: boolean,
  retentionDays: number
): InjuriesPruneAuditEvent {
  return {
    event: 'prune_injuries',
    runId,
    timestamp,
    authenticated,
    entity: 'raw_player_injuries',
    sourceTable: 'raw.player_injuries',
    pruneEnabled: snapshot.pruneEnabled,
    dataMode: snapshot.dataMode,
    offseasonMode: snapshot.offseasonMode,
    cronDryRun: snapshot.cronDryRun,
    pruneAllowed: false,
    pruneAllowLargeDelete: snapshot.pruneAllowLargeDelete,
    dryRun,
    execute: !dryRun,
    retentionDays,
    cutoffEt: null,
    rowsBefore: null,
    rowsEligible: null,
    rowsRetained: null,
    eligiblePlayerIds: null,
    eligibleOldest: null,
    eligibleNewest: null,
    rowsDeleted: 0,
    rowsAfter: null,
    archiveVerification: { ok: null, reason: null, seasons: [] },
    coverage: {
      ok: null,
      reason: null,
      unresolvedLeaveReports: null,
      missingFirstSeen: null,
      missingChanges: null,
      duplicateLeaveReports: null,
    },
    maxDelete: { allowed: null, reason: null, eligiblePercent: null },
    outcome: 'skipped',
    reason: '',
  };
}

export async function runPruneInjuriesJob(
  input: RunPruneInjuriesInput
): Promise<RunPruneInjuriesResult> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const dryRun = input.dryRun === true;
  const runId = createPruneRunId(now);
  const timestamp = now.toISOString();
  const retentionDays = resolveInjuryRawRetentionDays(env.INJURY_RAW_RETENTION_DAYS);

  const pruneGate = evaluateDestructivePruneGate(env);
  const audit = emptyAudit(
    runId,
    timestamp,
    input.authenticated,
    pruneGate.snapshot,
    dryRun,
    retentionDays
  );
  audit.pruneAllowed = pruneGate.allowed;

  const deleteEligible = input.deleteEligible ?? deleteRawInjuriesEligibleBatches;

  if (!dryRun && !pruneGate.allowed) {
    audit.outcome = 'skipped';
    audit.reason = pruneGate.reason;
    logPruneAudit(audit);
    return {
      httpStatus: 200,
      body: {
        ok: true,
        skipped: true,
        dryRun: false,
        reason: audit.reason,
        runId,
        pruneEnabled: pruneGate.snapshot.pruneEnabled,
        dataMode: pruneGate.snapshot.dataMode,
        offseasonMode: pruneGate.snapshot.offseasonMode,
        cronDryRun: pruneGate.snapshot.cronDryRun,
        rowsDeleted: 0,
      },
      audit,
    };
  }

  try {
    const stats = await loadInjuryCandidateStats(input.pool, retentionDays);
    const total = await countRawInjuriesTotal(input.pool);
    const cutoffEt = await loadInjuryCutoffEt(input.pool, retentionDays);

    audit.cutoffEt = cutoffEt;
    audit.rowsBefore = total;
    audit.rowsEligible = stats.eligibleRows;
    audit.rowsRetained = total - stats.eligibleRows;
    audit.eligiblePlayerIds = stats.eligiblePlayerIds;
    audit.eligibleOldest = stats.oldest;
    audit.eligibleNewest = stats.newest;

    const seasons = await listSeasonsWithEligibleRawInjuries(input.pool, retentionDays);
    const rawPrefix = (env.NBA_RAW_PREFIX?.trim() || 'raw').replace(/\/+$/, '');
    const s3 = input.s3 !== undefined ? input.s3 : createArchiveS3FromEnv(env);
    const archive = await verifyRawInjuriesArchiveGate({
      s3,
      rawPrefix,
      seasons,
    });
    audit.archiveVerification = {
      ok: archive.ok,
      reason: archive.reason,
      seasons: archive.seasons.map((s) => ({
        season: s.season,
        ok: s.ok,
        reason: s.reason,
        recordCount: s.recordCount,
      })),
    };

    const coverage = await evaluateInjuryTransitionCoverage(input.pool);
    audit.coverage = {
      ok: coverage.ok,
      reason: coverage.reason,
      unresolvedLeaveReports: coverage.unresolvedLeaveReports,
      missingFirstSeen: coverage.missingFirstSeen,
      missingChanges: coverage.missingChanges,
      duplicateLeaveReports: coverage.duplicateLeaveReports,
    };

    const maxDelete = evaluateMaxDeleteGuard({
      table: 'raw.player_injuries',
      totalRows: total,
      eligibleRows: stats.eligibleRows,
      maxPercent: pruneGate.snapshot.pruneMaxDeletePercent,
      maxRows: pruneGate.snapshot.pruneMaxDeleteRows,
      allowLargeDelete: pruneGate.snapshot.pruneAllowLargeDelete,
    });
    audit.maxDelete = {
      allowed: maxDelete.allowed,
      reason: maxDelete.reason,
      eligiblePercent: maxDelete.eligiblePercent,
    };

    const blockReasons: string[] = [];
    if (stats.eligibleRows > 0 && seasons.length === 0) {
      blockReasons.push(
        'eligible raw injury rows have no resolvable analytics.games season for archive verification'
      );
    }
    if (stats.eligibleRows > 0 && !archive.ok) {
      blockReasons.push(`archive gate failed: ${archive.reason}`);
    }
    if (stats.eligibleRows > 0 && !coverage.ok) {
      blockReasons.push(`coverage gate failed: ${coverage.reason}`);
    }
    if (!maxDelete.allowed) {
      blockReasons.push(maxDelete.reason);
    }

    const wouldDelete = stats.eligibleRows > 0 && blockReasons.length === 0;

    if (blockReasons.length > 0) {
      audit.outcome = 'aborted';
      audit.reason = dryRun
        ? `dry-run: would not delete (${blockReasons.join('; ')})`
        : `injury prune blocked: ${blockReasons.join('; ')}`;
      audit.rowsDeleted = 0;
      audit.rowsAfter = total;
      logPruneAudit(audit);
      return {
        httpStatus: 200,
        body: {
          ok: false,
          aborted: true,
          dryRun,
          reason: audit.reason,
          runId,
          retentionDays,
          cutoffEt,
          rowsBefore: total,
          rowsEligible: stats.eligibleRows,
          rowsRetained: total - stats.eligibleRows,
          eligiblePlayerIds: stats.eligiblePlayerIds,
          eligibleOldest: stats.oldest,
          eligibleNewest: stats.newest,
          wouldDelete: 0,
          rowsDeleted: 0,
          archiveVerification: audit.archiveVerification,
          coverage: audit.coverage,
          maxDelete: audit.maxDelete,
          pruneAllowed: pruneGate.allowed,
          pruneAllowLargeDelete: pruneGate.snapshot.pruneAllowLargeDelete,
        },
        audit,
      };
    }

    if (dryRun) {
      audit.outcome = 'completed';
      audit.reason = wouldDelete
        ? 'dry-run: all gates passed; no rows deleted'
        : 'dry-run: no eligible rows';
      audit.rowsDeleted = 0;
      audit.rowsAfter = total;
      logPruneAudit(audit);
      return {
        httpStatus: 200,
        body: {
          ok: true,
          dryRun: true,
          reason: audit.reason,
          runId,
          retentionDays,
          cutoffEt,
          rowsBefore: total,
          rowsEligible: stats.eligibleRows,
          rowsRetained: total - stats.eligibleRows,
          eligiblePlayerIds: stats.eligiblePlayerIds,
          eligibleOldest: stats.oldest,
          eligibleNewest: stats.newest,
          wouldDelete: stats.eligibleRows,
          rowsDeleted: 0,
          archiveVerification: audit.archiveVerification,
          coverage: audit.coverage,
          maxDelete: audit.maxDelete,
          pruneAllowLargeDelete: pruneGate.snapshot.pruneAllowLargeDelete,
        },
        audit,
      };
    }

    const deleted = wouldDelete
      ? await deleteEligible(input.pool, retentionDays)
      : 0;
    const after = await countRawInjuriesTotal(input.pool);
    audit.rowsDeleted = deleted;
    audit.rowsAfter = after;
    audit.outcome = 'completed';
    audit.reason = 'injury prune completed';
    logPruneAudit(audit);
    return {
      httpStatus: 200,
      body: {
        ok: true,
        dryRun: false,
        reason: audit.reason,
        runId,
        retentionDays,
        cutoffEt,
        rowsBefore: total,
        rowsEligible: stats.eligibleRows,
        rowsRetained: total - stats.eligibleRows,
        prunedRawInjuries: deleted,
        rowsDeleted: deleted,
        rowsAfter: after,
        archiveVerification: audit.archiveVerification,
        coverage: audit.coverage,
        maxDelete: audit.maxDelete,
        pruneAllowLargeDelete: pruneGate.snapshot.pruneAllowLargeDelete,
      },
      audit,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    audit.outcome = 'error';
    audit.reason = message;
    audit.rowsDeleted = 0;
    logPruneAudit(audit);
    return {
      httpStatus: 500,
      body: { ok: false, error: message, runId, rowsDeleted: 0 },
      audit,
    };
  }
}
