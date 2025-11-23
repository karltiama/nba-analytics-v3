import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  try {
    console.log('\n🔍 Checking Date/Timezone Issues\n');
    console.log('='.repeat(100));
    
    // Check a sample game's dates
    const sample = await pool.query(`
      SELECT 
        g.game_id,
        g.start_time,
        g.start_time::date as date_cast,
        g.start_time AT TIME ZONE 'America/New_York' as et_time,
        (g.start_time AT TIME ZONE 'America/New_York')::date as et_date,
        bs.game_date as bbref_schedule_date,
        bs.bbref_game_id
      FROM games g
      JOIN bbref_schedule bs ON g.game_id = bs.canonical_game_id
      WHERE bs.canonical_game_id IS NOT NULL
      ORDER BY g.start_time DESC
      LIMIT 5
    `);
    
    console.log('\n📅 Sample Game Dates:');
    sample.rows.forEach((row: any, i: number) => {
      console.log(`\n${i + 1}. Game ID: ${row.game_id}`);
      console.log(`   start_time (DB): ${row.start_time}`);
      console.log(`   start_time::date: ${row.date_cast}`);
      console.log(`   ET time: ${row.et_time}`);
      console.log(`   ET date: ${row.et_date}`);
      console.log(`   BBRef schedule date: ${row.game_date}`);
      console.log(`   BBRef game ID: ${row.bbref_game_id}`);
    });
    
    // Check for date mismatches
    const mismatches = await pool.query(`
      SELECT 
        COUNT(*) as count
      FROM games g
      JOIN bbref_schedule bs ON g.game_id = bs.canonical_game_id
      WHERE (g.start_time AT TIME ZONE 'America/New_York')::date != bs.game_date
    `);
    
    console.log(`\n❌ Date mismatches: ${mismatches.rows[0].count}`);
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

main();

