/**
 * Read-only as-of replay against the March–May 2026 injury tape.
 * Does not add injuries to the learned models. Does not write.
 *
 *   npx tsx scripts/injuries/validate-asof-replay-2026.ts
 */
import 'dotenv/config';

import { Pool } from 'pg';
import { resolveInjuryAsOf, type InjuryObservation, type InjuryPullRun } from '../../lib/context/collection-asof';

async function main() {
  const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('SUPABASE_DB_URL or DATABASE_URL required');
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    const runsRes = await pool.query<{
      pull_run_id: number;
      pulled_at: Date;
      status: string;
      rows_stored: number | null;
      rows_returned: number | null;
      metadata: unknown;
    }>(
      `
      SELECT pull_run_id, pulled_at, status, rows_stored, rows_returned, metadata
      FROM raw.injury_pull_runs
      WHERE pulled_at >= '2026-03-10'::timestamptz
        AND pulled_at < '2026-05-07'::timestamptz
      ORDER BY pull_run_id
      `
    );
    const obsRes = await pool.query<{
      pull_run_id: number;
      provider_player_id: string;
      status: string | null;
      created_at: Date;
    }>(
      `
      SELECT pull_run_id, provider_player_id::text AS provider_player_id, status, created_at
      FROM raw.player_injuries
      WHERE created_at >= '2026-03-10'::timestamptz
        AND created_at < '2026-05-07'::timestamptz
      `
    );
    const runs: InjuryPullRun[] = runsRes.rows.map((r) => ({
      pullRunId: Number(r.pull_run_id),
      observedAt: r.pulled_at.toISOString(),
      status: (r.status === 'error' ? 'error' : r.status === 'success' ? 'success' : 'started') as InjuryPullRun['status'],
      complete: r.status === 'success' && r.rows_stored != null && r.rows_returned != null && Number(r.rows_stored) === Number(r.rows_returned) && Number(r.rows_stored) > 0,
      completenessReason: r.status === 'success' ? 'replay from stored pull' : 'replay non-success pull',
      memberPlayerIds: obsRes.rows.filter((o) => Number(o.pull_run_id) === Number(r.pull_run_id)).map((o) => String(o.provider_player_id)),
    }));
    const observations: InjuryObservation[] = obsRes.rows.map((o) => ({
      playerId: String(o.provider_player_id),
      providerStatus: o.status,
      description: null,
      returnDateRaw: null,
      teamId: null,
      observedAt: o.created_at.toISOString(),
      sourcePublishedAt: null,
      pullRunId: Number(o.pull_run_id),
      reportMembership: 'in_report',
      gameId: null,
      gameLinkProvenance: 'none',
    }));
    const failed = runs.filter((r) => r.status === 'error' || !r.complete);
    const samplePlayer = observations[0]?.playerId;
    const cutoff = runs[runs.length - 1]?.observedAt ?? new Date().toISOString();
    const asOf = samplePlayer
      ? resolveInjuryAsOf({ playerId: samplePlayer, cutoffAt: cutoff, runs, observations })
      : null;
    const afterFailedCutoff =
      failed[0] && samplePlayer
        ? resolveInjuryAsOf({
            playerId: samplePlayer,
            cutoffAt: failed[0].observedAt,
            runs,
            observations,
          })
        : null;
    console.log(
      JSON.stringify(
        {
          tape: '2026-03-10/2026-05-06',
          used_in_learned_model: false,
          runs: runs.length,
          observations: observations.length,
          failed_or_incomplete_runs: failed.length,
          sample_as_of: asOf
            ? {
                playerId: asOf.playerId,
                providerStatus: asOf.providerStatus,
                reportMembership: asOf.reportMembership,
                collectionHealth: asOf.collectionHealth,
                latestPullFailed: asOf.latestPullFailed,
                lastSuccessfulPullRunId: asOf.lastSuccessfulPullRunId,
              }
            : null,
          failed_latest_keeps_status: afterFailedCutoff?.providerStatus ?? null,
          writes: false,
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
  console.error(err);
  process.exit(1);
});
