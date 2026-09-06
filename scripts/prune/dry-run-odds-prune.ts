/**
 * Non-destructive odds prune candidate-set dry run.
 *
 * Always dryRun=true. Never calls DELETE. Does not change Production env.
 *
 * Usage:
 *   npx tsx scripts/prune/dry-run-odds-prune.ts
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { evaluateMaxDeleteGuard } from '@/lib/prune/max-delete-guard';
import { readPruneEnvSnapshot } from '@/lib/prune/env-gate';
import { runPruneOddsJob } from '@/lib/prune/run-prune-odds';

async function main(): Promise<void> {
  const dbUrl = process.env.SUPABASE_DB_URL?.trim();
  if (!dbUrl) {
    console.error('Missing SUPABASE_DB_URL');
    process.exit(1);
  }

  const useSsl = dbUrl.includes('supabase.co') || dbUrl.includes('pooler.supabase.com');
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });

  const deleteEligible = async () => {
    throw new Error('dry-run script must never delete');
  };

  try {
    console.log('=== Odds prune dry-run (no DELETE) ===');
    const freeze = await runPruneOddsJob({
      pool,
      env: process.env,
      authenticated: true,
      dryRun: true,
      deleteEligible,
    });
    console.log('\n--- freeze env dry-run ---');
    console.log(JSON.stringify(freeze.body, null, 2));

    const snapshot = readPruneEnvSnapshot(process.env);
    const eligible = Number(freeze.body.rowsEligible ?? 0);
    const total = Number(freeze.body.rowsBefore ?? 0);
    const withoutOverride = evaluateMaxDeleteGuard({
      table: 'raw.odds_snapshots',
      totalRows: total,
      eligibleRows: eligible,
      maxPercent: snapshot.pruneMaxDeletePercent,
      maxRows: snapshot.pruneMaxDeleteRows,
      allowLargeDelete: false,
    });
    const withOverride = evaluateMaxDeleteGuard({
      table: 'raw.odds_snapshots',
      totalRows: total,
      eligibleRows: eligible,
      maxPercent: snapshot.pruneMaxDeletePercent,
      maxRows: snapshot.pruneMaxDeleteRows,
      allowLargeDelete: true,
    });

    const overrideDryRun = await runPruneOddsJob({
      pool,
      env: { ...process.env, PRUNE_ALLOW_LARGE_DELETE: '1' },
      authenticated: true,
      dryRun: true,
      deleteEligible,
    });
    console.log('\n--- max-delete simulation (no DELETE) ---');
    console.log(
      JSON.stringify(
        {
          withoutOverride,
          withOverride,
          overrideDryRun: {
            outcome: overrideDryRun.audit.outcome,
            maxDelete: overrideDryRun.audit.maxDelete,
            archiveOk: overrideDryRun.audit.archiveVerification.ok,
            coverageOk: overrideDryRun.audit.coverage.ok,
            rowsDeleted: overrideDryRun.audit.rowsDeleted,
            wouldDelete: overrideDryRun.body.wouldDelete,
          },
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
