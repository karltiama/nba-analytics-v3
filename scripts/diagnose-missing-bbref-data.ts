import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Diagnose missing BBRef data and provide steps to fix it
 * Identifies games that need player stats scraped/populated
 */

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function diagnoseMissingData() {
  console.log('\n🔍 Diagnosing Missing BBRef Data\n');
  console.log('='.repeat(100));
  
  try {
    // Step 1: Find games in bbref_games that don't have player stats
    console.log('\n📋 Step 1: Identifying games missing player stats...\n');
    
    const missingPlayerStats = await pool.query(`
      SELECT 
        bg.bbref_game_id,
        bg.game_date,
        bg.home_team_abbr,
        bg.away_team_abbr,
        bg.home_team_id,
        bg.away_team_id,
        bg.status,
        bg.home_score,
        bg.away_score,
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM bbref_player_game_stats bpgs 
            WHERE bpgs.game_id = bg.bbref_game_id
          ) THEN true
          ELSE false
        END as has_player_stats,
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM scraped_boxscores sb 
            WHERE sb.game_id = bg.bbref_game_id AND sb.source = 'bbref_csv'
          ) THEN true
          ELSE false
        END as has_scraped_data
      FROM bbref_games bg
      WHERE NOT EXISTS (
        SELECT 1 FROM bbref_player_game_stats bpgs 
        WHERE bpgs.game_id = bg.bbref_game_id
      )
      ORDER BY bg.game_date ASC
      LIMIT 50
    `);
    
    console.log(`Found ${missingPlayerStats.rows.length} games missing player stats (showing first 50)\n`);
    
    const hasScrapedData = missingPlayerStats.rows.filter((g: any) => g.has_scraped_data).length;
    const needsScrapingCount = missingPlayerStats.rows.filter((g: any) => !g.has_scraped_data).length;
    
    console.log(`  - Games with scraped data but not populated: ${hasScrapedData}`);
    console.log(`  - Games that need scraping: ${needsScrapingCount}`);
    
    if (missingPlayerStats.rows.length > 0) {
      console.log('\n  Sample games missing player stats:');
      missingPlayerStats.rows.slice(0, 10).forEach((game: any, idx: number) => {
        const date = new Date(game.game_date).toISOString().split('T')[0];
        const status = game.has_scraped_data ? '📦 Has scraped data' : '❌ Needs scraping';
        console.log(`    ${idx + 1}. ${date} - ${game.away_team_abbr} @ ${game.home_team_abbr} (${status})`);
      });
    }
    
    // Step 2: Check scraped_boxscores coverage
    console.log('\n📋 Step 2: Checking scraped_boxscores coverage...\n');
    
    const scrapedCoverage = await pool.query(`
      SELECT 
        COUNT(DISTINCT sb.game_id) as games_with_scraped_data,
        COUNT(DISTINCT CASE WHEN sb.player_id IS NOT NULL THEN sb.game_id END) as games_with_resolved_players,
        COUNT(*) as total_scraped_rows
      FROM scraped_boxscores sb
      WHERE sb.source = 'bbref_csv'
    `);
    
    const scraped = scrapedCoverage.rows[0];
    console.log(`  Total games in scraped_boxscores: ${scraped.games_with_scraped_data}`);
    console.log(`  Games with resolved player_ids: ${scraped.games_with_resolved_players}`);
    console.log(`  Total scraped rows: ${scraped.total_scraped_rows}`);
    
    // Step 3: Check which games have scraped data but not populated
    console.log('\n📋 Step 3: Games with scraped data but not populated...\n');
    
    const scrapedButNotPopulated = await pool.query(`
      SELECT DISTINCT
        sb.game_id,
        bg.game_date,
        bg.home_team_abbr,
        bg.away_team_abbr,
        COUNT(DISTINCT sb.player_id) as players_with_ids,
        COUNT(*) as total_rows
      FROM scraped_boxscores sb
      JOIN bbref_games bg ON sb.game_id = bg.bbref_game_id
      WHERE sb.source = 'bbref_csv'
        AND sb.player_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM bbref_player_game_stats bpgs 
          WHERE bpgs.game_id = sb.game_id
        )
      GROUP BY sb.game_id, bg.game_date, bg.home_team_abbr, bg.away_team_abbr
      ORDER BY bg.game_date ASC
      LIMIT 20
    `);
    
    console.log(`Found ${scrapedButNotPopulated.rows.length} games with scraped data ready to populate\n`);
    
    if (scrapedButNotPopulated.rows.length > 0) {
      console.log('  Sample games ready to populate:');
      scrapedButNotPopulated.rows.slice(0, 10).forEach((game: any, idx: number) => {
        const date = new Date(game.game_date).toISOString().split('T')[0];
        console.log(`    ${idx + 1}. ${date} - ${game.away_team_abbr} @ ${game.home_team_abbr} (${game.players_with_ids} players)`);
      });
    }
    
    // Step 4: Check games that need scraping
    console.log('\n📋 Step 4: Games that need scraping...\n');
    
    const needsScraping = await pool.query(`
      SELECT 
        bg.bbref_game_id,
        bg.game_date,
        bg.home_team_abbr,
        bg.away_team_abbr,
        bg.status
      FROM bbref_games bg
      WHERE NOT EXISTS (
        SELECT 1 FROM scraped_boxscores sb 
        WHERE sb.game_id = bg.bbref_game_id AND sb.source = 'bbref_csv'
      )
      AND bg.status = 'Final'
      ORDER BY bg.game_date ASC
      LIMIT 20
    `);
    
    console.log(`Found ${needsScraping.rows.length} Final games that need scraping (showing first 20)\n`);
    
    if (needsScraping.rows.length > 0) {
      console.log('  Sample games that need scraping:');
      needsScraping.rows.slice(0, 10).forEach((game: any, idx: number) => {
        const date = new Date(game.game_date).toISOString().split('T')[0];
        console.log(`    ${idx + 1}. ${date} - ${game.away_team_abbr} @ ${game.home_team_abbr}`);
      });
    }
    
    // Step 5: Summary and action plan
    console.log('\n' + '='.repeat(100));
    console.log('\n📊 SUMMARY & ACTION PLAN\n');
    console.log('='.repeat(100));
    
    const totalGames = await pool.query(`
      SELECT COUNT(*) as total FROM bbref_games
    `);
    
    const gamesWithStats = await pool.query(`
      SELECT COUNT(DISTINCT game_id) as total FROM bbref_player_game_stats
    `);
    
    const gamesWithScraped = await pool.query(`
      SELECT COUNT(DISTINCT game_id) as total 
      FROM scraped_boxscores 
      WHERE source = 'bbref_csv' AND player_id IS NOT NULL
    `);
    
    const totalGamesCount = parseInt(totalGames.rows[0].total);
    const gamesWithStatsCount = parseInt(gamesWithStats.rows[0].total);
    const gamesWithScrapedCount = parseInt(gamesWithScraped.rows[0].total);
    
    console.log(`\nCurrent State:`);
    console.log(`  Total games in bbref_games: ${totalGamesCount}`);
    console.log(`  Games with player stats: ${gamesWithStatsCount}`);
    console.log(`  Games with scraped data ready: ${gamesWithScrapedCount}`);
    console.log(`  Games missing stats: ${totalGamesCount - gamesWithStatsCount}`);
    console.log(`  Games ready to populate: ${gamesWithScrapedCount - gamesWithStatsCount}`);
    console.log(`  Games that need scraping: ${totalGamesCount - gamesWithScrapedCount}`);
    
    console.log(`\n🎯 RECOMMENDED STEPS:\n`);
    
    if (gamesWithScrapedCount > gamesWithStatsCount) {
      console.log(`1. ✅ POPULATE EXISTING SCRAPED DATA (${gamesWithScrapedCount - gamesWithStatsCount} games)`);
      console.log(`   Run: npx tsx scripts/populate-bbref-stats.ts`);
      console.log(`   This will populate player stats from scraped_boxscores`);
      console.log(`   Then run: npx tsx scripts/populate-bbref-stats.ts --teams-only`);
      console.log(`   This will aggregate team stats from player stats\n`);
    }
    
    if (totalGamesCount > gamesWithScrapedCount) {
      console.log(`2. 📥 SCRAPE MISSING GAMES (${totalGamesCount - gamesWithScrapedCount} games)`);
      console.log(`   Need to scrape boxscores for games not in scraped_boxscores`);
      console.log(`   Check scripts/scrape-bbref-csv-boxscores.ts or similar scraping scripts`);
      console.log(`   Focus on Final games first\n`);
    }
    
    console.log(`3. 🔄 VERIFY DATA`);
    console.log(`   Run: npx tsx scripts/check-bbref-team-data.ts`);
    console.log(`   Or visit: http://localhost:3000/admin/bbref-data-check`);
    console.log(`   Check coverage percentages and identify remaining gaps\n`);
    
    console.log(`4. 🔁 REPEAT`);
    console.log(`   Continue scraping and populating until coverage is acceptable`);
    console.log(`   Target: 80%+ coverage for reliable analysis\n`);
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

async function main() {
  try {
    await diagnoseMissingData();
  } catch (error: any) {
    console.error('\nFatal error:', error.message);
    process.exit(1);
  }
}

main();

