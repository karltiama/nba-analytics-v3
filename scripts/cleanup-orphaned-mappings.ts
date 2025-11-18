import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  const result = await pool.query(`
    delete from provider_id_map 
    where entity_type = 'game' 
      and internal_id not in (select game_id from games)
  `);
  
  console.log(`Deleted ${result.rowCount} orphaned provider mappings`);
  await pool.end();
}

main().catch(console.error);

