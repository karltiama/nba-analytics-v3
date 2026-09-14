/**
 * Additive player-prop archive metadata. Safe to re-run.
 *   npx tsx scripts/ops/apply-player-prop-snapshot-archive-migration.ts
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const connectionString = process.env.SUPABASE_DB_URL?.trim();
if (!connectionString) {
  throw new Error('Missing SUPABASE_DB_URL');
}

async function main() {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'db/schemas/MIGRATION_player_prop_snapshot_archive.sql'),
    'utf8'
  );
  const pool = new Pool({
    connectionString,
    ssl:
      connectionString.includes('supabase.co') ||
      connectionString.includes('pooler.supabase.com')
        ? { rejectUnauthorized: false }
        : undefined,
    max: 1,
  });
  try {
    await pool.query(sql);
    const cols = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'raw'
         AND (
           (table_name = 'player_prop_game_runs'
            AND column_name IN (
              'rows_archived','archive_object_count','archive_completed_at',
              'archive_status','archive_error','archive_key'
            ))
           OR (table_name = 'player_prop_snapshots_v2' AND column_name = 'pull_run_id')
         )
       ORDER BY table_name, column_name`
    );
    console.log(JSON.stringify({ applied: true, columns: cols.rows }, null, 2));
  } finally {
    await pool.end();
  }
}

void main();
