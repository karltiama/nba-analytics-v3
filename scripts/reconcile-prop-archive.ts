/**
 * Read-only player-prop archive reconciliation.
 *
 * Usage:
 *   npm run reconcile:prop-archive -- --date 2026-10-21
 *   npm run reconcile:prop-archive -- --from 2026-10-21 --to 2026-10-22
 *   npm run reconcile:prop-archive -- --date 2026-10-21 --s3
 *
 * Exits 1 when any completed game run stored rows without a verified archive.
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { PlayerPropArchiveS3 } from '@/lib/archive/player-prop-snapshot-s3';
import {
  RECONCILE_GAME_RUNS_SQL,
  formatPropArchiveReconcileReport,
  parseReconcileArgs,
  summarizePropArchiveReconciliation,
  type ReconcileGameRun,
} from '@/lib/archive/reconcile-prop-archive';

async function main(): Promise<void> {
  const args = parseReconcileArgs(process.argv.slice(2));
  const dbUrl = process.env.SUPABASE_DB_URL?.trim();
  if (!dbUrl) throw new Error('SUPABASE_DB_URL is required');
  const pool = new Pool({ connectionString: dbUrl, max: 2 });
  try {
    const result = await pool.query<{
      pull_run_id: string | number;
      game_id: string;
      started_at: Date;
      rows_stored: string | number;
      rows_archived: string | number;
      archive_object_count: string | number;
      archive_status: string;
      archive_key: string | null;
    }>(RECONCILE_GAME_RUNS_SQL, [args.from, args.to]);

    const bucket = process.env.NBA_DATA_BUCKET?.trim();
    const s3 = args.checkS3 && bucket ? new PlayerPropArchiveS3(bucket) : null;
    const rows: ReconcileGameRun[] = [];
    for (const row of result.rows) {
      const item: ReconcileGameRun = {
        pullRunId: Number(row.pull_run_id),
        gameId: String(row.game_id),
        startedAt: new Date(row.started_at).toISOString(),
        rowsStored: Number(row.rows_stored),
        rowsArchived: Number(row.rows_archived),
        archiveObjectCount: Number(row.archive_object_count),
        archiveStatus: row.archive_status,
        archiveKey: row.archive_key,
        s3ObjectFound: null,
      };
      if (s3 && item.archiveKey) {
        item.s3ObjectFound = (await s3.head(item.archiveKey)) != null;
      }
      rows.push(item);
    }

    const report = summarizePropArchiveReconciliation(rows, args);
    console.log(formatPropArchiveReconcileReport(report));
    if (report.missingArchives > 0 || report.failedArchives > 0) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
