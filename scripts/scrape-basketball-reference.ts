import 'dotenv/config';
import { Pool } from 'pg';
import * as cheerio from 'cheerio';

/**
 * Basketball Reference Web Scraper
 * 
 * Scrapes box scores from Basketball Reference (basketball-reference.com)
 * 
 * URL Format: https://www.basketball-reference.com/boxscores/YYYYMMDD0TEAM.html
 * Example: https://www.basketball-reference.com/boxscores/202510180ATL.html
 * 
 * BEST PRACTICES:
 * ✅ Rate limiting: 3+ seconds between requests (more conservative than NBA.com)
 * ✅ Jitter/randomization: Adds randomness to delays
 * ✅ Proper headers: Browser-like headers
 * ✅ Error handling: Graceful handling of missing games
 * ✅ Respectful scraping: Conservative defaults
 * 
 * IMPORTANT: Sports Reference Bot Traffic Policy:
 * - Basketball Reference allows 20 requests per minute maximum
 * - Violations result in 24-hour IP ban
 * - This scraper defaults to 15 requests/minute (4 second delay) to stay safe
 * - Review full policy: https://www.sports-reference.com/bot-traffic.html
 * 
 * Environment Variables:
 *   BBREF_SCRAPE_DELAY_MS - Delay between requests in ms (default: 4000 = 15 req/min)
 *   BBREF_SCRAPE_MAX_PER_HOUR - Max requests per hour (default: 900)
 * 
 * Usage:
 *   tsx scripts/scrape-basketball-reference.ts --game-date 2025-11-18 --home-team ATL --away-team DET
 *   tsx scripts/scrape-basketball-reference.ts --game-id 0022500251  # Auto-detects date and teams
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
// Sports Reference allows 20 requests per minute for Basketball Reference
// That's 1 request every 3 seconds minimum
// We'll use 4 seconds to be safe (15 requests/minute)
const BASE_DELAY_MS = Number.parseInt(process.env.BBREF_SCRAPE_DELAY_MS || '4000', 10); // 4 seconds default
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const MAX_REQUESTS_PER_MINUTE = 15; // Well below the 20/minute limit
const MAX_REQUESTS_PER_HOUR = Number.parseInt(process.env.BBREF_SCRAPE_MAX_PER_HOUR || '900', 10); // 15/min * 60 = 900/hour

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

// Basketball Reference headers
const BBREF_HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.basketball-reference.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Track request rate - Sports Reference limits: 20 requests per minute
let requestCount = 0;
let requestWindowStart = Date.now();
const REQUEST_WINDOW_MS = 60 * 1000; // 1 minute (for per-minute tracking)
const HOURLY_WINDOW_MS = 60 * 60 * 1000; // 1 hour (for per-hour tracking)
let hourlyRequestCount = 0;
let hourlyWindowStart = Date.now();

function addJitter(delayMs: number): number {
  const jitter = Math.random() * delayMs * 0.2;
  return Math.floor(delayMs + jitter);
}

function checkRateLimit(): void {
  const now = Date.now();
  
  // Reset minute window if minute has passed
  if (now - requestWindowStart > REQUEST_WINDOW_MS) {
    requestCount = 0;
    requestWindowStart = now;
  }
  
  // Reset hour window if hour has passed
  if (now - hourlyWindowStart > HOURLY_WINDOW_MS) {
    hourlyRequestCount = 0;
    hourlyWindowStart = now;
  }
  
  // Check per-minute limit (20 requests/minute max, we use 15 to be safe)
  if (requestCount >= MAX_REQUESTS_PER_MINUTE) {
    const waitTime = REQUEST_WINDOW_MS - (now - requestWindowStart);
    throw new Error(
      `Rate limit exceeded: ${requestCount} requests in this minute. ` +
      `Sports Reference allows 20/minute. Wait ${Math.ceil(waitTime / 1000)} seconds before retrying.`
    );
  }
  
  // Check per-hour limit (safety check)
  if (hourlyRequestCount >= MAX_REQUESTS_PER_HOUR) {
    const waitTime = HOURLY_WINDOW_MS - (now - hourlyWindowStart);
    throw new Error(
      `Hourly rate limit exceeded: ${hourlyRequestCount} requests in this hour. ` +
      `Wait ${Math.ceil(waitTime / 1000 / 60)} minutes before retrying.`
    );
  }
  
  requestCount++;
  hourlyRequestCount++;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = MAX_RETRIES,
): Promise<Response> {
  checkRateLimit();
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...BBREF_HEADERS,
          ...(options.headers || {}),
        },
      });

      if (response.ok) {
        return response;
      }

      if (response.status === 404) {
        throw new Error('Game not found (404)');
      }

      if (response.status === 429 || response.status === 503) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(`⚠️  Rate limited/service unavailable. Waiting ${Math.ceil(delay / 1000)}s before retry ${attempt + 1}/${retries}`);
        await sleep(addJitter(delay));
        continue;
      }

      if (attempt === retries) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
      await sleep(addJitter(delay));
    } catch (error: any) {
      if (attempt === retries) {
        throw error;
      }
      console.warn(`⚠️  Request failed (attempt ${attempt + 1}/${retries}):`, error.message);
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
      await sleep(addJitter(delay));
    }
  }

  throw new Error('Max retries exceeded');
}

/**
 * Map NBA team abbreviations to Basketball Reference team codes
 * Basketball Reference uses 3-letter codes (e.g., ATL, BOS, etc.)
 */
