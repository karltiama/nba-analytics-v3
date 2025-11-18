import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  const client = await pool.connect();
  
  try {
    await client.query('begin');
    
    // Set scores to null for scheduled games that have 0-0 scores
    const result = await client.query(`
      update games
      set home_score = null,
          away_score = null,
          updated_at = now()
      where status != 'Final'
        and home_score = 0
        and away_score = 0
    `);
    
    await client.query('commit');
    
    console.log(`Fixed ${result.rowCount} games with inconsistent scores`);
  } catch (error) {
    await client.query('rollback');
    console.error('Error:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);

