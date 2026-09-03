import { S3Client } from '@aws-sdk/client-s3';
import type { Pool } from 'pg';
import { S3Storage } from '@/lib/aws/s3';
import {
  createPruneRunId,
  logPruneAudit,
  type PruneAuditEvent,
} from '@/lib/prune/audit';
import {
  verifyRawPropsArchiveGate,
  type ArchiveS3Reader,
} from '@/lib/prune/archive-gate';
import {
  RETENTION_DAYS,
  countCurrentEligible,
  countCurrentTotal,
  countPendingClosingLinesForPruneEligible,
  countRawEligible,
  countRawTotal,
  deleteCurrentEligibleBatches,
  deleteRawEligibleBatches,
  listSeasonsWithEligibleRaw,
  materializeClosingLines,
} from '@/lib/prune/closing-lines';
import {
  evaluateDestructivePruneGate,
  evaluateMaterializeGate,
  type PruneEnvSnapshot,
} from '@/lib/prune/env-gate';
import { evaluateMaxDeleteGuard } from '@/lib/prune/max-delete-guard';

export type RunPrunePropsInput = {
  pool: Pool;
  env?: Record<string, string | undefined>;
  authenticated: boolean;
  s3?: ArchiveS3Reader | null;
  now?: Date;
};

export type RunPrunePropsResult = {
  httpStatus: number;
  body: Record<string, unknown>;
  audit: PruneAuditEvent;
};

function emptyAudit(
  runId: string,
  timestamp: string,
  authenticated: boolean,
  snapshot: PruneEnvSnapshot
): PruneAuditEvent {
  return {
    event: 'prune_props',
    runId,
    timestamp,
    authenticated,
    pruneEnabled: snapshot.pruneEnabled,
    dataMode: snapshot.dataMode,
    offseasonMode: snapshot.offseasonMode,
    cronDryRun: snapshot.cronDryRun,
    materializeAllowed: false,
    pruneAllowed: false,
    rowsBefore: { rawV2: null, analyticsCurrent: null },
    rowsEligible: { rawV2: null, analyticsCurrent: null },
    rowsDeleted: { rawV2: 0, analyticsCurrent: 0 },
    rowsAfter: { rawV2: null, analyticsCurrent: null },
    materialized: 0,
    pendingClosingLines: null,
    archiveVerification: { ok: null, reason: null, seasons: [] },
    maxDelete: {
      raw: { allowed: null, reason: null, eligiblePercent: null },
      current: { allowed: null, reason: null, eligiblePercent: null },
    },
    outcome: 'skipped',
    reason: '',
  };
}

export function createArchiveS3FromEnv(
  env: Record<string, string | undefined> = process.env
): ArchiveS3Reader | null {
  const bucket = env.NBA_DATA_BUCKET?.trim();
  if (!bucket) return null;
  const region = env.AWS_REGION?.trim() || 'us-east-1';
  return new S3Storage({
    bucket,
    client: new S3Client({ region }),
  });
}

