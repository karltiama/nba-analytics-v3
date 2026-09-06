/**
 * Odds prune runner for raw.odds_snapshots only.
 *
 * Execute gate order:
 *  1. PRUNE_ENABLED=1 + DATA_MODE=live_api + OFFSEASON_MODE=0 + CRON_DRY_RUN=0
 *  2. verified S3 archive (raw_odds_snapshots)
 *  3. compact coverage (history + current)
 *  4. retention eligibility (ET created_at date, default 30d)
 *  5. max-delete guard
 *  6. structured audit
 *
 * dryRun=true still evaluates archive/coverage/max-delete and never deletes.
 * Missing/malformed env on the execute path → no DELETE.
 */

import type { Pool } from 'pg';
import {
  createPruneRunId,
  logPruneAudit,
  type OddsPruneAuditEvent,
} from '@/lib/prune/audit';
import {
  verifyRawOddsArchiveGate,
  type ArchiveS3Reader,
} from '@/lib/prune/archive-gate';
import { evaluateDestructivePruneGate, type PruneEnvSnapshot } from '@/lib/prune/env-gate';
import { evaluateMaxDeleteGuard } from '@/lib/prune/max-delete-guard';
import { evaluateOddsCompactCoverage } from '@/lib/prune/odds-coverage-gate';
import {
  countRawOddsTotal,
  deleteRawOddsEligibleBatches,
  listSeasonsWithEligibleRawOdds,
  loadOddsCandidateStats,
  loadOddsCutoffEt,
  resolveOddsRawRetentionDays,
} from '@/lib/prune/odds-retention';
import { createArchiveS3FromEnv } from '@/lib/prune/run-prune-props';

export type OddsDeleteFn = (pool: Pool, retentionDays: number) => Promise<number>;

export type RunPruneOddsInput = {
  pool: Pool;
  env?: Record<string, string | undefined>;
  authenticated: boolean;
  s3?: ArchiveS3Reader | null;
  now?: Date;
  dryRun?: boolean;
  deleteEligible?: OddsDeleteFn;
};

export type RunPruneOddsResult = {
  httpStatus: number;
  body: Record<string, unknown>;
  audit: OddsPruneAuditEvent;
};

function emptyAudit(
  runId: string,
  timestamp: string,
  authenticated: boolean,
  snapshot: PruneEnvSnapshot,
  dryRun: boolean,
  retentionDays: number
): OddsPruneAuditEvent {
  return {
    event: 'prune_odds',
    runId,
    timestamp,
    authenticated,
    entity: 'raw_odds_snapshots',
    sourceTable: 'raw.odds_snapshots',
    pruneEnabled: snapshot.pruneEnabled,
    dataMode: snapshot.dataMode,
    offseasonMode: snapshot.offseasonMode,
    cronDryRun: snapshot.cronDryRun,
    pruneAllowed: false,
    dryRun,
    execute: !dryRun,
    retentionDays,
    cutoffEt: null,
    rowsBefore: null,
    rowsEligible: null,
    rowsRetained: null,
    eligibleGameIds: null,
    eligibleOldest: null,
    eligibleNewest: null,
    rowsDeleted: 0,
    rowsAfter: null,
    archiveVerification: { ok: null, reason: null, seasons: [] },
    coverage: {
      ok: null,
      reason: null,
      missingHistory: null,
      missingCurrent: null,
    },
    maxDelete: { allowed: null, reason: null, eligiblePercent: null },
    outcome: 'skipped',
    reason: '',
  };
}

export async function runPruneOddsJob(
  input: RunPruneOddsInput
): Promise<RunPruneOddsResult> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const dryRun = input.dryRun === true;
  const runId = createPruneRunId(now);
  const timestamp = now.toISOString();
  const retentionDays = resolveOddsRawRetentionDays(env.ODDS_RAW_RETENTION_DAYS);

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

  const deleteEligible = input.deleteEligible ?? deleteRawOddsEligibleBatches;

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
    const stats = await loadOddsCandidateStats(input.pool, retentionDays);
    const total = await countRawOddsTotal(input.pool);
    const cutoffEt = await loadOddsCutoffEt(input.pool, retentionDays);

    audit.cutoffEt = cutoffEt;
    audit.rowsBefore = total;
    audit.rowsEligible = stats.eligibleRows;
    audit.rowsRetained = total - stats.eligibleRows;
    audit.eligibleGameIds = stats.eligibleGameIds;
    audit.eligibleOldest = stats.oldest;
    audit.eligibleNewest = stats.newest;

    const seasons = await listSeasonsWithEligibleRawOdds(input.pool, retentionDays);
    const rawPrefix = (env.NBA_RAW_PREFIX?.trim() || 'raw').replace(/\/+$/, '');
    const s3 = input.s3 !== undefined ? input.s3 : createArchiveS3FromEnv(env);
    const archive = await verifyRawOddsArchiveGate({
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

    const coverage = await evaluateOddsCompactCoverage(input.pool, {
      olderThanDays: retentionDays,
    });
    audit.coverage = {
      ok: coverage.ok,
      reason: coverage.reason,
      missingHistory: coverage.missingHistory.length,
      missingCurrent: coverage.missingCurrent.length,
    };

    const maxDelete = evaluateMaxDeleteGuard({
      table: 'raw.odds_snapshots',
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
        'eligible raw odds rows have no resolvable analytics.games.season for archive verification'
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
        : `odds prune blocked: ${blockReasons.join('; ')}`;
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
          eligibleGameIds: stats.eligibleGameIds,
          eligibleOldest: stats.oldest,
          eligibleNewest: stats.newest,
          wouldDelete: 0,
          rowsDeleted: 0,
          archiveVerification: audit.archiveVerification,
          coverage: audit.coverage,
          maxDelete: audit.maxDelete,
          pruneAllowed: pruneGate.allowed,
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
          eligibleGameIds: stats.eligibleGameIds,
          eligibleOldest: stats.oldest,
          eligibleNewest: stats.newest,
          wouldDelete: stats.eligibleRows,
          rowsDeleted: 0,
          archiveVerification: audit.archiveVerification,
          coverage: audit.coverage,
          maxDelete: audit.maxDelete,
        },
        audit,
      };
    }

    const deleted = wouldDelete
      ? await deleteEligible(input.pool, retentionDays)
      : 0;
    const after = await countRawOddsTotal(input.pool);
    audit.rowsDeleted = deleted;
    audit.rowsAfter = after;
    audit.outcome = 'completed';
    audit.reason = 'odds prune completed';
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
        prunedRawOdds: deleted,
        rowsDeleted: deleted,
        rowsAfter: after,
        archiveVerification: audit.archiveVerification,
        coverage: audit.coverage,
        maxDelete: audit.maxDelete,
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
