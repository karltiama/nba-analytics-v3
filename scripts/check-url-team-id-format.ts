import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  try {
    console.log('\n🔍 Checking URL Team ID Format\n');
    console.log('='.repeat(100));
    
    // Check if there are multiple team_id formats for Pistons
    const allTeamIds = await pool.query(`
      SELECT team_id, abbreviation, full_name
      FROM teams
      WHERE abbreviation = 'DET'
      ORDER BY team_id
    `);
    
    console.log('\n📋 Pistons Team IDs in database:');
    allTeamIds.rows.forEach((row: any) => {
      console.log(`  ${row.team_id}: ${row.abbreviation} (${row.full_name})`);
    });
    
    // Check what team_id format getTeamInfo accepts
    console.log('\n🧪 Testing getTeamInfo with different IDs:');
    console.log('-'.repeat(100));
    
    const testIds = ['9', '1610612765'];
    
    for (const testId of testIds) {
      const result = await pool.query(`
        SELECT team_id, abbreviation, full_name
        FROM teams
        WHERE team_id = $1
      `, [testId]);
      
      console.log(`\n  Testing ID: ${testId}`);
      if (result.rows.length > 0) {
        console.log(`    ✅ Found: ${result.rows[0].abbreviation} (${result.rows[0].full_name})`);
      } else {
        console.log(`    ❌ Not found`);
      }
    }
    
    // Now test the BBRef query with both formats
    console.log('\n🧪 Testing BBRef Query with different team IDs:');
    console.log('-'.repeat(100));
    
    for (const testId of testIds) {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM bbref_team_game_stats btgs
        WHERE btgs.team_id = $1
          AND btgs.source = 'bbref'
      `, [testId]);
      
      console.log(`\n  Team ID ${testId}:`);
      console.log(`    Games found: ${result.rows[0].count}`);
      
      // Check specifically for Nov 1 game
      const nov1Check = await pool.query(`
        SELECT 
          btgs.game_id,
          TO_CHAR((g.start_time AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') as game_date_str,
          ht.abbreviation as home_team,
          at.abbreviation as away_team
        FROM bbref_team_game_stats btgs
        JOIN games g ON btgs.game_id = g.game_id
        JOIN teams ht ON g.home_team_id = ht.team_id
        JOIN teams at ON g.away_team_id = at.team_id
        WHERE btgs.team_id = $1
          AND btgs.game_id = '1842025110112'
          AND btgs.source = 'bbref'
          AND EXISTS (
            SELECT 1 FROM bbref_schedule bs 
            WHERE bs.canonical_game_id = btgs.game_id
          )
      `, [testId]);
      
      console.log(`    Nov 1 game: ${nov1Check.rows.length > 0 ? 'FOUND ✅' : 'NOT FOUND ❌'}`);
      if (nov1Check.rows.length > 0) {
        nov1Check.rows.forEach((row: any) => {
          console.log(`      ${row.game_date_str}: ${row.away_team} @ ${row.home_team}`);
        });
      }
    }
    
    console.log('\n' + '='.repeat(100));
    console.log('\n💡 SOLUTION:');
    console.log('   If URL uses team_id = 1610612765 but data uses team_id = 9,');
    console.log('   we need to either:');
    console.log('   1. Map the URL team_id to the database team_id, OR');
    console.log('   2. Ensure both use the same format');
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

main();







