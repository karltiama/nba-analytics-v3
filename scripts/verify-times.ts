import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function test() {
  // Get the actual stored timestamp values
  const result = await pool.query(`
    SELECT 
      away_team_abbr || ' @ ' || home_team_abbr as game,
      start_time,
      start_time::text as stored_as_text,
      (start_time AT TIME ZONE 'UTC')::text as utc_text,
      (start_time AT TIME ZONE 'EST')::text as est_text,
      EXTRACT(HOUR FROM start_time AT TIME ZONE 'EST') as est_hour,
      EXTRACT(MINUTE FROM start_time AT TIME ZONE 'EST') as est_minute
    FROM bbref_schedule 
    WHERE game_date >= '2025-10-21'::date 
      AND game_date <= '2025-10-22'::date 
      AND start_time IS NOT NULL 
    ORDER BY start_time 
    LIMIT 5
  `);
  
  console.log('Verifying stored times:');
  result.rows.forEach(r => {
    const hour = parseInt(r.est_hour);
    const minute = parseInt(r.est_minute);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
    console.log(`\n${r.game}:`);
    console.log(`  Stored as: ${r.stored_as_text}`);
    console.log(`  UTC: ${r.utc_text}`);
    console.log(`  EST: ${r.est_text}`);
    console.log(`  Display: ${displayHour}:${String(minute).padStart(2, '0')} ${ampm} EST`);
  });
  
  await pool.end();
}

test();

