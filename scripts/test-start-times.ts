import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function test() {
  const result = await pool.query(`
    SELECT 
      bbref_game_id, 
      game_date, 
      start_time, 
      home_team_abbr, 
      away_team_abbr 
    FROM bbref_schedule 
    WHERE game_date >= '2025-10-21'::date 
      AND game_date <= '2025-10-22'::date 
      AND start_time IS NOT NULL 
    ORDER BY start_time 
    LIMIT 10
  `);
  
  console.log('Sample games with start times:');
  result.rows.forEach(r => {
    const timeStr = new Date(r.start_time).toLocaleString('en-US', { 
      timeZone: 'America/New_York', 
      month: 'short', 
      day: 'numeric', 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true
    });
    console.log(`  ${r.away_team_abbr} @ ${r.home_team_abbr} - ${timeStr} ET`);
    console.log(`    Raw: ${r.start_time}`);
  });
  
  await pool.end();
}

test();






