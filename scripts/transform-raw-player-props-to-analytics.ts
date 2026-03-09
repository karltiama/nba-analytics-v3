/**
 * Transform raw.player_prop_snapshots -> analytics player prop tables.
 * Idempotent — safe to run multiple times.
 *
 * Processes all raw snapshots (or a specific pull_run_id) and:
 *  1. Refreshes analytics.player_prop_current (delete+insert per game, preferred vendor)
 *  2. Appends analytics.player_prop_history (deduped by unique constraint)
 *  3. Refreshes analytics.player_prop_movement_summary (O/U open vs current)
 *
 * Prerequisites: raw_player_props_schema.sql + analytics_player_props_schema.sql applied.
 * Env: SUPABASE_DB_URL
 *
 * Usage:
 *   npx tsx scripts/transform-raw-player-props-to-analytics.ts
 *   npx tsx scripts/transform-raw-player-props-to-analytics.ts --pull-run-id 42
 *   npx tsx scripts/transform-raw-player-props-to-analytics.ts --vendor fanduel
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
  console.log('=== Transform: raw.player_prop_snapshots -> analytics player props ===');
  console.log(`Preferred vendor: ${vendorArg}`);
  if (pullRunIdArg) console.log(`Filtering to pull_run_id: ${pullRunIdArg}`);

  const client = await pool.connect();

  try {
    // Step 1: Refresh current props (delete stale, insert latest for preferred vendor)
    console.log('\n1. Refreshing analytics.player_prop_current...');

    const pullFilter = pullRunIdArg ? 'AND s.pull_run_id = $1' : '';
    const baseParams: any[] = pullRunIdArg ? [pullRunIdArg] : [];

    // Find affected game_ids from raw snapshots
    const gamesResult = await client.query(
      `SELECT DISTINCT s.game_id
       FROM raw.player_prop_snapshots s
       WHERE s.game_id IN (SELECT game_id FROM analytics.games)
         AND s.player_id IN (SELECT player_id FROM analytics.players)
         AND s.vendor = $${baseParams.length + 1}
         ${pullFilter}`,
      [...baseParams, vendorArg]
    );
    const affectedGameIds = gamesResult.rows.map((r: any) => r.game_id);
    console.log(`   Found ${affectedGameIds.length} affected games`);

    let currentCount = 0;
    for (const gameId of affectedGameIds) {
      // Delete existing current rows for this game + vendor
      await client.query(
        `DELETE FROM analytics.player_prop_current
         WHERE game_id = $1 AND vendor = $2`,
        [gameId, vendorArg]
      );

      // Insert latest snapshot per unique prop market
      const vendorIdx = baseParams.length + 1;
      const gameIdx = vendorIdx + 1;
      const insertResult = await client.query(
        `INSERT INTO analytics.player_prop_current (
           game_id, player_id, player_name, vendor,
           prop_type, line_value, market_type,
           over_odds, under_odds, milestone_odds,
           bdl_prop_id, snapshot_at, pull_run_id, updated_at
         )
         SELECT DISTINCT ON (s.game_id, s.player_id, s.prop_type, s.market_type, s.line_value)
           s.game_id, s.player_id,
           p.full_name,
           s.vendor,
           s.prop_type, s.line_value, s.market_type,
           s.over_odds, s.under_odds, s.milestone_odds,
           s.bdl_prop_id,
           COALESCE(s.provider_updated_at, s.created_at),
           s.pull_run_id,
           now()
         FROM raw.player_prop_snapshots s
         LEFT JOIN analytics.players p ON p.player_id = s.player_id
         WHERE s.vendor = $${vendorIdx}
           AND s.game_id = $${gameIdx}
           AND s.player_id IN (SELECT player_id FROM analytics.players)
           ${pullFilter}
         ORDER BY s.game_id, s.player_id, s.prop_type, s.market_type, s.line_value,
                  s.created_at DESC`,
        [...baseParams, vendorArg, gameId]
      );
      currentCount += insertResult.rowCount ?? 0;
    }
    console.log(`   Inserted ${currentCount} current prop rows`);

    // Step 2: Append history (all vendors, deduped by unique constraint)
    console.log('\n2. Appending analytics.player_prop_history...');

    let historyFilter = `WHERE s.game_id IN (SELECT game_id FROM analytics.games)
       AND s.player_id IN (SELECT player_id FROM analytics.players)`;
    const historyParams: any[] = [];
    if (pullRunIdArg) {
      historyParams.push(pullRunIdArg);
      historyFilter += ' AND s.pull_run_id = $1';
    }

    const historyResult = await client.query(
      `INSERT INTO analytics.player_prop_history (
         game_id, player_id, player_name, vendor,
         prop_type, line_value, market_type,
         over_odds, under_odds, milestone_odds,
         bdl_prop_id, snapshot_at, pull_run_id
       )
       SELECT
         s.game_id, s.player_id,
         p.full_name,
         s.vendor,
         s.prop_type, s.line_value, s.market_type,
         s.over_odds, s.under_odds, s.milestone_odds,
         s.bdl_prop_id,
         COALESCE(s.provider_updated_at, s.created_at),
         s.pull_run_id
       FROM raw.player_prop_snapshots s
       LEFT JOIN analytics.players p ON p.player_id = s.player_id
       ${historyFilter}
       ON CONFLICT (game_id, player_id, vendor, prop_type, market_type, line_value, snapshot_at) DO NOTHING`,
      historyParams
    );
    console.log(`   Inserted ${historyResult.rowCount} new history rows`);

    // Step 3: Refresh movement summary for O/U markets
    console.log('\n3. Refreshing analytics.player_prop_movement_summary...');

    const movementResult = await client.query(
      `INSERT INTO analytics.player_prop_movement_summary (
         game_id, player_id, player_name, vendor, prop_type,
         open_line, open_over_odds, open_under_odds,
         current_line, current_over_odds, current_under_odds,
         line_movement, snapshots_count, first_seen_at, last_seen_at, updated_at
       )
       SELECT
         h.game_id, h.player_id,
         p.full_name,
         $1, h.prop_type,
         first_val.line_value, first_val.over_odds, first_val.under_odds,
         last_val.line_value, last_val.over_odds, last_val.under_odds,
         last_val.line_value - first_val.line_value,
         agg.cnt, agg.first_at, agg.last_at, now()
       FROM (
         SELECT DISTINCT game_id, player_id, prop_type
         FROM analytics.player_prop_history
         WHERE vendor = $1 AND market_type = 'over_under'
       ) h
       LEFT JOIN analytics.players p ON p.player_id = h.player_id
       CROSS JOIN LATERAL (
         SELECT line_value, over_odds, under_odds
         FROM analytics.player_prop_history
         WHERE game_id = h.game_id AND player_id = h.player_id
           AND prop_type = h.prop_type AND vendor = $1 AND market_type = 'over_under'
         ORDER BY snapshot_at ASC LIMIT 1
       ) first_val
       CROSS JOIN LATERAL (
         SELECT line_value, over_odds, under_odds
         FROM analytics.player_prop_history
         WHERE game_id = h.game_id AND player_id = h.player_id
           AND prop_type = h.prop_type AND vendor = $1 AND market_type = 'over_under'
         ORDER BY snapshot_at DESC LIMIT 1
       ) last_val
       CROSS JOIN LATERAL (
         SELECT count(*)::int as cnt, min(snapshot_at) as first_at, max(snapshot_at) as last_at
         FROM analytics.player_prop_history
         WHERE game_id = h.game_id AND player_id = h.player_id
           AND prop_type = h.prop_type AND vendor = $1 AND market_type = 'over_under'
       ) agg
       ON CONFLICT (game_id, player_id, vendor, prop_type) DO UPDATE SET
         player_name = excluded.player_name,
         open_line = excluded.open_line,
         open_over_odds = excluded.open_over_odds,
         open_under_odds = excluded.open_under_odds,
         current_line = excluded.current_line,
         current_over_odds = excluded.current_over_odds,
         current_under_odds = excluded.current_under_odds,
         line_movement = excluded.line_movement,
         snapshots_count = excluded.snapshots_count,
         first_seen_at = excluded.first_seen_at,
         last_seen_at = excluded.last_seen_at,
         updated_at = now()`,
      [vendorArg]
    );
    console.log(`   Upserted ${movementResult.rowCount} movement summaries`);

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
