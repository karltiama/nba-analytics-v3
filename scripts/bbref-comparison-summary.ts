import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

/**
 * Final summary comparing bbref_schedule to bbref_team_game_stats
 * Matching by canonical_game_id (the correct way)
 */
async function main() {
  try {
    console.log('\n📊 BBREF SCHEDULE vs BBREF TEAM GAME STATS - FINAL COMPARISON\n');
    console.log('='.repeat(100));
    
    // Count games in schedule
    const scheduleTotal = await pool.query(`
      SELECT COUNT(*) as total
      FROM bbref_schedule
      WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL
    `);
    
    // Count games in stats
    const statsTotal = await pool.query(`
      SELECT COUNT(DISTINCT game_id) as total
      FROM bbref_team_game_stats
    `);
    
    // Match by canonical_game_id
    const matched = await pool.query(`
      SELECT COUNT(DISTINCT bs.canonical_game_id) as matched
      FROM bbref_schedule bs
      INNER JOIN bbref_team_game_stats btgs ON bs.canonical_game_id = btgs.game_id
      WHERE bs.home_team_id IS NOT NULL AND bs.away_team_id IS NOT NULL
    `);
    
    // Games in schedule but not in stats
    const missingInStats = await pool.query(`
      SELECT COUNT(DISTINCT bs.canonical_game_id) as missing
      FROM bbref_schedule bs
      LEFT JOIN bbref_team_game_stats btgs ON bs.canonical_game_id = btgs.game_id
      WHERE bs.home_team_id IS NOT NULL 
        AND bs.away_team_id IS NOT NULL
        AND btgs.game_id IS NULL
    `);
    
    // Games in stats but not in schedule
    const extraInStats = await pool.query(`
      SELECT COUNT(DISTINCT btgs.game_id) as extra
      FROM bbref_team_game_stats btgs
      LEFT JOIN bbref_schedule bs ON btgs.game_id = bs.canonical_game_id
      WHERE bs.canonical_game_id IS NULL
    `);
    
    console.log('\n📈 SUMMARY STATISTICS:');
    console.log('-'.repeat(100));
    console.log(`BBRef Schedule Games:     ${scheduleTotal.rows[0].total}`);
    console.log(`BBRef Team Game Stats:    ${statsTotal.rows[0].total}`);
    console.log(`✅ Matched (by game_id):  ${matched.rows[0].matched}`);
    console.log(`❌ Missing in Stats:      ${missingInStats.rows[0].missing}`);
    console.log(`⚠️  Extra in Stats:        ${extraInStats.rows[0].extra}`);
    
    // Show sample of missing games
    if (parseInt(missingInStats.rows[0].missing) > 0) {
      const sampleMissing = await pool.query(`
        SELECT 
          bs.bbref_game_id,
          bs.game_date,
          bs.away_team_abbr,
          bs.home_team_abbr,
          bs.canonical_game_id
        FROM bbref_schedule bs
        LEFT JOIN bbref_team_game_stats btgs ON bs.canonical_game_id = btgs.game_id
        WHERE bs.home_team_id IS NOT NULL 
          AND bs.away_team_id IS NOT NULL
          AND btgs.game_id IS NULL
        ORDER BY bs.game_date DESC
        LIMIT 10
      `);
      
      console.log('\n📋 SAMPLE MISSING GAMES (first 10):');
      sampleMissing.rows.forEach((g: any, i: number) => {
        console.log(`  ${i + 1}. ${g.game_date.toISOString().split('T')[0]} - ${g.away_team_abbr} @ ${g.home_team_abbr}`);
        console.log(`     BBRef ID: ${g.bbref_game_id}`);
        console.log(`     Canonical ID: ${g.canonical_game_id || 'NOT SET'}`);
      });
    }
    
    // Show sample of extra games
    if (parseInt(extraInStats.rows[0].extra) > 0) {
      const sampleExtra = await pool.query(`
        SELECT 
          btgs.game_id,
          g.start_time::date as game_date,
          ht.abbreviation as home_team,
          at.abbreviation as away_team,
          g.status
        FROM bbref_team_game_stats btgs
        JOIN games g ON btgs.game_id = g.game_id
        JOIN teams ht ON g.home_team_id = ht.team_id
        JOIN teams at ON g.away_team_id = at.team_id
        LEFT JOIN bbref_schedule bs ON btgs.game_id = bs.canonical_game_id
        WHERE bs.canonical_game_id IS NULL
        ORDER BY g.start_time DESC
        LIMIT 10
      `);
      
      console.log('\n📋 SAMPLE EXTRA GAMES (first 10):');
      sampleExtra.rows.forEach((g: any, i: number) => {
        console.log(`  ${i + 1}. ${g.game_date.toISOString().split('T')[0]} - ${g.away_team} @ ${g.home_team}`);
        console.log(`     Game ID: ${g.game_id}`);
        console.log(`     Status: ${g.status}`);
      });
    }
    
    // Date range analysis
    const scheduleDateRange = await pool.query(`
      SELECT 
        MIN(game_date) as earliest,
        MAX(game_date) as latest
      FROM bbref_schedule
      WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL
    `);
    
    const statsDateRange = await pool.query(`
      SELECT 
        MIN(g.start_time::date) as earliest,
        MAX(g.start_time::date) as latest
      FROM bbref_team_game_stats btgs
      JOIN games g ON btgs.game_id = g.game_id
    `);
    
    console.log('\n📅 DATE RANGES:');
    console.log('-'.repeat(100));
    console.log(`Schedule: ${scheduleDateRange.rows[0].earliest?.toISOString().split('T')[0]} to ${scheduleDateRange.rows[0].latest?.toISOString().split('T')[0]}`);
    console.log(`Stats:    ${statsDateRange.rows[0].earliest?.toISOString().split('T')[0]} to ${statsDateRange.rows[0].latest?.toISOString().split('T')[0]}`);
    
    console.log('\n' + '='.repeat(100));
    console.log('✅ COMPARISON COMPLETE');
    console.log('='.repeat(100));
    console.log('\n💡 Key Findings:');
    console.log('   - Matching by canonical_game_id (game_id) is the correct approach');
    console.log('   - Date + team matching can fail due to timezone differences');
    console.log('   - Missing games in stats need to be scraped and populated');
    console.log('   - Extra games in stats may be from other sources or need schedule updates');
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

main();

