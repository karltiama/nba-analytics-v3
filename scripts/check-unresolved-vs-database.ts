import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Check Unresolved Players vs Database
 * 
 * Checks if unresolved players might exist in the database with different names
 * 
 * Usage:
 *   tsx scripts/check-unresolved-vs-database.ts
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

const TEAM_CODE_MAP: Record<string, string> = {
  'ATL': 'ATL', 'BOS': 'BOS', 'BKN': 'BRK', 'CHA': 'CHO', 'CHI': 'CHI',
  'CLE': 'CLE', 'DAL': 'DAL', 'DEN': 'DEN', 'DET': 'DET', 'GSW': 'GSW',
  'HOU': 'HOU', 'IND': 'IND', 'LAC': 'LAC', 'LAL': 'LAL', 'MEM': 'MEM',
  'MIA': 'MIA', 'MIL': 'MIL', 'MIN': 'MIN', 'NOP': 'NOP', 'NYK': 'NYK',
  'OKC': 'OKC', 'ORL': 'ORL', 'PHI': 'PHI', 'PHX': 'PHO', 'POR': 'POR',
  'SAC': 'SAC', 'SAS': 'SAS', 'TOR': 'TOR', 'UTA': 'UTA', 'WAS': 'WAS',
};

async function findSimilarPlayers(playerName: string, teamCode: string) {
  const nbaAbbr = Object.entries(TEAM_CODE_MAP).find(([_, code]) => code === teamCode)?.[0] || teamCode;
  
  const lastName = playerName.split(' ').pop() || '';
  const firstName = playerName.split(' ')[0] || '';
  
  // Search for players with similar last names on the same team
  const similar = await pool.query(`
    SELECT DISTINCT
      p.player_id,
      p.full_name,
      p.first_name,
      p.last_name,
      t.abbreviation as team,
      CASE 
        WHEN LOWER(p.last_name) = LOWER($5) THEN 1
        WHEN LOWER(p.first_name) = LOWER($6) THEN 2
        ELSE 3
      END as match_priority
    FROM players p
    JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
    JOIN teams t ON ptr.team_id = t.team_id
    WHERE (
      LOWER(p.last_name) LIKE LOWER($1)
      OR LOWER(p.first_name) LIKE LOWER($2)
      OR LOWER(p.full_name) LIKE LOWER($3)
    )
    AND t.abbreviation = $4
    ORDER BY match_priority, p.full_name
    LIMIT 20
  `, [
    `%${lastName}%`,
    `%${firstName}%`,
    `%${playerName}%`,
    nbaAbbr,
    lastName,
    firstName
  ]);
  
  return similar.rows;
}

async function main() {
  console.log('\n🔍 Checking if unresolved players exist in database...\n');
  
  const unresolved = await pool.query(`
    SELECT 
      player_name,
      team_code,
      COUNT(DISTINCT game_id) as game_count
    FROM scraped_boxscores
    WHERE player_id IS NULL
    GROUP BY player_name, team_code
    ORDER BY game_count DESC, player_name
  `);
  
  if (unresolved.rows.length === 0) {
    console.log('✅ No unresolved players found!');
    await pool.end();
    return;
  }
  
  console.log('='.repeat(100));
  console.log(`Checking ${unresolved.rows.length} unresolved players...\n`);
  
  let foundMatches = 0;
  let notFound = 0;
  
  for (const { player_name, team_code, game_count } of unresolved.rows) {
    const similar = await findSimilarPlayers(player_name, team_code);
    
    if (similar.length > 0) {
      foundMatches++;
      console.log(`\n✅ ${player_name} (${team_code}) - ${game_count} games`);
      console.log(`   Found ${similar.length} potential match(es) in database:`);
      similar.forEach((match, idx) => {
        console.log(`      ${idx + 1}. ${match.full_name.padEnd(35)} | ID: ${match.player_id} | Team: ${match.team}`);
      });
      console.log(`   💡 Use interactive resolver to match: tsx scripts/resolve-missing-player-ids.ts`);
    } else {
      notFound++;
      console.log(`\n❌ ${player_name} (${team_code}) - ${game_count} games`);
      console.log(`   ⚠️  Not found in database - needs to be added`);
      console.log(`   💡 Use: tsx scripts/add-unresolved-players.ts`);
    }
  }
  
  console.log(`\n${'='.repeat(100)}`);
  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Found in database (can match): ${foundMatches}`);
  console.log(`   ❌ Not in database (needs adding): ${notFound}`);
  console.log(`\n💡 Next steps:`);
  if (foundMatches > 0) {
    console.log(`   1. Run interactive resolver for existing players:`);
    console.log(`      tsx scripts/resolve-missing-player-ids.ts`);
  }
  if (notFound > 0) {
    console.log(`   2. Add missing players:`);
    console.log(`      tsx scripts/add-unresolved-players.ts`);
  }
  console.log();
  
  await pool.end();
}

main().catch(console.error);

