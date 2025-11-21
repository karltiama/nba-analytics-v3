import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Check Unresolved Players
 * 
 * Checks which unresolved players exist in the database
 * 
 * Usage:
 *   tsx scripts/check-unresolved-players.ts
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

// List of unresolved players from the scraping
const unresolvedPlayers = [
  { name: 'Xavier Tillman Sr.', team: 'BOS' },
  { name: 'David Jones García', team: 'SAS' },
  { name: 'GG Jackson II', team: 'MEM' },
  { name: 'Nolan Traoré', team: 'BRK' },
  { name: 'Ron Holland', team: 'DET' },
  { name: 'Vit Krejci', team: 'ATL' },
  { name: 'Colby Jones', team: 'DET' },
  { name: 'Egor Demin', team: 'BRK' },
  { name: 'Pacome Dadiet', team: 'NYK' },
  { name: 'Alperen Şengün', team: 'HOU' },
  { name: 'James Wiseman', team: 'IND' },
  { name: 'Yanic Konan Niederhauser', team: 'LAC' },
  { name: 'Charles Bassey', team: 'MEM' },
  { name: 'Isaac Jones', team: 'SAC' },
  { name: 'Jaden Springer', team: 'NOP' },
  { name: 'Mac McClung', team: 'IND' },
];

async function checkPlayer(playerName: string, teamCode: string) {
  // Try various name variations
  const nameVariations = [
    playerName,
    playerName.replace(' Sr.', ''),
    playerName.replace(' Sr.', ' Sr'),
    playerName.replace(' II', ''),
    playerName.replace(' II', ' 2'),
    playerName.replace('Ş', 'S').replace('ş', 's'), // Handle special characters
    playerName.replace('é', 'e').replace('É', 'E'),
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

    // Last name match
    const lastName = variation.split(' ').pop();
    if (lastName && lastName.length > 2) {
      const lastNameMatch = await pool.query(`
        SELECT player_id, full_name
        FROM players
        WHERE LOWER(last_name) = LOWER($1)
        LIMIT 5
      `, [lastName]);

      if (lastNameMatch.rows.length > 0) {
        lastNameMatch.rows.forEach(row => {
          if (!results.find(r => r.player_id === row.player_id)) {
            results.push({ ...row, match_type: `Last name: "${lastName}"` });
          }
        });
      }
    }
  }

  return results;
}

async function main() {
  console.log('🔍 Checking unresolved players against database...\n');

  const found: Array<{ player: string; team: string; matches: Array<{ player_id: string; full_name: string; match_type: string }> }> = [];
  const notFound: Array<{ player: string; team: string }> = [];

  for (const { name, team } of unresolvedPlayers) {
    console.log(`Checking: ${name} (${team})...`);
    const matches = await checkPlayer(name, team);

    if (matches.length > 0) {
      found.push({ player: name, team, matches });
      console.log(`  ✅ Found ${matches.length} potential match(es):`);
      matches.forEach(m => {
        console.log(`     - ${m.full_name} (${m.player_id}) [${m.match_type}]`);
      });
    } else {
      notFound.push({ player: name, team });
      console.log(`  ❌ Not found`);
    }
    console.log('');
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Found in database: ${found.length}`);
  console.log(`❌ Not found: ${notFound.length}`);
  
  if (found.length > 0) {
    console.log('\n✅ Players found in database:');
    found.forEach(({ player, team, matches }) => {
      console.log(`\n   ${player} (${team}):`);
      matches.forEach(m => {
        console.log(`     → ${m.full_name} (${m.player_id})`);
      });
    });
  }

  if (notFound.length > 0) {
    console.log('\n❌ Players NOT found in database:');
    notFound.forEach(({ player, team }) => {
      console.log(`   - ${player} (${team})`);
    });
    console.log('\n💡 These players may need to be added to the players table first.');
  }

  await pool.end();
}

if (require.main === module || import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
}

