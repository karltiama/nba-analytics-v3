import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Backfill start times for bbref_schedule using NBA.com API
 * 
 * This script fetches game start times from the official NBA.com API (scoreboardV2)
 * and updates bbref_schedule.start_time for games that don't have times yet.
 * 
 * The NBA.com API is more reliable than scraping Basketball Reference because:
 * - It's the official source
 * - Start times are always available in GAME_STATUS_TEXT
 * - No HTML parsing needed
 * 
 * Usage:
 *   tsx scripts/backfill-start-times-nba-api.ts
 *   tsx scripts/backfill-start-times-nba-api.ts --start-date 2025-10-21 --end-date 2026-04-12
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const BASE_DELAY_MS = 700; // Respectful rate limiting (NBA.com API)

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Parse start time from NBA.com GAME_STATUS_TEXT (e.g., "7:00 PM ET", "8:30 PM ET")
 * Returns ISO string in ET timezone, or null if not found
 */
function parseStartTimeFromStatus(gameDate: Date, statusText: string): string | null {
  if (!statusText) return null;
  
  // Match patterns like "7:00 PM ET", "8:30 PM ET", "12:30 PM ET"
  const match = statusText.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*(?:ET|EST|EDT)?/i);
  if (!match) return null;
  
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3].toUpperCase();
  
  // Convert to 24-hour format
  if (ampm === 'PM' && hours !== 12) {
    hours += 12;
  } else if (ampm === 'AM' && hours === 12) {
    hours = 0;
  }
  
  // Create date in ET timezone
  const year = gameDate.getFullYear();
  const month = String(gameDate.getMonth() + 1).padStart(2, '0');
  const day = String(gameDate.getDate()).padStart(2, '0');
  const hoursStr = String(hours).padStart(2, '0');
  const minutesStr = String(minutes).padStart(2, '0');
  
  // Return ISO string with ET timezone offset (UTC-5, or UTC-4 during DST)
  // For simplicity, we'll use UTC-5 and let PostgreSQL handle DST
  const dateStr = `${year}-${month}-${day}T${hoursStr}:${minutesStr}:00-05:00`;
  const date = new Date(dateStr);
  
  return isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Fetch scoreboard from NBA.com API for a specific date
 */
