import 'dotenv/config';
import { Pool } from 'pg';

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error('Missing SUPABASE_DB_URL');
  }

  const retentionDays = Number(getArg('--days') ?? '30');
  const batchSize = Number(getArg('--batch-size') ?? '50000');
  const sleepMs = Number(getArg('--sleep-ms') ?? '200');
  const execute = hasFlag('--execute');

  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    throw new Error(`Invalid --days value: ${retentionDays}`);
  }
  if (!Number.isFinite(batchSize) || batchSize < 1000) {
    throw new Error(`Invalid --batch-size value: ${batchSize}`);
  }
  if (!Number.isFinite(sleepMs) || sleepMs < 0) {
    throw new Error(`Invalid --sleep-ms value: ${sleepMs}`);
  }

  const pool = new Pool({ connectionString: dbUrl });
  const client = await pool.connect();
  try {
    const cutoff = await client.query<{ cutoff: string }>(
      `select (now() - ($1::text || ' days')::interval)::timestamptz as cutoff`,
      [String(retentionDays)]
    );
    const cutoffTs = cutoff.rows[0]?.cutoff;
    console.log(`Retention cutoff: ${cutoffTs}`);

    const estimate = await client.query<{ rows_to_delete: string }>(
      `select count(*)::text as rows_to_delete
       from raw.player_prop_snapshots_v2
       where fetched_at < now() - ($1::text || ' days')::interval`,
      [String(retentionDays)]
    );
    const toDelete = Number(estimate.rows[0]?.rows_to_delete ?? '0');
    console.log(`Rows older than ${retentionDays} days: ${toDelete}`);

    if (!execute) {
      console.log('Dry run only. Re-run with --execute to delete rows.');
      return;
    }

    let totalDeleted = 0;
    while (true) {
      const deleted = await client.query<{ deleted_rows: string }>(
        `with doomed as (
           select ctid
           from raw.player_prop_snapshots_v2
           where fetched_at < now() - ($1::text || ' days')::interval
           limit $2
         )
         delete from raw.player_prop_snapshots_v2 t
         using doomed d
         where t.ctid = d.ctid
         returning 1`,
        [String(retentionDays), batchSize]
      );
      const count = deleted.rowCount ?? 0;
      totalDeleted += count;
      console.log(`Deleted batch: ${count} (total: ${totalDeleted})`);
      if (count === 0) break;
      if (sleepMs > 0) await sleep(sleepMs);
    }

    await client.query(`vacuum (analyze) raw.player_prop_snapshots_v2`);
    console.log(`Done. Total rows deleted: ${totalDeleted}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Prune script failed:', err);
  process.exit(1);
});
