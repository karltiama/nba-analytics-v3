import 'dotenv/config';
import { Pool } from 'pg';
import * as readline from 'readline';

/**
 * Resolve Missing Player IDs
 * 
 * Interactive script to resolve player IDs for players in scraped_boxscores
 * that don't have a player_id set.
 * 
 * Usage:
 *   tsx scripts/resolve-missing-player-ids.ts
 *   tsx scripts/resolve-missing-player-ids.ts --auto  # Auto-resolve using improved fuzzy matching
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

function normalizePlayerName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\./g, '')
    .replace(/'/g, '')
    // Remove common suffixes
    .replace(/\s+Sr\.?$/i, '')
    .replace(/\s+Jr\.?$/i, '')
    .replace(/\s+II$/i, '')
    .replace(/\s+III$/i, '')
    .replace(/\s+IV$/i, '')
    // Normalize special characters (comprehensive)
    .replace(/[áàâä]/g, 'a')
    .replace(/[éèêë]/g, 'e')
    .replace(/[íìîï]/g, 'i')
    .replace(/[óòôö]/g, 'o')
    .replace(/[úùûü]/g, 'u')
    .replace(/[ç]/g, 'c')
    .replace(/[ñ]/g, 'n')
    .replace(/[Şş]/g, 's')
    .replace(/[Éé]/g, 'e')
    .replace(/[Öö]/g, 'o')
    .replace(/[Üü]/g, 'u')
    .replace(/[Çç]/g, 'c')
    .replace(/[Ğğ]/g, 'g')
    .replace(/[İı]/g, 'i')
    .toLowerCase();
}

async function resolvePlayerId(playerName: string, teamCode: string): Promise<string | null> {
  const nbaAbbr = Object.entries(TEAM_CODE_MAP).find(([_, code]) => code === teamCode)?.[0] || teamCode;
  const normalizedName = normalizePlayerName(playerName);
  const nameParts = playerName.trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts[nameParts.length - 1] || '';
  
  // Strategy 1: Exact match
  const exactMatch = await pool.query(`
    SELECT p.player_id, p.full_name
    FROM players p
    JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
    JOIN teams t ON ptr.team_id = t.team_id
    WHERE LOWER(p.full_name) = LOWER($1)
      AND t.abbreviation = $2
    LIMIT 1
  `, [playerName, nbaAbbr]);
  
  if (exactMatch.rows.length > 0) {
    return exactMatch.rows[0].player_id;
  }
  
  // Strategy 2: Remove suffixes and match
  const nameWithoutSuffix = playerName
    .replace(/\s+Sr\.?$/i, '')
    .replace(/\s+Jr\.?$/i, '')
    .replace(/\s+II$/i, '')
    .replace(/\s+III$/i, '')
    .replace(/\s+IV$/i, '')
    .trim();
  
  if (nameWithoutSuffix !== playerName) {
    const suffixMatch = await pool.query(`
      SELECT p.player_id, p.full_name
      FROM players p
      JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
      JOIN teams t ON ptr.team_id = t.team_id
      WHERE LOWER(p.full_name) = LOWER($1)
        AND t.abbreviation = $2
      LIMIT 1
    `, [nameWithoutSuffix, nbaAbbr]);
    
    if (suffixMatch.rows.length > 0) {
      return suffixMatch.rows[0].player_id;
    }
  }
  
  // Strategy 3: Normalized exact match (handles special characters)
  // Use a simpler approach: match without special characters
  const normalizedMatch = await pool.query(`
    SELECT p.player_id, p.full_name
    FROM players p
    JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
    JOIN teams t ON ptr.team_id = t.team_id
    WHERE LOWER(REPLACE(REPLACE(p.full_name, '.', ''), '''', '')) = $1
      AND t.abbreviation = $2
    LIMIT 1
  `, [normalizedName, nbaAbbr]);
  
  if (normalizedMatch.rows.length > 0) {
    return normalizedMatch.rows[0].player_id;
  }
  
  // Strategy 4: First + Last name
  if (firstName && lastName && nameParts.length >= 2) {
    const firstLastMatch = await pool.query(`
      SELECT p.player_id, p.full_name
      FROM players p
      JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
      JOIN teams t ON ptr.team_id = t.team_id
      WHERE LOWER(p.first_name) = LOWER($1)
        AND LOWER(p.last_name) = LOWER($2)
        AND t.abbreviation = $3
      LIMIT 1
    `, [firstName, lastName, nbaAbbr]);
    
    if (firstLastMatch.rows.length > 0) {
      return firstLastMatch.rows[0].player_id;
    }
  }
  
  // Strategy 5: Last name only (but prefer exact first+last match)
  if (lastName) {
    const lastNameMatch = await pool.query(`
      SELECT p.player_id, p.full_name
      FROM players p
      JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
      JOIN teams t ON ptr.team_id = t.team_id
      WHERE LOWER(p.last_name) = LOWER($1)
        AND t.abbreviation = $2
      LIMIT 1
    `, [lastName, nbaAbbr]);
    
    if (lastNameMatch.rows.length > 0) {
      return lastNameMatch.rows[0].player_id;
    }
  }
  
  // Strategy 6: Partial match (contains)
  const partialMatch = await pool.query(`
    SELECT p.player_id, p.full_name
    FROM players p
    JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
    JOIN teams t ON ptr.team_id = t.team_id
    WHERE LOWER(p.full_name) LIKE LOWER($1)
      AND t.abbreviation = $2
    LIMIT 1
  `, [`%${playerName}%`, nbaAbbr]);
  
  if (partialMatch.rows.length > 0) {
    return partialMatch.rows[0].player_id;
  }
  
  // Strategy 7: Try without team filter (player might not be in roster yet)
  // First try exact match without team
  const noTeamExact = await pool.query(`
    SELECT p.player_id, p.full_name
    FROM players p
    WHERE LOWER(p.full_name) = LOWER($1)
    LIMIT 1
  `, [playerName]);
  
  if (noTeamExact.rows.length > 0) {
    return noTeamExact.rows[0].player_id;
  }
  
  // Try normalized version (handles special characters)
  // Use a simpler approach: try matching first and last name separately with normalization
  const normalizedFirstName = normalizePlayerName(firstName);
  const normalizedLastName = normalizePlayerName(lastName);
  
  if (firstName && lastName && nameParts.length >= 2) {
    // Try matching with normalized first and last names
    const normalizedFirstLast = await pool.query(`
      SELECT p.player_id, p.full_name
      FROM players p
      WHERE LOWER(p.first_name) LIKE LOWER($1)
        AND LOWER(p.last_name) LIKE LOWER($2)
      LIMIT 5
    `, [`%${normalizedFirstName}%`, `%${normalizedLastName}%`]);
    
    if (normalizedFirstLast.rows.length > 0) {
      // Prefer exact match if available
      const exact = normalizedFirstLast.rows.find(r => 
        normalizePlayerName(r.full_name) === normalizePlayerName(playerName)
      );
      if (exact) {
        return exact.player_id;
      }
      // Otherwise return first match
      return normalizedFirstLast.rows[0].player_id;
    }
  }
  
  // Try without suffix
  if (nameWithoutSuffix !== playerName) {
    const noTeamSuffix = await pool.query(`
      SELECT p.player_id, p.full_name
      FROM players p
      WHERE LOWER(p.full_name) = LOWER($1)
      LIMIT 1
    `, [nameWithoutSuffix]);
    
    if (noTeamSuffix.rows.length > 0) {
      return noTeamSuffix.rows[0].player_id;
    }
  }
  
  // Try "Ronald" vs "Ron" variation (and remove suffix from DB name)
  if (firstName === 'Ron' && lastName) {
    const ronaldMatch = await pool.query(`
      SELECT p.player_id, p.full_name
      FROM players p
      WHERE (LOWER(p.first_name) = 'ronald' OR LOWER(p.first_name) LIKE 'ronald%')
        AND LOWER(p.last_name) = LOWER($1)
      LIMIT 1
    `, [lastName]);
    
    if (ronaldMatch.rows.length > 0) {
      return ronaldMatch.rows[0].player_id;
    }
  }
  
  // Try first + last name without team
  if (firstName && lastName && nameParts.length >= 2) {
    const noTeamFirstLast = await pool.query(`
      SELECT p.player_id, p.full_name
      FROM players p
      WHERE LOWER(p.first_name) = LOWER($1)
        AND LOWER(p.last_name) = LOWER($2)
      LIMIT 1
    `, [firstName, lastName]);
    
    if (noTeamFirstLast.rows.length > 0) {
      return noTeamFirstLast.rows[0].player_id;
    }
  }
  
  return null;
}

async function getUnresolvedPlayers(): Promise<Array<{ player_name: string; team_code: string; game_count: number }>> {
  const result = await pool.query(`
    SELECT 
      player_name,
      team_code,
      COUNT(DISTINCT game_id) as game_count
    FROM scraped_boxscores
    WHERE player_id IS NULL
    GROUP BY player_name, team_code
    ORDER BY game_count DESC, player_name
  `);
  
  return result.rows;
}

async function updatePlayerIds(playerName: string, teamCode: string, playerId: string): Promise<number> {
  const result = await pool.query(`
    UPDATE scraped_boxscores
    SET player_id = $1, updated_at = NOW()
    WHERE player_name = $2
      AND team_code = $3
      AND player_id IS NULL
    RETURNING id
  `, [playerId, playerName, teamCode]);
  
  return result.rowCount || 0;
}

async function getCandidatePlayers(playerName: string, teamCode: string): Promise<Array<{ player_id: string; full_name: string }>> {
  const nbaAbbr = Object.entries(TEAM_CODE_MAP).find(([_, code]) => code === teamCode)?.[0] || teamCode;
  
  // Get all players from this team (for manual selection)
  const result = await pool.query(`
    SELECT DISTINCT p.player_id, p.full_name
    FROM players p
    JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
    JOIN teams t ON ptr.team_id = t.team_id
    WHERE t.abbreviation = $1
    ORDER BY p.full_name
  `, [nbaAbbr]);
  
  return result.rows;
}

async function main() {
  const args = process.argv.slice(2);
  const autoMode = args.includes('--auto');
  
  console.log('🔍 Finding unresolved players...\n');
  
  const unresolved = await getUnresolvedPlayers();
  
  if (unresolved.length === 0) {
    console.log('✅ No unresolved players found!');
    await pool.end();
    return;
  }
  
  console.log(`Found ${unresolved.length} unresolved player(s):\n`);
  
  let resolved = 0;
  let skipped = 0;
  
  if (autoMode) {
    console.log('🤖 Auto-resolving using improved fuzzy matching...\n');
    
    for (const { player_name, team_code, game_count } of unresolved) {
      const playerId = await resolvePlayerId(player_name, team_code);
      
      if (playerId) {
        const updated = await updatePlayerIds(player_name, team_code, playerId);
        console.log(`✅ Resolved: ${player_name} (${team_code}) → ${updated} records updated`);
        resolved++;
      } else {
        console.log(`⚠️  Could not resolve: ${player_name} (${team_code}) - ${game_count} games`);
        skipped++;
      }
    }
    
    console.log(`\n📊 Summary: ${resolved} resolved, ${skipped} still unresolved`);
  } else {
    // Interactive mode
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    const question = (query: string): Promise<string> => {
      return new Promise((resolve) => rl.question(query, resolve));
    };
    
    for (const { player_name, team_code, game_count } of unresolved) {
      console.log(`\n📋 Player: ${player_name} (${team_code})`);
      console.log(`   Games: ${game_count}`);
      
      // Try auto-resolve first
      const playerId = await resolvePlayerId(player_name, team_code);
      
      if (playerId) {
        const answer = await question(`   ✅ Found match. Update? (y/n/skip): `);
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
          const updated = await updatePlayerIds(player_name, team_code, playerId);
          console.log(`   ✅ Updated ${updated} records`);
          resolved++;
        } else if (answer.toLowerCase() === 'skip') {
          skipped++;
          continue;
        }
      } else {
        // Show candidates
        const candidates = await getCandidatePlayers(player_name, team_code);
        console.log(`   ⚠️  No auto-match found. Candidates from ${team_code}:`);
        candidates.slice(0, 10).forEach((c, idx) => {
          console.log(`      ${idx + 1}. ${c.full_name} (${c.player_id})`);
        });
        
        const answer = await question(`   Enter player_id to assign (or 'skip'): `);
        if (answer.toLowerCase() === 'skip') {
          skipped++;
          continue;
        }
        
        if (answer.trim()) {
          const updated = await updatePlayerIds(player_name, team_code, answer.trim());
          if (updated > 0) {
            console.log(`   ✅ Updated ${updated} records`);
            resolved++;
          } else {
            console.log(`   ⚠️  No records updated (player_id might not exist)`);
          }
        }
      }
    }
    
    rl.close();
  }
  
  await pool.end();
}

if (require.main === module || import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

