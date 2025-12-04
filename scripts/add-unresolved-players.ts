import 'dotenv/config';
import { Pool } from 'pg';
import * as readline from 'readline';

/**
 * Add Unresolved Players
 * 
 * Interactive script to add unresolved players to the players table
 * so they can be matched later
 * 
 * Usage:
 *   tsx scripts/add-unresolved-players.ts
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

async function getUnresolvedPlayers() {
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

async function addPlayer(playerName: string, teamCode: string, playerId?: string) {
  const nameParts = playerName.trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts[nameParts.length - 1] || '';
  
  // Generate player_id if not provided (use last name + first initial + team)
  const generatedId = playerId || `${lastName.toLowerCase().replace(/[^a-z]/g, '')}_${firstName.charAt(0).toLowerCase()}_${teamCode.toLowerCase()}`;
  
  await pool.query(`
    INSERT INTO players (
      player_id, full_name, first_name, last_name, active, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, true, now(), now())
    ON CONFLICT (player_id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      updated_at = now()
  `, [generatedId, playerName, firstName, lastName]);
  
  return generatedId;
}

async function addToRoster(playerId: string, teamCode: string) {
  const nbaAbbr = Object.entries(TEAM_CODE_MAP).find(([_, code]) => code === teamCode)?.[0] || teamCode;
  
  // Get team_id
  const teamResult = await pool.query(`
    SELECT team_id FROM teams WHERE abbreviation = $1
  `, [nbaAbbr]);
  
  if (teamResult.rows.length === 0) {
    throw new Error(`Team ${nbaAbbr} not found`);
  }
  
  const teamId = teamResult.rows[0].team_id;
  const currentSeason = '2025-26'; // Adjust as needed
  
  await pool.query(`
    INSERT INTO player_team_rosters (
      player_id, team_id, season, active, created_at, updated_at
    ) VALUES ($1, $2, $3, true, now(), now())
    ON CONFLICT (player_id, season) DO UPDATE SET
      team_id = EXCLUDED.team_id,
      active = EXCLUDED.active,
      updated_at = now()
  `, [playerId, teamId, currentSeason]);
}

async function updateScrapedBoxscores(playerName: string, teamCode: string, playerId: string) {
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

async function main() {
  console.log('\n🔍 Finding unresolved players...\n');
  
  const unresolved = await getUnresolvedPlayers();
  
  if (unresolved.length === 0) {
    console.log('✅ No unresolved players found!');
    await pool.end();
    return;
  }
  
  console.log(`Found ${unresolved.length} unresolved player(s):\n`);
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  const question = (query: string): Promise<string> => {
    return new Promise((resolve) => rl.question(query, resolve));
  };
  
  let added = 0;
  let skipped = 0;
  
  for (const { player_name, team_code, game_count } of unresolved) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📋 Player: ${player_name} (${team_code})`);
    console.log(`   Games: ${game_count}`);
    
    const nameParts = player_name.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts[nameParts.length - 1] || '';
    const suggestedId = `${lastName.toLowerCase().replace(/[^a-z]/g, '')}_${firstName.charAt(0).toLowerCase()}_${team_code.toLowerCase()}`;
    
    console.log(`   Suggested ID: ${suggestedId}`);
    
    const answer = await question(`\n   Add this player? (y/n/skip): `);
    
    if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
      const customId = await question(`   Enter player_id (or press Enter to use '${suggestedId}'): `);
      const playerId = customId.trim() || suggestedId;
      
      try {
        await pool.query('BEGIN');
        
        await addPlayer(player_name, team_code, playerId);
        await addToRoster(playerId, team_code);
        const updated = await updateScrapedBoxscores(player_name, team_code, playerId);
        
        await pool.query('COMMIT');
        
        console.log(`   ✅ Added player with ID: ${playerId}`);
        console.log(`   ✅ Updated ${updated} records in scraped_boxscores`);
        added++;
      } catch (error: any) {
        await pool.query('ROLLBACK');
        console.error(`   ❌ Error: ${error.message}`);
        skipped++;
      }
    } else if (answer.toLowerCase() === 'skip') {
      skipped++;
      console.log(`   ⏭️  Skipped`);
    } else {
      skipped++;
      console.log(`   ⏭️  Skipped`);
    }
  }
  
  rl.close();
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`\n📊 Summary: ${added} added, ${skipped} skipped`);
  console.log(`\n💡 After adding players, you can run:`);
  console.log(`   tsx scripts/resolve-missing-player-ids.ts --auto`);
  console.log(`   to automatically resolve any remaining matches\n`);
  
  await pool.end();
}

main().catch(console.error);








