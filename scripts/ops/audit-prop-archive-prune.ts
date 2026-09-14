/**
 * Non-destructive audit of the player-prop prune archive invariant.
 * Never deletes. Does not require PRUNE_ENABLED.
 *
 *   npx tsx scripts/ops/audit-prop-archive-prune.ts
 *   npx tsx scripts/ops/audit-prop-archive-prune.ts --after 2026-09-14T07:00:00.000Z
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { mayPruneRawSnapshot, parseArchiveRequiredAfter } from '@/lib/archive/player-prop-snapshot-archive';
import {
  RETENTION_DAYS,
  countRawBlockedByMissingArchive,
  countRawDeletable,
  countRawEligible,
  countRawTotal,
} from '@/lib/prune/closing-lines';

function argValue(name: string, argv: string[]): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  return argv[i + 1];
}

async function breakdown(pool: Pool, retentionDays: number, requiredAfterIso: string | null) {
  const r = await pool.query<{
    age_eligible: string;
    new_required: string;
    new_required_archived: string;
    new_required_blocked: string;
    legacy_null_pull: string;
    legacy_before_cutoff: string;
  }>(
    `
    SELECT
      COUNT(*) FILTER (WHERE r.fetched_at < now() - ($1::text || ' days')::interval)::text AS age_eligible,
      COUNT(*) FILTER (
        WHERE r.fetched_at < now() - ($1::text || ' days')::interval
          AND r.pull_run_id IS NOT NULL
          AND NOT ($2::timestamptz IS NOT NULL AND gr.started_at IS NOT NULL AND gr.started_at < $2::timestamptz)
      )::text AS new_required,
      COUNT(*) FILTER (
        WHERE r.fetched_at < now() - ($1::text || ' days')::interval
          AND r.pull_run_id IS NOT NULL
          AND NOT ($2::timestamptz IS NOT NULL AND gr.started_at IS NOT NULL AND gr.started_at < $2::timestamptz)
          AND coalesce(gr.archive_status, '') = 'archived'
      )::text AS new_required_archived,
      COUNT(*) FILTER (
        WHERE r.fetched_at < now() - ($1::text || ' days')::interval
          AND r.pull_run_id IS NOT NULL
          AND NOT ($2::timestamptz IS NOT NULL AND gr.started_at IS NOT NULL AND gr.started_at < $2::timestamptz)
          AND coalesce(gr.archive_status, '') IS DISTINCT FROM 'archived'
      )::text AS new_required_blocked,
      COUNT(*) FILTER (
        WHERE r.fetched_at < now() - ($1::text || ' days')::interval
          AND r.pull_run_id IS NULL
      )::text AS legacy_null_pull,
      COUNT(*) FILTER (
        WHERE r.fetched_at < now() - ($1::text || ' days')::interval
          AND r.pull_run_id IS NOT NULL
          AND $2::timestamptz IS NOT NULL AND gr.started_at IS NOT NULL AND gr.started_at < $2::timestamptz
      )::text AS legacy_before_cutoff
    FROM raw.player_prop_snapshots_v2 r
    LEFT JOIN raw.player_prop_game_runs gr
      ON r.pull_run_id IS NOT NULL
     AND gr.pull_run_id = r.pull_run_id
     AND gr.game_id = r.game_id::text
    `,
    [String(retentionDays), requiredAfterIso]
  );
  const row = r.rows[0];
  return {
    ageEligible: Number(row?.age_eligible ?? 0),
    newRequired: Number(row?.new_required ?? 0),
    newRequiredArchived: Number(row?.new_required_archived ?? 0),
    newRequiredBlocked: Number(row?.new_required_blocked ?? 0),
    legacyNullPull: Number(row?.legacy_null_pull ?? 0),
    legacyBeforeCutoff: Number(row?.legacy_before_cutoff ?? 0),
  };
}

async function main() {
  const afterRaw =
    argValue('--after', process.argv) ??
    process.env.PLAYER_PROP_ARCHIVE_REQUIRED_AFTER ??
    '';
  const requiredAfter = parseArchiveRequiredAfter(afterRaw);
  const requiredAfterIso = requiredAfter ? requiredAfter.toISOString() : null;
  const dbUrl = process.env.SUPABASE_DB_URL?.trim();
  if (!dbUrl) throw new Error('Missing SUPABASE_DB_URL');

  const pool = new Pool({ connectionString: dbUrl, max: 1 });
  try {
    const total = await countRawTotal(pool);
    const eligible = await countRawEligible(pool, RETENTION_DAYS);
    const blocked = await countRawBlockedByMissingArchive(pool, RETENTION_DAYS, requiredAfterIso);
    const deletableIfDumpOk = await countRawDeletable(pool, RETENTION_DAYS, {
      requireArchive: true,
      requiredAfterIso,
      legacyDumpOk: true,
    });
    const deletableIfDumpFail = await countRawDeletable(pool, RETENTION_DAYS, {
      requireArchive: true,
      requiredAfterIso,
      legacyDumpOk: false,
    });
    const buckets = await breakdown(pool, RETENTION_DAYS, requiredAfterIso);

    const after = requiredAfter ?? new Date('2026-09-14T07:00:00.000Z');
    const proofs = {
      newAfterCutoffUnarchived: mayPruneRawSnapshot({
        requireArchive: true,
        requiredAfter: after,
        snapshotFetchedAt: new Date(after.getTime() + 60_000).toISOString(),
        snapshotPullRunId: 999001,
        gameRunStartedAt: new Date(after.getTime() + 60_000).toISOString(),
        archiveStatus: 'failed',
      }),
      newAfterCutoffArchived: mayPruneRawSnapshot({
        requireArchive: true,
        requiredAfter: after,
        snapshotFetchedAt: new Date(after.getTime() + 60_000).toISOString(),
        snapshotPullRunId: 999002,
        gameRunStartedAt: new Date(after.getTime() + 60_000).toISOString(),
        archiveStatus: 'archived',
      }),
      legacyBeforeCutoff: mayPruneRawSnapshot({
        requireArchive: true,
        requiredAfter: after,
        snapshotFetchedAt: '2026-04-02T00:00:00.000Z',
        snapshotPullRunId: 10,
        gameRunStartedAt: '2026-04-02T00:00:00.000Z',
        archiveStatus: 'pending',
      }),
      legacyNullPullRun: mayPruneRawSnapshot({
        requireArchive: true,
        requiredAfter: after,
        snapshotFetchedAt: '2026-04-02T00:00:00.000Z',
        snapshotPullRunId: null,
        gameRunStartedAt: null,
        archiveStatus: null,
      }),
    };

    console.log(
      JSON.stringify(
        {
          ok: true,
          deleted: 0,
          requireArchive: true,
          requiredAfter: requiredAfterIso,
          retentionDays: RETENTION_DAYS,
          live: {
            totalRows: total,
            ageEligible: eligible,
            requiringArchiveVerification: buckets.newRequired,
            blockedBecauseArchiveMissing: blocked,
            allowedBecauseArchiveVerified: buckets.newRequiredArchived,
            legacyNullPull: buckets.legacyNullPull,
            legacyBeforeCutoff: buckets.legacyBeforeCutoff,
            deletableIfLegacyDumpOk: deletableIfDumpOk,
            deletableIfLegacyDumpMissing: deletableIfDumpFail,
          },
          invariantProofs: proofs,
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
