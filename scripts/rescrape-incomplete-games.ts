import 'dotenv/config';
import { Pool } from 'pg';
import { processBBRefBoxScore } from './scrape-basketball-reference';

/**
 * Re-scrape games that have fewer than expected players resolved.
 * This targets games where the old resolver failed to match players
 * (due to trades, name variants, etc.) that the improved resolver can now handle.
 *
 * Usage:
 *   npx tsx scripts/rescrape-incomplete-games.ts                    # All incomplete games
 *   npx tsx scripts/rescrape-incomplete-games.ts --max-games 50     # Limit
 *   npx tsx scripts/rescrape-incomplete-games.ts --threshold 10     # Custom player threshold
 *   npx tsx scripts/rescrape-incomplete-games.ts --dry-run          # Preview only
 */

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const maxGames = parseInt(args[args.indexOf('--max-games') + 1]) || 500;
  const threshold = parseInt(args[args.indexOf('--threshold') + 1]) || 10;

  console.log(`Finding games where either team has fewer than ${threshold} active players...`);
  if (dryRun) console.log('*** DRY RUN ***\n');

  // Find incomplete BBRef games and match them to canonical game IDs (one per bbref game)
  const result = await pool.query(`
    WITH team_counts AS (
      SELECT
        bpgs.game_id,
        bpgs.team_id,
        COUNT(*) FILTER (WHERE bpgs.dnp_reason IS NULL) as active_count
      FROM bbref_player_game_stats bpgs
      GROUP BY bpgs.game_id, bpgs.team_id
    ),
    incomplete_games AS (
      SELECT DISTINCT tc.game_id
      FROM team_counts tc
      WHERE tc.active_count < $1
    ),
    matched AS (
      SELECT DISTINCT ON (bg.bbref_game_id)
        bg.bbref_game_id,
        bg.game_date,
        bg.home_team_abbr,
        bg.away_team_abbr,
        bg.home_team_id,
        bg.away_team_id,
        COALESCE(htc.active_count, 0) as home_active,
        COALESCE(atc.active_count, 0) as away_active,
        g.game_id as canonical_game_id
      FROM bbref_games bg
      JOIN incomplete_games ig ON ig.game_id = bg.bbref_game_id
      LEFT JOIN team_counts htc ON htc.game_id = bg.bbref_game_id AND htc.team_id = bg.home_team_id
      LEFT JOIN team_counts atc ON atc.game_id = bg.bbref_game_id AND atc.team_id = bg.away_team_id
      LEFT JOIN games g ON g.home_team_id = bg.home_team_id
        AND g.away_team_id = bg.away_team_id
        AND g.start_time::date BETWEEN (bg.game_date - interval '1 day')::date
                                    AND (bg.game_date + interval '1 day')::date
      WHERE bg.status = 'Final'
      ORDER BY bg.bbref_game_id, 
        CASE WHEN g.game_id IS NOT NULL AND LENGTH(g.game_id) <= 10 THEN 0 ELSE 1 END,
        g.game_id
    )
    SELECT * FROM matched ORDER BY game_date LIMIT $2
  `, [threshold, maxGames]);

  console.log(`Found ${result.rows.length} games to re-scrape\n`);

  if (result.rows.length === 0) {
    console.log('No incomplete games found.');
    await pool.end();
    return;
  }

  for (const g of result.rows) {
    const d = new Date(g.game_date).toISOString().split('T')[0];
    console.log(`  ${d} | ${g.away_team_abbr}@${g.home_team_abbr} | home:${g.home_active} away:${g.away_active} | ${g.canonical_game_id || 'no-canonical'}`);
  }

  if (dryRun) {
    console.log(`\nWould re-scrape ${result.rows.length} games. Run without --dry-run to proceed.`);
    await pool.end();
    return;
  }

  console.log(`\nRe-scraping ${result.rows.length} games...\n`);

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < result.rows.length; i++) {
    const g = result.rows[i];
    const d = new Date(g.game_date).toISOString().split('T')[0];

    if (!g.canonical_game_id) {
      console.log(`[${i + 1}/${result.rows.length}] ${d} ${g.away_team_abbr}@${g.home_team_abbr} — SKIPPED (no canonical game_id)`);
      skipped++;
      continue;
    }

    console.log(`[${i + 1}/${result.rows.length}] ${d} ${g.away_team_abbr}@${g.home_team_abbr}...`);

    try {
      const ok = await processBBRefBoxScore(g.canonical_game_id, dryRun);

      if (ok) {
        succeeded++;
      } else {
        console.log(`   ⚠️  No data returned`);
        skipped++;
      }
    } catch (err: any) {
      console.error(`   ❌ Error: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed: ${failed}`);
  console.log(`Skipped: ${skipped}`);

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
