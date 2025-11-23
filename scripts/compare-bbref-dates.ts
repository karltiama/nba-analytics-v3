import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  try {
    console.log('\n🔍 Comparing BBRef Schedule Dates vs Display Dates\n');
    console.log('='.repeat(100));
    
    // Get games and compare dates
    const result = await pool.query(`
      SELECT 
        btgs.game_id,
        bs.game_date as bbref_schedule_date,
        (g.start_time AT TIME ZONE 'America/New_York')::date as et_date,
        TO_CHAR((g.start_time AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') as et_date_str,
        g.start_time,
        ht.abbreviation as home_team,
        at.abbreviation as away_team
      FROM bbref_team_game_stats btgs
      JOIN games g ON btgs.game_id = g.game_id
      JOIN teams ht ON g.home_team_id = ht.team_id
      JOIN teams at ON g.away_team_id = at.team_id
      JOIN bbref_schedule bs ON btgs.game_id = bs.canonical_game_id
      WHERE btgs.source = 'bbref'
      ORDER BY g.start_time DESC
      LIMIT 10
    `);
    
    console.log('\n📅 Date Comparison:');
    result.rows.forEach((row: any, i: number) => {
      const scheduleDate = row.bbref_schedule_date 
        ? new Date(row.bbref_schedule_date).toISOString().split('T')[0]
        : 'N/A';
      
      const displayDate = row.et_date_str;
      
      const match = scheduleDate === displayDate;
      const matchIcon = match ? '✅' : '❌';
      
      console.log(`\n${i + 1}. ${row.away_team} @ ${row.home_team}`);
      console.log(`   ${matchIcon} BBRef Schedule: ${scheduleDate}`);
      console.log(`   ${matchIcon} Display Date: ${displayDate}`);
      console.log(`   Start Time: ${row.start_time}`);
      
      if (!match) {
        console.log(`   ⚠️  MISMATCH!`);
      }
    });
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

main();

