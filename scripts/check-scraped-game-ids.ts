import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function check() {
  const result = await pool.query(`
    SELECT DISTINCT game_id 
    FROM scraped_boxscores 
    WHERE source = 'bbref_csv' 
    ORDER BY game_id 
    LIMIT 20
  `);
  
  console.log('Sample game_ids in scraped_boxscores:');
  result.rows.forEach((r: any) => console.log(r.game_id));
  
  const bbrefResult = await pool.query(`
    SELECT DISTINCT bbref_game_id 
    FROM bbref_games 
    ORDER BY bbref_game_id 
    LIMIT 20
  `);
  
  console.log('\nSample bbref_game_ids in bbref_games:');
  bbrefResult.rows.forEach((r: any) => console.log(r.bbref_game_id));
  
  await pool.end();
}

check();


