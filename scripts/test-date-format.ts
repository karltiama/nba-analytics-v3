import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  try {
    console.log('\n🔍 Testing Date Format Fix\n');
    console.log('='.repeat(100));
    
    // Test the query with the new date format
    const result = await pool.query(`
      SELECT 
        btgs.game_id,
        (g.start_time AT TIME ZONE 'America/New_York')::date as game_date,
        TO_CHAR((g.start_time AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') as game_date_str,
        g.start_time,
        ht.abbreviation as home_team,
        at.abbreviation as away_team
      FROM bbref_team_game_stats btgs
      JOIN games g ON btgs.game_id = g.game_id
      JOIN teams ht ON g.home_team_id = ht.team_id
      JOIN teams at ON g.away_team_id = at.team_id
      WHERE btgs.team_id = '1610612765'
        AND btgs.source = 'bbref'
      ORDER BY g.start_time DESC
      LIMIT 5
    `);
    
    console.log('\n📅 Sample Dates (Detroit Pistons):');
    result.rows.forEach((row: any, i: number) => {
      const dateFromStr = row.game_date_str 
        ? new Date(row.game_date_str + 'T12:00:00').toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })
        : 'N/A';
      
      const dateFromDate = new Date(row.game_date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      
      console.log(`\n${i + 1}. ${row.away_team} @ ${row.home_team}`);
      console.log(`   start_time: ${row.start_time}`);
      console.log(`   game_date (date): ${row.game_date}`);
      console.log(`   game_date_str: ${row.game_date_str}`);
      console.log(`   Formatted from str: ${dateFromStr}`);
      console.log(`   Formatted from date: ${dateFromDate}`);
    });
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

main();