export async function runPrunePropsJob(
  input: RunPrunePropsInput
): Promise<RunPrunePropsResult> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const runId = createPruneRunId(now);
  const timestamp = now.toISOString();

  const materializeGate = evaluateMaterializeGate(env);
  const pruneGate = evaluateDestructivePruneGate(env);
  const audit = emptyAudit(runId, timestamp, input.authenticated, pruneGate.snapshot);
  audit.materializeAllowed = materializeGate.allowed;
  audit.pruneAllowed = pruneGate.allowed;

  if (!pruneGate.allowed) {
    // Still allow materialize-only when live flags are explicit but PRUNE_ENABLED is off.
    if (materializeGate.allowed && pruneGate.snapshot.pruneEnabled !== '1') {
      try {
        const materialized = await materializeClosingLines(input.pool);
        audit.materialized = materialized;
        audit.outcome = 'skipped';
        audit.reason = `${pruneGate.reason}; materialize-only completed`;
        logPruneAudit(audit);
        return {
          httpStatus: 200,
          body: {
            ok: true,
            skipped: true,
            pruneSkipped: true,
            materialized,
            reason: audit.reason,
            runId,
            retentionDays: RETENTION_DAYS,
            dataMode: pruneGate.snapshot.dataMode,
            offseasonMode: pruneGate.snapshot.offseasonMode,
            cronDryRun: pruneGate.snapshot.cronDryRun,
            pruneEnabled: pruneGate.snapshot.pruneEnabled,
          },
          audit,
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        audit.outcome = 'error';
        audit.reason = message;
        logPruneAudit(audit);
        return {
          httpStatus: 500,
          body: { ok: false, error: message, runId },
          audit,
        };
      }
    }

    audit.outcome = 'skipped';
    audit.reason = pruneGate.reason;
    logPruneAudit(audit);
    return {
      httpStatus: 200,
      body: {
        ok: true,
        skipped: true,
        reason: pruneGate.reason,
        runId,
        dataMode: pruneGate.snapshot.dataMode,
        offseasonMode: pruneGate.snapshot.offseasonMode,
        cronDryRun: pruneGate.snapshot.cronDryRun,
        pruneEnabled: pruneGate.snapshot.pruneEnabled,
      },
      audit,
    };
  }

  try {
    const rawBefore = await countRawTotal(input.pool);
    const currentBefore = await countCurrentTotal(input.pool);
    audit.rowsBefore = { rawV2: rawBefore, analyticsCurrent: currentBefore };

    const materialized = await materializeClosingLines(input.pool);
    audit.materialized = materialized;

    const pendingClosingLines = await countPendingClosingLinesForPruneEligible(
      input.pool,
      RETENTION_DAYS
    );
    audit.pendingClosingLines = pendingClosingLines;

    const rawEligible = await countRawEligible(input.pool, RETENTION_DAYS);
    const currentEligible = await countCurrentEligible(input.pool, RETENTION_DAYS);
    audit.rowsEligible = { rawV2: rawEligible, analyticsCurrent: currentEligible };

    const rawMax = evaluateMaxDeleteGuard({
      table: 'raw.player_prop_snapshots_v2',
      totalRows: rawBefore,
      eligibleRows: rawEligible,
      maxPercent: pruneGate.snapshot.pruneMaxDeletePercent,
      maxRows: pruneGate.snapshot.pruneMaxDeleteRows,
      allowLargeDelete: pruneGate.snapshot.pruneAllowLargeDelete,
    });
    const currentMax = evaluateMaxDeleteGuard({
      table: 'analytics.player_props_current',
      totalRows: currentBefore,
      eligibleRows: currentEligible,
      maxPercent: pruneGate.snapshot.pruneMaxDeletePercent,
      maxRows: pruneGate.snapshot.pruneMaxDeleteRows,
      allowLargeDelete: pruneGate.snapshot.pruneAllowLargeDelete,
    });
    audit.maxDelete = {
      raw: {
        allowed: rawMax.allowed,
        reason: rawMax.reason,
        eligiblePercent: rawMax.eligiblePercent,
      },
      current: {
        allowed: currentMax.allowed,
        reason: currentMax.reason,
        eligiblePercent: currentMax.eligiblePercent,
      },
    };

    // Current-slate deletes are independent of archive/closing-line gates, but
    // still require the destructive prune env gate and max-delete caps.
    if (!currentMax.allowed) {
      audit.outcome = 'aborted';
      audit.reason = currentMax.reason;
      logPruneAudit(audit);
      return {
        httpStatus: 200,
        body: {
          ok: false,
          aborted: true,
          reason: audit.reason,
          materialized,
          rowsEligible: audit.rowsEligible,
          maxDelete: audit.maxDelete,
          runId,
        },
        audit,
      };
    }

    const seasons = await listSeasonsWithEligibleRaw(input.pool, RETENTION_DAYS);
    const rawPrefix = (env.NBA_RAW_PREFIX?.trim() || 'raw').replace(/\/+$/, '');
    const s3 =
      input.s3 !== undefined ? input.s3 : createArchiveS3FromEnv(env);
    const archive = await verifyRawPropsArchiveGate({
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

    const rawBlockReasons: string[] = [];
    if (pendingClosingLines > 0) {
      rawBlockReasons.push(
        `pending closing-line keys remain (${pendingClosingLines})`
      );
    }
    if (!rawMax.allowed) {
      rawBlockReasons.push(rawMax.reason);
    }
    if (rawEligible > 0 && seasons.length === 0) {
      rawBlockReasons.push(
        'eligible raw rows have no resolvable analytics.games.season for archive verification'
      );
    }
    if (rawEligible > 0 && !archive.ok) {
      rawBlockReasons.push(`archive gate failed: ${archive.reason}`);
    }

    let deletedRaw = 0;
    if (rawEligible > 0 && rawBlockReasons.length === 0) {
      deletedRaw = await deleteRawEligibleBatches(input.pool, RETENTION_DAYS);
    }

    const deletedCurrent = await deleteCurrentEligibleBatches(
      input.pool,
      RETENTION_DAYS
    );

    if (rawBlockReasons.length > 0) {
      audit.rowsDeleted = { rawV2: 0, analyticsCurrent: deletedCurrent };
      audit.rowsAfter = {
        rawV2: await countRawTotal(input.pool),
        analyticsCurrent: await countCurrentTotal(input.pool),
      };
      audit.outcome = 'aborted';
      audit.reason = `raw prune blocked: ${rawBlockReasons.join('; ')}`;
      logPruneAudit(audit);
      return {
        httpStatus: 200,
        body: {
          ok: false,
          aborted: true,
          rawPruneBlocked: true,
          reason: audit.reason,
          pendingClosingLines,
          prunedRawV2: 0,
          prunedAnalyticsCurrent: deletedCurrent,
          materialized,
          archiveVerification: audit.archiveVerification,
          maxDelete: audit.maxDelete,
          runId,
          retentionDays: RETENTION_DAYS,
        },
        audit,
      };
    }
    audit.rowsDeleted = { rawV2: deletedRaw, analyticsCurrent: deletedCurrent };
    audit.rowsAfter = {
      rawV2: await countRawTotal(input.pool),
      analyticsCurrent: await countCurrentTotal(input.pool),
    };
    audit.outcome = 'completed';
    audit.reason = 'prune completed';
    logPruneAudit(audit);

    return {
      httpStatus: 200,
      body: {
        ok: true,
        materialized,
        prunedRawV2: deletedRaw,
        prunedAnalyticsCurrent: deletedCurrent,
        retentionDays: RETENTION_DAYS,
        rowsBefore: audit.rowsBefore,
        rowsAfter: audit.rowsAfter,
        archiveVerification: audit.archiveVerification,
        runId,
      },
      audit,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    audit.outcome = 'error';
    audit.reason = message;
    logPruneAudit(audit);
    return {
      httpStatus: 500,
      body: { ok: false, error: message, runId },
      audit,
    };
  }
}
