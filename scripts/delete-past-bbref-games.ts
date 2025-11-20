import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function deletePastGames() {
  const today = new Date('2025-11-20');
  today.setHours(0, 0, 0, 0);
  
  console.log(`Deleting bbref games without box scores that are before ${today.toISOString().split('T')[0]}...\n`);
  
  const result = await pool.query(`
    DELETE FROM games 
    WHERE game_id LIKE 'bbref_%' 
      AND NOT EXISTS(SELECT 1 FROM player_game_stats pgs WHERE pgs.game_id = games.game_id)
      AND DATE(start_time AT TIME ZONE 'America/New_York') < $1::date
    RETURNING game_id, DATE(start_time AT TIME ZONE 'America/New_York') as game_date
  `, [today]);
  
  console.log(`Deleted ${result.rowCount} games:\n`);
  result.rows.forEach((r, idx) => {
    console.log(`  ${idx + 1}. ${r.game_id} (${r.game_date})`);
  });
  
  await pool.end();
}

deletePastGames().catch(console.error);

