/**
 * Transform raw.odds_snapshots -> analytics odds tables.
 * Idempotent — safe to run multiple times.
 *
 * Processes all raw snapshots (or a specific pull_run_id) and:
 *  1. Upserts analytics.game_odds_current (latest per game, preferred vendor)
 *  2. Appends analytics.game_odds_history (deduped by unique constraint)
 *  3. Refreshes analytics.game_line_movement_summary
 *
 * Prerequisites: raw_odds_schema.sql + analytics_odds_schema.sql applied.
 * Env: SUPABASE_DB_URL
 *
 * Usage:
 *   npx tsx scripts/transform-raw-odds-to-analytics.ts
 *   npx tsx scripts/transform-raw-odds-to-analytics.ts --pull-run-id 42
 *   npx tsx scripts/transform-raw-odds-to-analytics.ts --vendor fanduel
 */

import 'dotenv/config';
import { Pool } from 'pg';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
if (!SUPABASE_DB_URL) {
  console.error('Set SUPABASE_DB_URL in .env');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

const args = process.argv.slice(2);
const pullRunIdArg = args.includes('--pull-run-id')
  ? parseInt(args[args.indexOf('--pull-run-id') + 1], 10)
  : null;
const vendorArg = args.includes('--vendor')
  ? args[args.indexOf('--vendor') + 1]
  : 'draftkings';

async function main() {
  console.log('=== Transform: raw.odds_snapshots -> analytics odds ===');
  console.log(`Preferred vendor: ${vendorArg}`);
  if (pullRunIdArg) console.log(`Filtering to pull_run_id: ${pullRunIdArg}`);

  const client = await pool.connect();

  try {
    // Step 1: Upsert current odds (latest snapshot per game for preferred vendor)
    console.log('\n1. Upserting analytics.game_odds_current...');

    const pullFilter = pullRunIdArg ? 'AND s.pull_run_id = $2' : '';
    const currentParams: any[] = [vendorArg];
    if (pullRunIdArg) currentParams.push(pullRunIdArg);

    const currentResult = await client.query(
      `INSERT INTO analytics.game_odds_current (
         game_id, home_moneyline, away_moneyline,
         home_spread, home_spread_odds, away_spread, away_spread_odds,
         total, over_odds, under_odds,
         vendor, snapshot_at, pull_run_id, updated_at
       )
       SELECT DISTINCT ON (s.game_id)
         s.game_id,
         s.moneyline_home_odds, s.moneyline_away_odds,
         s.spread_home_value, s.spread_home_odds,
         s.spread_away_value, s.spread_away_odds,
         s.total_value, s.total_over_odds, s.total_under_odds,
         s.vendor,
         COALESCE(s.provider_updated_at, s.created_at),
         s.pull_run_id,
         now()
       FROM raw.odds_snapshots s
       WHERE s.vendor = $1
         AND s.game_id IN (SELECT game_id FROM analytics.games)
         ${pullFilter}
       ORDER BY s.game_id, s.created_at DESC
       ON CONFLICT (game_id) DO UPDATE SET
         home_moneyline = excluded.home_moneyline,
         away_moneyline = excluded.away_moneyline,
         home_spread = excluded.home_spread,
         home_spread_odds = excluded.home_spread_odds,
         away_spread = excluded.away_spread,
         away_spread_odds = excluded.away_spread_odds,
         total = excluded.total,
         over_odds = excluded.over_odds,
         under_odds = excluded.under_odds,
         vendor = excluded.vendor,
         snapshot_at = excluded.snapshot_at,
         pull_run_id = excluded.pull_run_id,
         updated_at = now()`,
      currentParams
    );
    console.log(`   Upserted ${currentResult.rowCount} current odds rows`);

    // Step 2: Append history (all vendors, deduped by unique constraint)
    console.log('\n2. Appending analytics.game_odds_history...');

    const historyParams: any[] = [];
    let historyFilter = 'WHERE s.game_id IN (SELECT game_id FROM analytics.games)';
    if (pullRunIdArg) {
      historyParams.push(pullRunIdArg);
      historyFilter += ' AND s.pull_run_id = $1';
    }

    const historyResult = await client.query(
      `INSERT INTO analytics.game_odds_history (
         game_id, home_moneyline, away_moneyline,
         home_spread, home_spread_odds, away_spread, away_spread_odds,
         total, over_odds, under_odds,
         vendor, snapshot_at, pull_run_id
       )
       SELECT
         s.game_id,
         s.moneyline_home_odds, s.moneyline_away_odds,
         s.spread_home_value, s.spread_home_odds,
         s.spread_away_value, s.spread_away_odds,
         s.total_value, s.total_over_odds, s.total_under_odds,
         s.vendor,
         COALESCE(s.provider_updated_at, s.created_at),
         s.pull_run_id
       FROM raw.odds_snapshots s
       ${historyFilter}
       ON CONFLICT (game_id, vendor, snapshot_at) DO NOTHING`,
      historyParams
    );
    console.log(`   Inserted ${historyResult.rowCount} new history rows`);

    // Step 3: Refresh line movement summary for all games in history
    console.log('\n3. Refreshing analytics.game_line_movement_summary...');

    const movementResult = await client.query(
      `INSERT INTO analytics.game_line_movement_summary (
         game_id,
         open_home_spread, open_total, open_home_ml,
         current_home_spread, current_total, current_home_ml,
         spread_movement, total_movement,
         snapshots_count, first_seen_at, last_seen_at, updated_at
       )
       SELECT
         h.game_id,
         first_val.home_spread, first_val.total, first_val.home_moneyline,
         last_val.home_spread, last_val.total, last_val.home_moneyline,
         last_val.home_spread - first_val.home_spread,
         last_val.total - first_val.total,
         agg.cnt, agg.first_at, agg.last_at, now()
       FROM (SELECT DISTINCT game_id FROM analytics.game_odds_history WHERE vendor = $1) h
       CROSS JOIN LATERAL (
         SELECT home_spread, total, home_moneyline
         FROM analytics.game_odds_history
         WHERE game_id = h.game_id AND vendor = $1
         ORDER BY snapshot_at ASC LIMIT 1
       ) first_val
       CROSS JOIN LATERAL (
         SELECT home_spread, total, home_moneyline
         FROM analytics.game_odds_history
         WHERE game_id = h.game_id AND vendor = $1
         ORDER BY snapshot_at DESC LIMIT 1
       ) last_val
       CROSS JOIN LATERAL (
         SELECT count(*)::int as cnt, min(snapshot_at) as first_at, max(snapshot_at) as last_at
         FROM analytics.game_odds_history
         WHERE game_id = h.game_id AND vendor = $1
       ) agg
       ON CONFLICT (game_id) DO UPDATE SET
         open_home_spread = excluded.open_home_spread,
         open_total = excluded.open_total,
         open_home_ml = excluded.open_home_ml,
         current_home_spread = excluded.current_home_spread,
         current_total = excluded.current_total,
         current_home_ml = excluded.current_home_ml,
         spread_movement = excluded.spread_movement,
         total_movement = excluded.total_movement,
         snapshots_count = excluded.snapshots_count,
         first_seen_at = excluded.first_seen_at,
         last_seen_at = excluded.last_seen_at,
         updated_at = now()`,
      [vendorArg]
    );
    console.log(`   Upserted ${movementResult.rowCount} line movement summaries`);

    console.log('\nTransform complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Transform failed:', err);
  pool.end().finally(() => process.exit(1));
});
