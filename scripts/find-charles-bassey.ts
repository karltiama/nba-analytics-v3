import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function findCharlesBassey() {
  console.log('\n🔍 Finding Charles Bassey Player ID\n');
  
  // Search for Charles Bassey
  const results = await pool.query(`
    SELECT player_id, full_name, first_name, last_name
    FROM players
    WHERE LOWER(full_name) LIKE '%charles%'
      AND LOWER(full_name) LIKE '%bassey%'
  `);
  
  if (results.rows.length > 0) {
    console.log('✅ Found Charles Bassey:');
    results.rows.forEach((row: any) => {
      console.log(`   ${row.full_name} (${row.player_id})`);
    });
  } else {
    console.log('❌ Charles Bassey not found. Searching for "Bassey"...');
    
    const basseyResults = await pool.query(`
      SELECT player_id, full_name, first_name, last_name
      FROM players
      WHERE LOWER(last_name) = 'bassey'
    `);
    
    if (basseyResults.rows.length > 0) {
      console.log('✅ Found players with last name "Bassey":');
      basseyResults.rows.forEach((row: any) => {
        console.log(`   ${row.full_name} (${row.player_id})`);
      });
    } else {
      console.log('❌ No players found with last name "Bassey"');
    }
  }
  
  await pool.end();
}

findCharlesBassey();

