/**
 * Verification script for line shopping: query analytics.player_prop_lines and getPlayerPropLineShopping.
 * Run after schema + transform. Env: SUPABASE_DB_URL
 *
 *   npx tsx scripts/verify-line-shopping.ts
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { getPlayerPropLines, getPlayerPropLineShopping } from '@/lib/betting/queries';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
if (!SUPABASE_DB_URL) {
  console.error('Set SUPABASE_DB_URL in .env');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

async function main() {
  // Step 3: Get one (game_id, player_id, market_type) that has data
  const sample = await pool.query(
    `SELECT game_id, player_id, market_type, count(*) as n
     FROM analytics.player_prop_lines
     GROUP BY game_id, player_id, market_type
     ORDER BY n DESC
     LIMIT 1`
  );
  if (sample.rows.length === 0) {
    console.log('No rows in analytics.player_prop_lines. Run transform first.');
    await pool.end();
    return;
  }
  const { game_id, player_id, market_type } = sample.rows[0];
  console.log('--- Step 3: Sample rows for', { game_id, player_id, market_type }, '---');
  const rows = await pool.query(
    `SELECT sportsbook, side, line_value, odds_american, odds_decimal, implied_probability, snapshot_at
     FROM analytics.player_prop_lines
     WHERE game_id = $1 AND player_id = $2 AND market_type = $3
     ORDER BY snapshot_at DESC
     LIMIT 12`,
    [game_id, player_id, market_type]
  );
  console.table(rows.rows);

  // Step 4: getPlayerPropLineShopping
  console.log('\n--- Step 4: getPlayerPropLineShopping(...) ---');
  const shopping = await getPlayerPropLineShopping(game_id, player_id, market_type);
  console.log(JSON.stringify(shopping, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
