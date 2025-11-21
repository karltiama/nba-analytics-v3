import 'dotenv/config';
import { Pool } from 'pg';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

const playersToCheck = [
  'Colby Jones',
  'James Wiseman',
  'Charles Bassey',
  'Isaac Jones',
  'Jaden Springer',
  'Mac McClung',
  'Ronald Holland II',
  'David Jones Garcia',
];

async function main() {
  console.log('Checking player team rosters...\n');
  
  for (const playerName of playersToCheck) {
    const result = await pool.query(`
      SELECT p.player_id, p.full_name, t.abbreviation
      FROM players p
      JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
      JOIN teams t ON ptr.team_id = t.team_id
      WHERE LOWER(p.full_name) = LOWER($1)
      ORDER BY t.abbreviation
    `, [playerName]);
    
    if (result.rows.length > 0) {
      console.log(`${playerName}:`);
      result.rows.forEach(r => {
        console.log(`  → ${r.full_name} on ${r.abbreviation} (${r.player_id})`);
      });
    } else {
      console.log(`${playerName}: ❌ Not found in any roster`);
    }
    console.log('');
  }
  
  await pool.end();
}

main().catch(console.error);

