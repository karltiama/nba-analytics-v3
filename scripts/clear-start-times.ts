import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  console.log('Clearing start_time values from bbref_schedule...');
  const result = await pool.query(`
    UPDATE bbref_schedule 
    SET start_time = NULL 
    WHERE start_time IS NOT NULL
  `);
  console.log(`Cleared ${result.rowCount} start_time values`);
  await pool.end();
}

main();









