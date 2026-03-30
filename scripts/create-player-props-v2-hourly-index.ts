/**
 * Creates hourly unique index on raw.player_prop_snapshots_v2 (IMMUTABLE expression).
 * Run after dedupe. Env: SUPABASE_DB_URL
 */
import 'dotenv/config';
import { Pool } from 'pg';

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('Set SUPABASE_DB_URL');
  process.exit(1);
}

async function main() {
  const pool = new Pool({ connectionString: dbUrl });
  try {
    await pool.query(`SET statement_timeout = '0'`);
    await pool.query(`
      create unique index if not exists raw_player_prop_snapshots_v2_hourly_unique_idx
        on raw.player_prop_snapshots_v2 (
          game_id,
          player_id,
          sportsbook,
          prop_type,
          side,
          line_value,
          (date_trunc('hour', fetched_at at time zone 'UTC'))
        )
    `);
    console.log('Index raw_player_prop_snapshots_v2_hourly_unique_idx OK');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
