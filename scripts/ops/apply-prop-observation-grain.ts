/**
 * Forward-only raw prop tape migration.
 * Refuses to run if a pull observation key is already duplicated.
 * Does not delete rows.
 *
 *   npx tsx scripts/ops/apply-prop-observation-grain.ts
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const connectionString = process.env.SUPABASE_DB_URL?.trim();
if (!connectionString) throw new Error('Missing SUPABASE_DB_URL');

async function main() {
  const pool = new Pool({
    connectionString,
    ssl:
      connectionString.includes('supabase.co') || connectionString.includes('pooler.supabase.com')
        ? { rejectUnauthorized: false }
        : undefined,
    max: 1,
  });
  try {
    const count = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM raw.player_prop_snapshots_v2`
    );
    const dupes = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM (
         SELECT pull_run_id, game_id, player_id, sportsbook, prop_type, side, line_value
         FROM raw.player_prop_snapshots_v2
         WHERE pull_run_id IS NOT NULL
         GROUP BY 1, 2, 3, 4, 5, 6, 7
         HAVING count(*) > 1
       ) d`
    );
    if (Number(dupes.rows[0]?.n ?? '0') > 0) {
      throw new Error('Refusing grain migration: duplicate pull observations already exist.');
    }
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'db/schemas/MIGRATION_player_prop_observation_grain.sql'),
      'utf8'
    );
    const view = fs.readFileSync(
      path.join(process.cwd(), 'db/schemas/research_v_prop_decision_lines.sql'),
      'utf8'
    );
    await pool.query(sql);
    await pool.query(view);
    const indexes = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'raw'
          AND tablename = 'player_prop_snapshots_v2'
          AND indexname IN (
            'raw_player_prop_snapshots_v2_pull_observation_uidx',
            'raw_player_prop_snapshots_v2_hourly_unique_idx'
          )`
    );
    const universe = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'raw'
          AND table_name = 'player_prop_game_runs'
          AND column_name = 'universe'`
    );
    console.log(
      JSON.stringify({
        snapshotRows: Number(count.rows[0]?.n ?? '0'),
        duplicatePullKeys: 0,
        indexes: indexes.rows.map((row) => row.indexname),
        universeColumn: universe.rows.length === 1,
      })
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'migration failed');
  process.exit(1);
});