export const TEAM_CODE_MAP: Record<string, string> = {
  'ATL': 'ATL', 'BOS': 'BOS', 'BKN': 'BRK', 'CHA': 'CHO', 'CHI': 'CHI',
  'CLE': 'CLE', 'DAL': 'DAL', 'DEN': 'DEN', 'DET': 'DET', 'GSW': 'GSW',
  'HOU': 'HOU', 'IND': 'IND', 'LAC': 'LAC', 'LAL': 'LAL', 'MEM': 'MEM',
  'MIA': 'MIA', 'MIL': 'MIL', 'MIN': 'MIN', 'NOP': 'NOP', 'NYK': 'NYK',
  'OKC': 'OKC', 'ORL': 'ORL', 'PHI': 'PHI', 'PHX': 'PHO', 'POR': 'POR',
  'SAC': 'SAC', 'SAS': 'SAS', 'TOR': 'TOR', 'UTA': 'UTA', 'WAS': 'WAS',
};

/**
 * Get team abbreviations from game ID
 */
async function getTeamAbbreviations(gameId: string): Promise<{ homeAbbr: string; awayAbbr: string; gameDate: Date } | null> {
  const result = await pool.query(`
    SELECT 
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr,
      g.start_time
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE g.game_id = $1
  `, [gameId]);

  if (result.rows.length === 0) {
    return null;
  }

  return {
    homeAbbr: result.rows[0].home_abbr,
    awayAbbr: result.rows[0].away_abbr,
    gameDate: new Date(result.rows[0].start_time),
  };
}

/**
 * Construct Basketball Reference URL
 * Format: https://www.basketball-reference.com/boxscores/YYYYMMDD0TEAM.html
 * Where TEAM is the home team's 3-letter code
 */
function constructBBRefURL(date: Date | string, homeTeamCode: string): string {
  let year: number, month: number, day: number;
  
  if (typeof date === 'string') {
    // Parse YYYY-MM-DD format
    const parts = date.split('-');
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
  } else {
    // Use date as-is (avoid timezone conversion issues)
    year = date.getFullYear();
    month = date.getMonth() + 1;
    day = date.getDate();
  }
  
  const dateStr = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
  
  return `https://www.basketball-reference.com/boxscores/${dateStr}0${homeTeamCode}.html`;
}

/**
 * Parse minutes from "MM:SS" format to decimal minutes
 */
