import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  try {
    console.log('\n🔍 Checking Scraped Boxscores Coverage\n');
    console.log('='.repeat(100));
    
    // Count games in scraped_boxscores
    const scrapedCount = await pool.query(`
      SELECT COUNT(DISTINCT game_id) as total_games
      FROM scraped_boxscores
    `);
    
    console.log(`\n📊 SCRAPED_BOXSCORES: ${scrapedCount.rows[0].total_games} unique games\n`);
    
    // Count games in bbref_player_game_stats
    const playerStatsCount = await pool.query(`
      SELECT COUNT(DISTINCT game_id) as total_games
      FROM bbref_player_game_stats
    `);
    
    console.log(`📊 BBREF_PLAYER_GAME_STATS: ${playerStatsCount.rows[0].total_games} unique games\n`);
    
    // Count games in bbref_team_game_stats
    const teamStatsCount = await pool.query(`
      SELECT COUNT(DISTINCT game_id) as total_games
      FROM bbref_team_game_stats
    `);
    
    console.log(`📊 BBREF_TEAM_GAME_STATS: ${teamStatsCount.rows[0].total_games} unique games\n`);
    
    // Check which games in scraped_boxscores match bbref_schedule by canonical_game_id
    const matchedScraped = await pool.query(`
      SELECT 
        COUNT(DISTINCT sb.game_id) as scraped_games,
        COUNT(DISTINCT CASE WHEN bs.canonical_game_id IS NOT NULL THEN sb.game_id END) as matched_to_schedule
      FROM scraped_boxscores sb
      LEFT JOIN bbref_schedule bs ON sb.game_id = bs.canonical_game_id
    `);
    
    console.log(`\n🔗 LINKING ANALYSIS (by canonical_game_id):`);
    console.log(`   Scraped games: ${matchedScraped.rows[0].scraped_games}`);
    console.log(`   Matched to schedule: ${matchedScraped.rows[0].matched_to_schedule}`);
    
    // Check date range of scraped data
    const dateRange = await pool.query(`
      SELECT 
        MIN(created_at::date) as earliest,
        MAX(created_at::date) as latest,
        COUNT(DISTINCT created_at::date) as unique_dates
      FROM scraped_boxscores
    `);
    
    console.log(`\n📅 DATE RANGE:`);
    console.log(`   Earliest: ${dateRange.rows[0].earliest}`);
    console.log(`   Latest: ${dateRange.rows[0].latest}`);
    console.log(`   Unique dates: ${dateRange.rows[0].unique_dates}`);
    
    // Sample games from scraped_boxscores
    const sampleScraped = await pool.query(`
      SELECT 
        sb.game_id,
        MIN(sb.created_at::date) as scraped_date,
        COUNT(*) as player_rows
      FROM scraped_boxscores sb
      GROUP BY sb.game_id
      ORDER BY MIN(sb.created_at) DESC
      LIMIT 10
    `);
    
    console.log(`\n📋 SAMPLE SCRAPED GAMES (last 10):`);
    sampleScraped.rows.forEach((g: any, i: number) => {
      console.log(`  ${i + 1}. Game ID: ${g.game_id}`);
      console.log(`     Scraped: ${g.scraped_date}`);
      console.log(`     Player rows: ${g.player_rows}`);
    });
    
    // Check which scraped games are NOT in bbref_player_game_stats
    const missingPlayerStats = await pool.query(`
      SELECT DISTINCT sb.game_id
      FROM scraped_boxscores sb
      WHERE NOT EXISTS (
        SELECT 1 FROM bbref_player_game_stats bpgs 
        WHERE bpgs.game_id = sb.game_id
      )
      LIMIT 10
    `);
    
    console.log(`\n❌ SCRAPED GAMES NOT IN PLAYER STATS (sample):`);
    if (missingPlayerStats.rows.length > 0) {
      missingPlayerStats.rows.forEach((g: any, i: number) => {
        console.log(`  ${i + 1}. ${g.game_id}`);
      });
    } else {
      console.log(`  ✅ All scraped games are in player stats`);
    }
    
    // Check which games in bbref_player_game_stats are NOT in bbref_team_game_stats
    const missingTeamStats = await pool.query(`
      SELECT DISTINCT bpgs.game_id
      FROM bbref_player_game_stats bpgs
      WHERE NOT EXISTS (
        SELECT 1 FROM bbref_team_game_stats btgs 
        WHERE btgs.game_id = bpgs.game_id
      )
      LIMIT 10
    `);
    
    console.log(`\n❌ PLAYER STATS GAMES NOT IN TEAM STATS (sample):`);
    if (missingTeamStats.rows.length > 0) {
      missingTeamStats.rows.forEach((g: any, i: number) => {
        console.log(`  ${i + 1}. ${g.game_id}`);
      });
      console.log(`\n💡 Run populate-bbref-stats.ts to populate team stats`);
    } else {
      console.log(`  ✅ All player stats games are in team stats`);
    }
    
    console.log('\n' + '='.repeat(100));
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

main();

