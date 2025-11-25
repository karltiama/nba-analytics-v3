import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  try {
    console.log('\n🔍 Testing Pistons Team ID Formats\n');
    console.log('='.repeat(100));
    
    // Check all possible Pistons team IDs
    const pistonsIds = await pool.query(`
      SELECT team_id, abbreviation, full_name
      FROM teams
      WHERE abbreviation = 'DET' OR full_name ILIKE '%pistons%'
    `);
    
    console.log('\n📋 All Pistons Team IDs:');
    pistonsIds.rows.forEach((row: any) => {
      console.log(`  ${row.abbreviation}: ${row.team_id} (${row.full_name})`);
    });
    
    // Test query with each possible ID
    const gameId = '1842025110112'; // Nov 1 DAL @ DET
    
    for (const pistons of pistonsIds.rows) {
      console.log(`\n🧪 Testing with team_id = ${pistons.team_id}:`);
      console.log('-'.repeat(100));
      
      const testQuery = await pool.query(`
        SELECT 
          btgs.game_id,
          (g.start_time AT TIME ZONE 'America/New_York')::date as game_date,
          TO_CHAR((g.start_time AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') as game_date_str,
          ht.abbreviation as home_team,
          at.abbreviation as away_team,
          btgs.is_home,
          btgs.points
        FROM bbref_team_game_stats btgs
        JOIN games g ON btgs.game_id = g.game_id
        JOIN teams ht ON g.home_team_id = ht.team_id
        JOIN teams at ON g.away_team_id = at.team_id
        WHERE btgs.team_id = $1
          AND btgs.game_id = $2
          AND btgs.source = 'bbref'
          AND EXISTS (
            SELECT 1 FROM bbref_schedule bs 
            WHERE bs.canonical_game_id = btgs.game_id
          )
      `, [pistons.team_id, gameId]);
      
      console.log(`  Result: ${testQuery.rows.length > 0 ? 'FOUND ✅' : 'NOT FOUND ❌'}`);
      if (testQuery.rows.length > 0) {
        testQuery.rows.forEach((row: any) => {
          console.log(`    Date: ${row.game_date_str}`);
          console.log(`    Matchup: ${row.away_team} @ ${row.home_team}`);
          console.log(`    Points: ${row.points}`);
        });
      }
    }
    
    // Check what team_id is actually in bbref_team_game_stats for this game
    console.log('\n📊 ACTUAL TEAM IDs IN BBREF_TEAM_GAME_STATS:');
    console.log('-'.repeat(100));
    const actualIds = await pool.query(`
      SELECT 
        btgs.team_id,
        t.abbreviation,
        t.full_name
      FROM bbref_team_game_stats btgs
      JOIN teams t ON btgs.team_id = t.team_id
      WHERE btgs.game_id = $1
    `, [gameId]);
    
    actualIds.rows.forEach((row: any) => {
      console.log(`  ${row.abbreviation}: ${row.team_id} (${row.full_name})`);
    });
    
    // Check all Pistons games to see what team_id format is used
    console.log('\n📋 ALL PISTONS GAMES IN BBREF_TEAM_GAME_STATS:');
    console.log('-'.repeat(100));
    const allPistonsGames = await pool.query(`
      SELECT DISTINCT
        btgs.team_id,
        COUNT(*) as game_count
      FROM bbref_team_game_stats btgs
      JOIN teams t ON btgs.team_id = t.team_id
      WHERE t.abbreviation = 'DET'
      GROUP BY btgs.team_id
    `);
    
    allPistonsGames.rows.forEach((row: any) => {
      console.log(`  Team ID ${row.team_id}: ${row.game_count} games`);
    });
    
    console.log('\n' + '='.repeat(100));
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

main();