function parseMinutes(value: string | null | undefined): number | null {
  if (!value || value === '') return null;
  
  // Handle "Did Not Play" or similar
  if (value.includes('Did Not') || value === 'DNP') return null;
  
  // Parse "MM:SS" format
  const parts = value.split(':');
  if (parts.length === 2) {
    const minutes = parseInt(parts[0], 10);
    const seconds = parseInt(parts[1], 10);
    if (!isNaN(minutes) && !isNaN(seconds)) {
      return minutes + seconds / 60;
    }
  }
  
  // Try parsing as number
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

/**
 * Parse integer from string, handling empty/null
 */
function parseIntSafe(value: string | null | undefined): number | null {
  if (!value || value === '' || value === '-') return null;
  const num = parseInt(value, 10);
  return isNaN(num) ? null : num;
}

/**
 * Fetch and parse box score from Basketball Reference
 */
export async function fetchBBRefBoxScore(date: Date | string, homeTeamCode: string): Promise<any> {
  const url = constructBBRefURL(date, homeTeamCode);
  console.log(`🌐 Fetching Basketball Reference: ${url}`);
  
  const response = await fetchWithRetry(url);
  const html = await response.text();
  
  // Basketball Reference sometimes wraps tables in HTML comments
  // Remove comment tags to make tables accessible
  const htmlWithoutComments = html.replace(/<!--/g, '').replace(/-->/g, '');
  const $ = cheerio.load(htmlWithoutComments);
  
  // Find box score tables
  // Basketball Reference uses IDs like "box-{TEAM}-game-basic" for player stats
  const playerStats: any[] = [];
  
  // Look for tables with IDs ending in "-game-basic"
  $('table[id$="-game-basic"]').each((index, table) => {
    const $table = $(table);
    const tableId = $table.attr('id') || '';
    
    // Extract team code from table ID (e.g., "box-ATL-game-basic" -> "ATL")
    const teamMatch = tableId.match(/box-([A-Z]{3})-game-basic/);
    const teamCode = teamMatch ? teamMatch[1] : null;
    
    if (!teamCode) {
      console.log(`   ⚠️  Could not extract team code from table ID: ${tableId}`);
      return;
    }
    
    console.log(`   📊 Parsing table for team: ${teamCode}`);
    
    // Extract headers from thead
    const headers: string[] = [];
    $table.find('thead tr').last().find('th, td').each((i, th) => {
      const text = $(th).text().trim();
      // Skip empty headers
      if (text && text !== '') {
        headers.push(text);
      }
    });
    
    console.log(`   📋 Found headers: ${headers.join(', ')}`);
    
    let isStartersSection = true; // Start with true, assume first players are starters
    let isReservesSection = false;
    let playerCount = 0;
    
    // Extract player rows from tbody
    $table.find('tbody tr').each((rowIdx, row) => {
      const $row = $(row);
      const rowText = $row.text().trim();
      const firstCellText = $row.find('th, td').first().text().trim();
      
      // Check if this is a section header row
      if (firstCellText === 'Starters' || rowText.match(/^Starters/i)) {
        isStartersSection = true;
        isReservesSection = false;
        return;
      }
      
      if (firstCellText === 'Reserves' || rowText.match(/^Reserves/i)) {
        isStartersSection = false;
        isReservesSection = true;
        return;
      }
      
      // Skip team totals row
      if (rowText.includes('Team Totals') || firstCellText === 'Team Totals') {
        return;
      }
      
      // Skip "Did Not Play" or "Did Not Dress" rows (they have no stats)
      if (rowText.includes('Did Not Play') || rowText.includes('Did Not Dress')) {
        return;
      }
      
      // If we've seen 5+ players and haven't hit "Reserves" yet, they're likely all starters
      // After hitting "Reserves", all subsequent are reserves
      const playerData: any = {
        team_code: teamCode,
        source: 'basketball_reference',
        started: isStartersSection && !isReservesSection,
      };
      
      playerCount++;
      
      // Extract player name (first th contains the name)
      const nameCell = $row.find('th').first();
      const playerName = nameCell.text().trim();
      
      if (!playerName || playerName === '') {
        return;
      }
      
      playerData.player_name = playerName;
      
      // Extract stats from td cells
      const cells = $row.find('td').toArray();
      cells.forEach((cell, colIdx) => {
        // Headers array: [empty, MP, FG, FGA, FG%, 3P, 3PA, ...]
        // So colIdx 0 = MP, colIdx 1 = FG, etc.
        const headerIndex = colIdx + 1; // +1 because first column (name) is in th
        const header = headers[headerIndex];
        const value = $(cell).text().trim();
        
        if (!header || !value || value === '') return;
        
        // Map Basketball Reference column names to our schema
        const headerLower = header.toLowerCase();
        
        if (headerLower === 'mp') {
          playerData.minutes = parseMinutes(value);
        } else if (headerLower === 'fg') {
          playerData.field_goals_made = parseIntSafe(value);
        } else if (headerLower === 'fga') {
          playerData.field_goals_attempted = parseIntSafe(value);
        } else if (headerLower === '3p' || headerLower === '3-pointers') {
          playerData.three_pointers_made = parseIntSafe(value);
        } else if (headerLower === '3pa' || headerLower === '3-point attempts') {
          playerData.three_pointers_attempted = parseIntSafe(value);
        } else if (headerLower === 'ft') {
          playerData.free_throws_made = parseIntSafe(value);
        } else if (headerLower === 'fta') {
          playerData.free_throws_attempted = parseIntSafe(value);
        } else if (headerLower === 'orb') {
          // Offensive rebounds (we might not store separately)
        } else if (headerLower === 'drb') {
          // Defensive rebounds (we might not store separately)
        } else if (headerLower === 'trb' || headerLower === 'reb') {
          playerData.rebounds = parseIntSafe(value);
        } else if (headerLower === 'ast') {
          playerData.assists = parseIntSafe(value);
        } else if (headerLower === 'stl') {
          playerData.steals = parseIntSafe(value);
        } else if (headerLower === 'blk') {
          playerData.blocks = parseIntSafe(value);
        } else if (headerLower === 'tov') {
          playerData.turnovers = parseIntSafe(value);
        } else if (headerLower === 'pts') {
          playerData.points = parseIntSafe(value);
        } else if (headerLower === '+/-' || headerLower === 'plus/minus') {
          playerData.plus_minus = parseIntSafe(value);
        }
      });
      
      if (playerData.player_name) {
        playerStats.push(playerData);
      }
    });
  });
  
  // Calculate scores from team totals (sum of all player points)
  // This is more reliable than parsing HTML structure
  let homeScore: number | null = null;
  let awayScore: number | null = null;
  
  const teamScores: Record<string, number> = {};
  
  // Sum up points for each team
  for (const playerStat of playerStats) {
    const teamCode = playerStat.team_code;
    const points = playerStat.points || 0;
    
    if (!teamScores[teamCode]) {
      teamScores[teamCode] = 0;
    }
    teamScores[teamCode] += points;
  }
  
  // Map team codes to home/away scores
  if (Object.keys(teamScores).length >= 2) {
    const teams = Object.keys(teamScores);
    if (teams.includes(homeTeamCode)) {
      homeScore = teamScores[homeTeamCode];
      // Find the away team (the other team)
      const awayTeamCode = teams.find(t => t !== homeTeamCode);
      if (awayTeamCode) {
        awayScore = teamScores[awayTeamCode];
      }
    } else if (teams.length === 2) {
      // If home team code doesn't match, use first team as away, second as home
      awayScore = teamScores[teams[0]];
      homeScore = teamScores[teams[1]];
    }
  }
  
  await sleep(addJitter(BASE_DELAY_MS));
  
  return {
    source: 'basketball_reference',
    url,
    playerStats,
    date: typeof date === 'string' ? date : date.toISOString().split('T')[0],
    homeTeamCode,
    homeScore,
    awayScore,
  };
}

/**
 * Resolve player ID from name (fuzzy matching)
 */
async function resolvePlayerId(playerName: string, teamCode: string): Promise<string | null> {
  // Try exact match first
  const exactMatch = await pool.query(`
    SELECT p.player_id
    FROM players p
    JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
    JOIN teams t ON ptr.team_id = t.team_id
    WHERE LOWER(p.full_name) = LOWER($1)
      AND t.abbreviation = $2
    LIMIT 1
  `, [playerName, teamCode]);
  
  if (exactMatch.rows.length > 0) {
    return exactMatch.rows[0].player_id;
  }
  
  // Try fuzzy matching (last name match)
  const lastName = playerName.split(' ').pop();
  if (lastName) {
    const fuzzyMatch = await pool.query(`
      SELECT p.player_id
      FROM players p
      JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
      JOIN teams t ON ptr.team_id = t.team_id
      WHERE LOWER(p.last_name) = LOWER($1)
        AND t.abbreviation = $2
      LIMIT 1
    `, [lastName, teamCode]);
    
    if (fuzzyMatch.rows.length > 0) {
      return fuzzyMatch.rows[0].player_id;
    }
  }
  
  return null;
}

/**
 * Resolve team ID from Basketball Reference team code
 */
async function resolveTeamId(teamCode: string): Promise<string | null> {
  // Map BBRef code back to NBA abbreviation
  const nbaAbbr = Object.entries(TEAM_CODE_MAP).find(([_, code]) => code === teamCode)?.[0];
  if (!nbaAbbr) return null;
  
  const result = await pool.query(`
    SELECT team_id
    FROM teams
    WHERE abbreviation = $1
    LIMIT 1
  `, [nbaAbbr]);
  
  return result.rows.length > 0 ? result.rows[0].team_id : null;
}

/**
 * Process and store box score from Basketball Reference
 */
export async function processBBRefBoxScore(
  gameId: string,
  dryRun: boolean = false
): Promise<boolean> {
  try {
    // Get game info
    const gameInfo = await getTeamAbbreviations(gameId);
    if (!gameInfo) {
      console.error(`   ❌ Could not find game ${gameId} in database`);
      return false;
    }
    
    const { homeAbbr, awayAbbr, gameDate } = gameInfo;
    const homeTeamCode = TEAM_CODE_MAP[homeAbbr];
    
    if (!homeTeamCode) {
      console.error(`   ❌ Unknown team code for ${homeAbbr}`);
      return false;
    }
    
    console.log(`\n📊 Processing game ${gameId} (${awayAbbr} @ ${homeAbbr}, ${gameDate.toISOString().split('T')[0]})...`);
    
    if (dryRun) {
      console.log(`   [DRY RUN] Would fetch from Basketball Reference`);
      return true;
    }
    
    // Fetch box score
    const boxScoreData = await fetchBBRefBoxScore(gameDate, homeTeamCode);
    
    if (!boxScoreData.playerStats || boxScoreData.playerStats.length === 0) {
      console.warn(`   ⚠️  No player stats found`);
      return false;
    }
    
    console.log(`   ✅ Found ${boxScoreData.playerStats.length} player stat rows`);
    
    // Extract scores from box score data
    const homeScore = boxScoreData.homeScore;
    const awayScore = boxScoreData.awayScore;
    
    // Store in database
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Update game scores if we have them and they're missing/null in DB
      if (homeScore !== null && awayScore !== null) {
        const currentGame = await client.query(
          `SELECT home_score, away_score FROM games WHERE game_id = $1`,
          [gameId]
        );
        
        if (currentGame.rows.length > 0) {
          const current = currentGame.rows[0];
          if (current.home_score === null || current.away_score === null) {
            await client.query(
              `UPDATE games SET home_score = $1, away_score = $2, updated_at = now() WHERE game_id = $3`,
              [homeScore, awayScore, gameId]
            );
            console.log(`   ✅ Updated game scores: ${awayScore} - ${homeScore}`);
          }
        }
      }
      
      let inserted = 0;
      let skipped = 0;
      
      for (const playerStat of boxScoreData.playerStats) {
        const teamId = await resolveTeamId(playerStat.team_code);
        if (!teamId) {
          skipped++;
          continue;
        }
        
        const playerId = await resolvePlayerId(playerStat.player_name, playerStat.team_code);
        if (!playerId) {
          console.warn(`   ⚠️  Could not resolve player: ${playerStat.player_name} (${playerStat.team_code})`);
          skipped++;
          continue;
        }
        
        // Insert player game stats
        await client.query(`
          INSERT INTO player_game_stats (
            game_id, player_id, team_id, minutes, points, rebounds, assists,
            steals, blocks, turnovers, field_goals_made, field_goals_attempted,
            three_pointers_made, three_pointers_attempted, free_throws_made,
            free_throws_attempted, plus_minus, started,
            created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, now(), now())
          ON CONFLICT (game_id, player_id) DO UPDATE SET
            minutes = EXCLUDED.minutes,
            points = EXCLUDED.points,
            rebounds = EXCLUDED.rebounds,
            assists = EXCLUDED.assists,
            steals = EXCLUDED.steals,
            blocks = EXCLUDED.blocks,
            turnovers = EXCLUDED.turnovers,
            field_goals_made = EXCLUDED.field_goals_made,
            field_goals_attempted = EXCLUDED.field_goals_attempted,
            three_pointers_made = EXCLUDED.three_pointers_made,
            three_pointers_attempted = EXCLUDED.three_pointers_attempted,
            free_throws_made = EXCLUDED.free_throws_made,
            free_throws_attempted = EXCLUDED.free_throws_attempted,
            plus_minus = EXCLUDED.plus_minus,
            started = EXCLUDED.started,
            updated_at = now()
        `, [
          gameId,
          playerId,
          teamId,
          playerStat.minutes ?? null,
          playerStat.points ?? null,
          playerStat.rebounds ?? null,
          playerStat.assists ?? null,
          playerStat.steals ?? null,
          playerStat.blocks ?? null,
          playerStat.turnovers ?? null,
          playerStat.field_goals_made ?? null,
          playerStat.field_goals_attempted ?? null,
          playerStat.three_pointers_made ?? null,
          playerStat.three_pointers_attempted ?? null,
          playerStat.free_throws_made ?? null,
          playerStat.free_throws_attempted ?? null,
          playerStat.plus_minus ?? null,
          playerStat.started ?? false,
        ]);
        
        inserted++;
      }
      
      await client.query('COMMIT');
      console.log(`   ✅ Inserted ${inserted} player stats${skipped > 0 ? `, skipped ${skipped}` : ''}`);
      return inserted > 0;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`   ❌ Error processing box score:`, error);
      return false;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error(`   ❌ Failed to fetch or process box score:`, error.message);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const gameIdIndex = args.indexOf('--game-id');
  const dateIndex = args.indexOf('--game-date');
  const homeTeamIndex = args.indexOf('--home-team');
  const awayTeamIndex = args.indexOf('--away-team');
  const dryRunIndex = args.indexOf('--dry-run');
  
  const dryRun = dryRunIndex !== -1;
  
  try {
    if (gameIdIndex !== -1 && args[gameIdIndex + 1]) {
      // Fetch by game ID (auto-detects date and teams)
      const gameId = args[gameIdIndex + 1];
      await processBBRefBoxScore(gameId, dryRun);
    } else if (dateIndex !== -1 && homeTeamIndex !== -1) {
      // Manual date and team specification
      const dateStr = args[dateIndex + 1]; // Format: YYYY-MM-DD
      const homeTeam = args[homeTeamIndex + 1];
      const homeTeamCode = TEAM_CODE_MAP[homeTeam.toUpperCase()];
      
      if (!homeTeamCode) {
        console.error(`Unknown team: ${homeTeam}`);
        process.exit(1);
      }
      
      // Parse date string directly to avoid timezone issues
      const dateParts = dateStr.split('-');
      const gameDate = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
      
      const boxScoreData = await fetchBBRefBoxScore(gameDate, homeTeamCode);
      console.log('\nBox Score Data:', JSON.stringify(boxScoreData, null, 2));
    } else {
      console.log('Usage:');
      console.log('  tsx scripts/scrape-basketball-reference.ts --game-id 0022500251');
      console.log('  tsx scripts/scrape-basketball-reference.ts --game-id 0022500251 --dry-run');
      console.log('  tsx scripts/scrape-basketball-reference.ts --game-date 2025-11-18 --home-team ATL');
      process.exit(1);
    }
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Only run main if this file is executed directly (not imported)
if (require.main === module || import.meta.url === `file://${process.argv[1]}`) {
  main();
}

