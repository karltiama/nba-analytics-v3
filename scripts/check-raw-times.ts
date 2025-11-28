import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function test() {
  // Get raw timestamp values from database
  const result = await pool.query(`
    SELECT 
      bbref_game_id,
      away_team_abbr,
      home_team_abbr,
      start_time,
      start_time AT TIME ZONE 'EST' as est_time,
      start_time AT TIME ZONE 'UTC' as utc_time,
      EXTRACT(EPOCH FROM start_time) as epoch_seconds
    FROM bbref_schedule 
    WHERE game_date >= '2025-10-21'::date 
      AND game_date <= '2025-10-22'::date 
      AND start_time IS NOT NULL 
    ORDER BY start_time 
    LIMIT 5
  `);
  
  console.log('Raw database values:');
  result.rows.forEach(r => {
    console.log(`\n${r.away_team_abbr} @ ${r.home_team_abbr}:`);
    console.log(`  Raw start_time: ${r.start_time}`);
    console.log(`  AT TIME ZONE EST: ${r.est_time}`);
    console.log(`  AT TIME ZONE UTC: ${r.utc_time}`);
    console.log(`  Epoch: ${r.epoch_seconds}`);
  });
  
  await pool.end();
}

test();



