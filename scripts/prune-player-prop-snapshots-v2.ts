/**
 * Props prune CLI — same job as /api/cron/prune-props.
 *
 * Does NOT delete unless:
 *   --execute  AND  PRUNE_ENABLED=1  AND  DATA_MODE=live_api
 *   AND OFFSEASON_MODE=0  AND  CRON_DRY_RUN=0
 *   AND archive verification / closing-line completeness / max-delete gates pass
 *   (see lib/prune/run-prune-props.ts).
 *
 * Without --execute, PRUNE_ENABLED is forced off (no delete even if env is live).
 * Missing or malformed prune env => no delete.
 *
 * Usage:
 *   tsx scripts/prune-player-prop-snapshots-v2.ts
 *   tsx scripts/prune-player-prop-snapshots-v2.ts --execute
 *
 * Do not use this to bypass cron safeguards. Retention window is the job default
 * (not --days). --days / --batch-size / --sleep-ms are rejected.
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { overlayPruneCliEnv } from '@/lib/prune/cli-env';
import { runPrunePropsJob } from '@/lib/prune/run-prune-props';

function hasFlag(name: string, argv: string[] = process.argv): boolean {
  return argv.includes(name);
}

function assertNoLegacyDestructiveFlags(argv: string[] = process.argv): void {
  const blocked = ['--days', '--batch-size', '--sleep-ms'];
  const found = blocked.filter((flag) => argv.includes(flag));
  if (found.length > 0) {
    throw new Error(
      `Removed flags ${found.join(', ')}: this CLI uses the cron prune job (3-day retention + gates). Do not pass a custom delete window.`
    );
  }
}

async function main() {
  assertNoLegacyDestructiveFlags();

  const execute = hasFlag('--execute');
  const env = overlayPruneCliEnv(process.env, execute);

  const dbUrl = env.SUPABASE_DB_URL ?? process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error('Missing SUPABASE_DB_URL; no delete performed.');
    process.exit(1);
  }

  if (!execute) {
    console.log(
      'No --execute: prune env is forced skip (PRUNE_ENABLED=0). Re-run with --execute only when cron safety env is intentionally set.'
    );
  }

  const pool = new Pool({ connectionString: dbUrl });
  try {
    const result = await runPrunePropsJob({
      pool,
      env,
      authenticated: true,
    });
    console.log(JSON.stringify(result.body, null, 2));
    if (result.body.ok === false || result.httpStatus >= 500) {
      process.exit(1);
    }
    const deletedRaw = result.audit.rowsDeleted.rawV2;
    const deletedCurrent = result.audit.rowsDeleted.analyticsCurrent;
    if (!execute && (deletedRaw > 0 || deletedCurrent > 0)) {
      console.error('Refusing: dry CLI path deleted rows. This is a bug.');
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Prune script failed:', err);
  process.exit(1);
});