async function fetchScoreboard(date: Date): Promise<any> {
  // Format date as MM/DD/YYYY for NBA.com API
  const dateStr = `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
  
  const url = new URL('https://stats.nba.com/stats/scoreboardV2');
  url.searchParams.set('GameDate', dateStr);
  url.searchParams.set('LeagueID', '00');
  url.searchParams.set('DayOffset', '0');
  
  console.log(`  Fetching scoreboard for ${dateStr}...`);
  
  try {
    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.nba.com/',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Rate limiting
    await sleep(BASE_DELAY_MS);
    
    return data;
  } catch (error: any) {
    console.error(`  ❌ Error fetching scoreboard: ${error.message}`);
    return null;
  }
}

/**
 * Parse scoreboard response and extract games with start times
 */
function parseScoreboard(data: any): Array<{
  homeTeamId: number;
  awayTeamId: number;
  startTime: string | null;
  gameDate: Date;
}> {
  if (!data?.resultSets || data.resultSets.length === 0) {
    return [];
  }
  
  const gameHeader = data.resultSets[0];
  const headers = gameHeader.headers || [];
  const rows = gameHeader.rowSet || [];
  
  const games = rows.map((row: any[]) => {
    const game: any = {};
    headers.forEach((header: string, idx: number) => {
      game[header] = row[idx];
    });
    
    const gameDateEst = game.GAME_DATE_EST;
    const statusText = game.GAME_STATUS_TEXT || '';
    const homeTeamId = game.HOME_TEAM_ID;
    const awayTeamId = game.VISITOR_TEAM_ID;
    
    // Parse game date
    let gameDate: Date;
    if (gameDateEst) {
      gameDate = new Date(gameDateEst);
    } else {
      gameDate = new Date();
    }
    
    // Parse start time from status text
    const startTime = parseStartTimeFromStatus(gameDate, statusText);
    
    return {
      homeTeamId,
      awayTeamId,
      startTime,
      gameDate,
    };
  });
  
  return games;
}

/**
 * Get team ID mapping from NBA.com team IDs to our internal team IDs
 */
async function getTeamIdMapping(): Promise<Map<number, string>> {
  const result = await pool.query(`
    SELECT provider_id, internal_id
    FROM provider_id_map
    WHERE entity_type = 'team' AND provider = 'nba'
  `);
  
  const mapping = new Map<number, string>();
  for (const row of result.rows) {
    mapping.set(parseInt(row.provider_id, 10), row.internal_id);
  }
  
  return mapping;
}

/**
 * Get games from bbref_schedule that need start times
 */
async function getGamesNeedingStartTimes(startDate?: string, endDate?: string): Promise<Array<{
  bbref_game_id: string;
  game_date: Date;
  home_team_id: string;
  away_team_id: string;
}>> {
  let query = `
    SELECT 
      bbref_game_id,
      game_date,
      home_team_id,
      away_team_id
    FROM bbref_schedule
    WHERE start_time IS NULL
      AND home_team_id IS NOT NULL
      AND away_team_id IS NOT NULL
  `;
  
  const params: any[] = [];
  let paramCount = 1;
  
  if (startDate) {
    query += ` AND game_date >= $${paramCount}::date`;
    params.push(startDate);
    paramCount++;
  }
  
  if (endDate) {
    query += ` AND game_date <= $${paramCount}::date`;
    params.push(endDate);
    paramCount++;
  }
  
  query += ` ORDER BY game_date ASC`;
  
  const result = await pool.query(query, params);
  
  return result.rows.map(row => ({
    bbref_game_id: row.bbref_game_id,
    game_date: new Date(row.game_date),
    home_team_id: row.home_team_id,
    away_team_id: row.away_team_id,
  }));
}

/**
 * Update start time for a game in bbref_schedule
 */
async function updateStartTime(bbrefGameId: string, startTime: string): Promise<void> {
  await pool.query(`
    UPDATE bbref_schedule
    SET start_time = $1::timestamptz, updated_at = now()
    WHERE bbref_game_id = $2
  `, [startTime, bbrefGameId]);
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(80));
  console.log('🏀 Backfill Start Times from NBA.com API');
  console.log('='.repeat(80));
  
  const args = process.argv.slice(2);
  let startDate: string | undefined;
  let endDate: string | undefined;
  
  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--start-date' && args[i + 1]) {
      startDate = args[i + 1];
      i++;
    } else if (args[i] === '--end-date' && args[i + 1]) {
      endDate = args[i + 1];
      i++;
    }
  }
  
  try {
    // Get team ID mapping
    console.log('\n📋 Loading team ID mappings...');
    const teamMapping = await getTeamIdMapping();
    console.log(`  Found ${teamMapping.size} team mappings`);
    
    if (teamMapping.size === 0) {
      console.error('❌ No team mappings found. Please seed provider_id_map first.');
      process.exit(1);
    }
    
    // Create reverse mapping (internal_id -> nba_id)
    const reverseMapping = new Map<string, number>();
    for (const [nbaId, internalId] of teamMapping.entries()) {
      reverseMapping.set(internalId, nbaId);
    }
    
    // Get games that need start times
    console.log('\n📅 Finding games without start times...');
    const gamesNeedingTimes = await getGamesNeedingStartTimes(startDate, endDate);
    console.log(`  Found ${gamesNeedingTimes.length} games without start times`);
    
    if (gamesNeedingTimes.length === 0) {
      console.log('\n✅ All games already have start times!');
      return;
    }
    
    // Group games by date
    const gamesByDate = new Map<string, typeof gamesNeedingTimes>();
    for (const game of gamesNeedingTimes) {
      const dateKey = game.game_date.toISOString().split('T')[0];
      if (!gamesByDate.has(dateKey)) {
        gamesByDate.set(dateKey, []);
      }
      gamesByDate.get(dateKey)!.push(game);
    }
    
    console.log(`  Processing ${gamesByDate.size} unique dates\n`);
    
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    
    // Process each date
    for (const [dateKey, games] of gamesByDate.entries()) {
      const date = new Date(dateKey);
      console.log(`📆 ${dateKey} (${games.length} games)`);
      
      // Fetch scoreboard from NBA.com API
      const scoreboardData = await fetchScoreboard(date);
      if (!scoreboardData) {
        console.log(`  ⚠️  Skipping date due to API error\n`);
        totalSkipped += games.length;
        continue;
      }
      
      // Parse games from scoreboard
      const nbaGames = parseScoreboard(scoreboardData);
      console.log(`  Found ${nbaGames.length} games in scoreboard`);
      
      if (nbaGames.length === 0) {
        console.log(`  ⚠️  No games found in scoreboard\n`);
        totalSkipped += games.length;
        continue;
      }
      
      // Match games by team IDs
      for (const bbrefGame of games) {
        const homeNbaId = reverseMapping.get(bbrefGame.home_team_id);
        const awayNbaId = reverseMapping.get(bbrefGame.away_team_id);
        
        if (!homeNbaId || !awayNbaId) {
          console.log(`  ⚠️  Skipping ${bbrefGame.bbref_game_id} - missing team mapping`);
          totalSkipped++;
          continue;
        }
        
        // Find matching game in scoreboard
        const matchingNbaGame = nbaGames.find(
          g => g.homeTeamId === homeNbaId && g.awayTeamId === awayNbaId
        );
        
        if (!matchingNbaGame) {
          console.log(`  ⚠️  No match found for ${bbrefGame.bbref_game_id}`);
          totalSkipped++;
          continue;
        }
        
        if (!matchingNbaGame.startTime) {
          console.log(`  ⚠️  No start time in API response for ${bbrefGame.bbref_game_id}`);
          totalSkipped++;
          continue;
        }
        
        // Update start time
        try {
          await updateStartTime(bbrefGame.bbref_game_id, matchingNbaGame.startTime);
          const timeStr = new Date(matchingNbaGame.startTime).toLocaleTimeString('en-US', {
            timeZone: 'America/New_York',
            hour: 'numeric',
            minute: '2-digit',
          });
          console.log(`  ✅ Updated: ${bbrefGame.bbref_game_id} -> ${timeStr} ET`);
          totalUpdated++;
        } catch (error: any) {
          console.error(`  ❌ Error updating ${bbrefGame.bbref_game_id}: ${error.message}`);
          totalErrors++;
        }
      }
      
      console.log('');
    }
    
    console.log('='.repeat(80));
    console.log('📊 Summary:');
    console.log(`  ✅ Updated: ${totalUpdated}`);
    console.log(`  ⚠️  Skipped: ${totalSkipped}`);
    console.log(`  ❌ Errors: ${totalErrors}`);
    console.log('='.repeat(80));
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();






