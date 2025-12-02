import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Find Player Matches
 * 
 * Checks if unresolved players exist in the database with similar names
 * 
 * Usage:
 *   tsx scripts/find-player-matches.ts
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

async function findMatches(playerName: string, teamCode: string) {
  const nbaAbbr = Object.entries(TEAM_CODE_MAP).find(([_, code]) => code === teamCode)?.[0] || teamCode;
  
  // Try various matching strategies
  const lastName = playerName.split(' ').pop() || '';
  const firstName = playerName.split(' ')[0] || '';
  
  // Strategy 1: Last name match (any team)
  const lastNameMatch = await pool.query(`
    SELECT p.player_id, p.full_name, p.first_name, p.last_name, t.abbreviation as team
    FROM players p
    LEFT JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
    LEFT JOIN teams t ON ptr.team_id = t.team_id
    WHERE LOWER(p.last_name) = LOWER($1)
    ORDER BY t.abbreviation = $2 DESC, p.full_name
    LIMIT 10
  `, [lastName, nbaAbbr]);
  
  // Strategy 2: First + Last name match (any team)
  const firstLastMatch = await pool.query(`
    SELECT p.player_id, p.full_name, p.first_name, p.last_name, t.abbreviation as team
    FROM players p
    LEFT JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
    LEFT JOIN teams t ON ptr.team_id = t.team_id
    WHERE LOWER(p.first_name) = LOWER($1)
      AND LOWER(p.last_name) = LOWER($2)
    ORDER BY t.abbreviation = $3 DESC, p.full_name
    LIMIT 10
  `, [firstName, lastName, nbaAbbr]);
  
  // Strategy 3: Partial name match
  const partialMatch = await pool.query(`
    SELECT p.player_id, p.full_name, p.first_name, p.last_name, t.abbreviation as team
    FROM players p
    LEFT JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
    LEFT JOIN teams t ON ptr.team_id = t.team_id
    WHERE LOWER(p.full_name) LIKE LOWER($1)
    ORDER BY t.abbreviation = $2 DESC, p.full_name
    LIMIT 10
  `, [`%${playerName}%`, nbaAbbr]);
  
  return {
    lastName: lastNameMatch.rows,
    firstLast: firstLastMatch.rows,
    partial: partialMatch.rows,
  };
}

async function main() {
  console.log('\n🔍 Finding potential matches for unresolved players...\n');
  
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
  
  for (const { player_name, team_code, game_count } of unresolved.rows) {
    console.log(`\n${'='.repeat(100)}`);
    console.log(`📋 ${player_name} (${team_code}) - ${game_count} games`);
    console.log('='.repeat(100));
    
    const matches = await findMatches(player_name, team_code);
    
    // Combine and deduplicate matches
    const allMatches = new Map<string, any>();
    
    [...matches.lastName, ...matches.firstLast, ...matches.partial].forEach(m => {
      if (!allMatches.has(m.player_id)) {
        allMatches.set(m.player_id, m);
      }
    });
    
    const uniqueMatches = Array.from(allMatches.values());
    
    if (uniqueMatches.length === 0) {
      console.log('   ⚠️  No matches found in database');
      console.log('   💡 This player may need to be added to the players table');
    } else {
      console.log(`\n   Found ${uniqueMatches.length} potential match(es):\n`);
      uniqueMatches.slice(0, 10).forEach((match, idx) => {
        const teamInfo = match.team ? ` (Team: ${match.team})` : ' (No team)';
        const matchType = matches.firstLast.find(m => m.player_id === match.player_id) ? '✅ Exact' :
                         matches.lastName.find(m => m.player_id === match.player_id) ? '⚠️  Last name' :
                         '⚠️  Partial';
        console.log(`   ${String(idx + 1).padStart(2)}. ${matchType} | ${match.full_name.padEnd(35)} | ID: ${match.player_id}${teamInfo}`);
      });
      
      if (uniqueMatches.length > 10) {
        console.log(`   ... and ${uniqueMatches.length - 10} more matches`);
      }
    }
  }
  
  console.log(`\n${'='.repeat(100)}`);
  console.log('\n💡 To resolve these players, run:');
  console.log('   tsx scripts/resolve-missing-player-ids.ts (interactive mode)');
  console.log('   or use the player IDs shown above\n');
  
  await pool.end();
}

main().catch(console.error);





