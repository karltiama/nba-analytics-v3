/**
 * Non-destructive injury prune candidate-set dry run.
 *
 * Always dryRun=true. Never calls DELETE. Does not change Production env.
 *
 * Usage:
 *   npx tsx scripts/prune/dry-run-injuries-prune.ts
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { evaluateMaxDeleteGuard } from '@/lib/prune/max-delete-guard';
import { readPruneEnvSnapshot } from '@/lib/prune/env-gate';
import { runPruneInjuriesJob } from '@/lib/prune/run-prune-injuries';

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
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 120000),
  });

  const deleteEligible = async () => {
    throw new Error('dry-run script must never delete');
  };

  try {
    console.log('=== Injury prune dry-run (no DELETE) ===');
    const freeze = await runPruneInjuriesJob({
      pool,
      env: process.env,
      authenticated: true,
      dryRun: true,
      deleteEligible,
    });
    console.log('\n--- freeze env dry-run ---');
    console.log(JSON.stringify(freeze.body, null, 2));
    console.log('\n--- freeze audit (selected) ---');
    console.log(
      JSON.stringify(
        {
          event: freeze.audit.event,
          entity: freeze.audit.entity,
          sourceTable: freeze.audit.sourceTable,
          retentionDays: freeze.audit.retentionDays,
          cutoffEt: freeze.audit.cutoffEt,
          pruneAllowed: freeze.audit.pruneAllowed,
          pruneAllowLargeDelete: freeze.audit.pruneAllowLargeDelete,
          dryRun: freeze.audit.dryRun,
          outcome: freeze.audit.outcome,
          reason: freeze.audit.reason,
          rowsDeleted: freeze.audit.rowsDeleted,
        },
        null,
        2
      )
    );

    const snapshot = readPruneEnvSnapshot(process.env);
    const eligible = Number(freeze.body.rowsEligible ?? 0);
    const total = Number(freeze.body.rowsBefore ?? 0);
    const withoutOverride = evaluateMaxDeleteGuard({
      table: 'raw.player_injuries',
      totalRows: total,
      eligibleRows: eligible,
      maxPercent: snapshot.pruneMaxDeletePercent,
      maxRows: snapshot.pruneMaxDeleteRows,
      allowLargeDelete: false,
    });
    const withOverride = evaluateMaxDeleteGuard({
      table: 'raw.player_injuries',
      totalRows: total,
      eligibleRows: eligible,
      maxPercent: snapshot.pruneMaxDeletePercent,
      maxRows: snapshot.pruneMaxDeleteRows,
      allowLargeDelete: true,
    });

    const overrideDryRun = await runPruneInjuriesJob({
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
            pruneAllowed: overrideDryRun.audit.pruneAllowed,
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
