/**
 * Quick verify: raw.injury_pull_runs, raw.player_injuries, analytics injury tables.
 * Usage: npx tsx scripts/verify-injury-tables.ts
 */
import 'dotenv/config';
import { Pool } from 'pg';

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('Set SUPABASE_DB_URL in .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const run = await pool.query(
    'SELECT pull_run_id, pulled_at, status, rows_returned, rows_stored FROM raw.injury_pull_runs ORDER BY pulled_at DESC LIMIT 1'
  );
  console.log('Step 3 — Latest pull run:', run.rows[0] ?? 'none');

  const rawCount = await pool.query(
    'SELECT count(*) as n FROM raw.player_injuries WHERE pull_run_id = (SELECT max(pull_run_id) FROM raw.injury_pull_runs)'
  );
  console.log('raw.player_injuries for latest run:', rawCount.rows[0].n);

  const cur = await pool.query('SELECT count(*) as n FROM analytics.player_injury_status_current');
  console.log('Step 4 — analytics.player_injury_status_current count:', cur.rows[0].n);

  const hist = await pool.query('SELECT count(*) as n FROM analytics.player_injury_status_history');
  console.log('analytics.player_injury_status_history count:', hist.rows[0].n);

  const sample = await pool.query(
    'SELECT player_id, team_id, status, description FROM analytics.player_injury_status_current LIMIT 3'
  );
  console.log('Sample current rows:', sample.rows);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
