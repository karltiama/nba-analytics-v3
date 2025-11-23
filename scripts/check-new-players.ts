import 'dotenv/config';
import { Pool } from 'pg';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

const newPlayers = [
  'Monte Morris',
  'Kasparas Jakucionis',
  'Jahmai Mashack',
  'Jamaree Bouyea',
];

async function checkPlayer(playerName: string) {
  // Try various name variations
  const nameVariations = [
    playerName,
    playerName.split(' ')[0], // First name only
    playerName.split(' ').slice(-1)[0], // Last name only
  ];

  const results: Array<{ player_id: string; full_name: string; match_type: string }> = [];

  for (const variation of nameVariations) {
    // Exact match
    const exactMatch = await pool.query(`
      SELECT player_id, full_name
      FROM players
      WHERE LOWER(full_name) = LOWER($1)
      LIMIT 5
    `, [variation]);

    if (exactMatch.rows.length > 0) {
      exactMatch.rows.forEach(row => {
        if (!results.find(r => r.player_id === row.player_id)) {
          results.push({ ...row, match_type: `Exact: "${variation}"` });
        }
      });
    }

    // Partial match
    const partialMatch = await pool.query(`
      SELECT player_id, full_name
      FROM players
      WHERE LOWER(full_name) LIKE LOWER($1)
      LIMIT 5
    `, [`%${variation}%`]);

    if (partialMatch.rows.length > 0) {
      partialMatch.rows.forEach(row => {
        if (!results.find(r => r.player_id === row.player_id)) {
          results.push({ ...row, match_type: `Partial: "${variation}"` });
        }
      });
    }
  }

  return results;
}

async function main() {
  console.log('🔍 Checking new players...\n');
  
  for (const name of newPlayers) {
    console.log(`Checking: ${name}...`);
    const matches = await checkPlayer(name);

    if (matches.length > 0) {
      console.log(`  ✅ Found ${matches.length} potential match(es):`);
      matches.forEach(m => {
        console.log(`     - ${m.full_name} (${m.player_id}) [${m.match_type}]`);
      });
    } else {
      console.log(`  ❌ Not found`);
    }
    console.log('');
  }
  
  await pool.end();
}

main().catch(console.error);


