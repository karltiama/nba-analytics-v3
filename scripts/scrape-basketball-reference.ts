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
    let timeoutId: NodeJS.Timeout | null = null;
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await fetch(url, {
        ...options,
        headers: {
          ...BBREF_HEADERS,
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });
      
      if (timeoutId) clearTimeout(timeoutId);

      if (response.ok) {
        return response;
      }

      if (response.status === 404) {
        throw new Error(`Game not found (404): ${url}`);
      }

      if (response.status === 429 || response.status === 503) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(`⚠️  Rate limited/service unavailable (${response.status}). Waiting ${Math.ceil(delay / 1000)}s before retry ${attempt + 1}/${retries}`);
        console.warn(`   URL: ${url}`);
        await sleep(addJitter(delay));
        continue;
      }

      if (response.status === 403) {
        throw new Error(`Access forbidden (403): Basketball Reference may be blocking requests. URL: ${url}`);
      }

      if (attempt === retries) {
        throw new Error(`HTTP ${response.status}: ${response.statusText} - URL: ${url}`);
      }

      const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
      console.warn(`⚠️  HTTP ${response.status} error. Waiting ${Math.ceil(delay / 1000)}s before retry ${attempt + 1}/${retries}`);
      await sleep(addJitter(delay));
    } catch (error: any) {
      // Always clear timeout on error
      if (timeoutId) clearTimeout(timeoutId);
      // Handle timeout errors (AbortController abort)
      if (error.name === 'AbortError' || error.message?.includes('aborted')) {
        if (attempt === retries) {
          throw new Error(`Request timeout after 30s: ${url}. This may indicate network issues or Basketball Reference is slow to respond.`);
        }
        console.warn(`⚠️  Request timeout (attempt ${attempt + 1}/${retries}): ${url}`);
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        await sleep(addJitter(delay));
        continue;
      }

      // Handle network errors (DNS, connection refused, etc.)
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        if (attempt === retries) {
          throw new Error(`Network error (${error.code}): ${error.message}. URL: ${url}. Check your internet connection.`);
        }
        console.warn(`⚠️  Network error (attempt ${attempt + 1}/${retries}): ${error.code} - ${error.message}`);
        console.warn(`   URL: ${url}`);
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        await sleep(addJitter(delay));
        continue;
      }

      if (attempt === retries) {
        // Provide detailed error message on final attempt
        const errorMsg = error.message || String(error);
        throw new Error(`Request failed after ${retries + 1} attempts: ${errorMsg}. URL: ${url}`);
      }
      console.warn(`⚠️  Request failed (attempt ${attempt + 1}/${retries}): ${error.message || error}`);
      console.warn(`   URL: ${url}`);
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
      await sleep(addJitter(delay));
    }
  }

  throw new Error(`Max retries exceeded for URL: ${url}`);
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
 * Generate bbref_game_id from date and team abbreviations
 * Format: bbref_YYYYMMDDHHMM_AWAY_HOME
 */
function generateBbrefGameId(date: Date | string, awayAbbr: string, homeAbbr: string): string {
  let year: number, month: number, day: number;
  
  if (typeof date === 'string') {
    const parts = date.split('-');
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
  } else {
    year = date.getFullYear();
    month = date.getMonth() + 1;
    day = date.getDate();
  }
  
  const dateStr = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
  const timeStr = '0000'; // Default to midnight if time not available
  return `bbref_${dateStr}${timeStr}_${awayAbbr}_${homeAbbr}`;
}

/**
 * Get team abbreviations, game date, and bbref_game_id
 * Returns the game date in Eastern Time (Basketball Reference uses ET for dates)
 * Tries bbref_schedule first, then bbref_games, then games table
 */
async function getTeamAbbreviations(gameId: string): Promise<{ 
  homeAbbr: string; 
  awayAbbr: string; 
  gameDate: Date | string;
  bbrefGameId: string;
  homeTeamId?: string;
  awayTeamId?: string;
} | null> {
  // First try bbref_schedule (has canonical_game_id link)
  // Extract date from bbref_game_id (format: bbref_YYYYMMDDHHMM_AWAY_HOME)
  // because game_date column can be off by one due to timezone storage issues
  const bbrefScheduleResult = await pool.query(`
    SELECT 
      bs.home_team_abbr as home_abbr,
      bs.away_team_abbr as away_abbr,
      SUBSTRING(bs.bbref_game_id FROM 7 FOR 4) || '-' || 
        SUBSTRING(bs.bbref_game_id FROM 11 FOR 2) || '-' || 
        SUBSTRING(bs.bbref_game_id FROM 13 FOR 2) as game_date_et,
      bs.bbref_game_id,
      bs.home_team_id,
      bs.away_team_id
    FROM bbref_schedule bs
    WHERE bs.canonical_game_id = $1 OR bs.bbref_game_id = $1
    LIMIT 1
  `, [gameId]);

  if (bbrefScheduleResult.rows.length > 0) {
    const row = bbrefScheduleResult.rows[0];
    return {
      homeAbbr: row.home_abbr,
      awayAbbr: row.away_abbr,
      gameDate: row.game_date_et,
      bbrefGameId: row.bbref_game_id,
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id,
    };
  }

  // Try bbref_games directly
  const bbrefGamesResult = await pool.query(`
    SELECT 
      bg.home_team_abbr as home_abbr,
      bg.away_team_abbr as away_abbr,
      SUBSTRING(bg.bbref_game_id FROM 7 FOR 4) || '-' || 
        SUBSTRING(bg.bbref_game_id FROM 11 FOR 2) || '-' || 
        SUBSTRING(bg.bbref_game_id FROM 13 FOR 2) as game_date_et,
      bg.bbref_game_id,
      bg.home_team_id,
      bg.away_team_id
    FROM bbref_games bg
    WHERE bg.bbref_game_id = $1
    LIMIT 1
  `, [gameId]);

  if (bbrefGamesResult.rows.length > 0) {
    const row = bbrefGamesResult.rows[0];
    return {
      homeAbbr: row.home_abbr,
      awayAbbr: row.away_abbr,
      gameDate: row.game_date_et,
      bbrefGameId: row.bbref_game_id,
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id,
    };
  }

  // Fallback to games table
  const result = await pool.query(`
    SELECT 
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr,
      g.start_time,
      CASE 
        WHEN (g.start_time AT TIME ZONE 'UTC')::time = '00:00:00'::time 
        THEN g.start_time::date::text
        ELSE DATE((g.start_time AT TIME ZONE 'America/New_York'))::text
      END as game_date_et,
      g.home_team_id,
      g.away_team_id
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE g.game_id = $1
  `, [gameId]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  const gameDateET = row.game_date_et;
  
  // Generate bbref_game_id from date and team abbreviations
  const homeTeamCode = TEAM_CODE_MAP[row.home_abbr];
  const awayTeamCode = TEAM_CODE_MAP[row.away_abbr];
  
  if (!homeTeamCode || !awayTeamCode) {
    return null;
  }
  
  const bbrefGameId = generateBbrefGameId(gameDateET, awayTeamCode, homeTeamCode);

  return {
    homeAbbr: row.home_abbr,
    awayAbbr: row.away_abbr,
    gameDate: gameDateET,
    bbrefGameId,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
  };
}

/**
 * Construct Basketball Reference URL
 * Format: https://www.basketball-reference.com/boxscores/YYYYMMDD0TEAM.html
 * Where TEAM is the home team's 3-letter code
 * 
 * IMPORTANT: Date should be in Eastern Time (Basketball Reference uses ET for dates)
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
    // Extract year/month/day from date
    // Date should already be in Eastern Time
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
 * Returns null if game not found (404)
 */
export async function fetchBBRefBoxScore(date: Date | string, homeTeamCode: string): Promise<any | null> {
  const url = constructBBRefURL(date, homeTeamCode);
  console.log(`🌐 Fetching Basketball Reference: ${url}`);
  
  try {
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
          playerData.offensive_rebounds = parseIntSafe(value);
        } else if (headerLower === 'drb') {
          playerData.defensive_rebounds = parseIntSafe(value);
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
        } else if (headerLower === 'pf') {
          playerData.personal_fouls = parseIntSafe(value);
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
  
  // Return team scores mapped by team code (not by URL home/away)
  // The caller will map these to database home/away based on actual team codes
  const teamCodesFound = Object.keys(teamScores);
  
    await sleep(addJitter(BASE_DELAY_MS));
    
    return {
      source: 'basketball_reference',
      url,
      playerStats,
      date: typeof date === 'string' ? date : date.toISOString().split('T')[0],
      urlHomeTeamCode: homeTeamCode, // Team code used in URL (may not match actual home team)
      teamScores, // Map of team code -> score
      teamCodesFound, // Array of team codes found in HTML
    };
  } catch (error: any) {
    if (error.message && error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}

/**
 * Normalize player name by removing accents and special characters for matching
 */
function normalizePlayerNameForMatching(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD') // Decompose accented characters
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9\s]/g, '') // Remove special characters except spaces
    .trim();
}

/**
 * Canonicalize a player name for matching: lowercase, strip periods, normalize accents
 */
function canonicalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\./g, '')        // A.J. → AJ
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics (ü → u, ş → s)
    .replace(/['']/g, "'")     // Normalize smart quotes
    .trim();
}

const SUFFIX_RE = /\s+(III|II|IV|V|Jr\.?|Sr\.?|IIIrd|IInd)$/i;

/**
 * Try to match a player name in the DB.
 * When teamAbbr is provided, requires a player_team_rosters match.
 * When teamAbbr is null, searches across all teams (fallback for trades).
 */
async function tryResolvePlayer(playerName: string, teamAbbr: string | null): Promise<string | null> {
  const teamJoin = teamAbbr
    ? `JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
       JOIN teams t ON ptr.team_id = t.team_id`
    : '';
  const teamWhere = teamAbbr ? `AND t.abbreviation = $2` : '';
  const params = teamAbbr ? [playerName, teamAbbr] : [playerName];
  const canon = canonicalizeName(playerName);
  const canonParams = teamAbbr ? [canon, teamAbbr] : [canon];

  // 1. Exact name match
  const exact = await pool.query(`
    SELECT p.player_id FROM players p ${teamJoin}
    WHERE LOWER(p.full_name) = LOWER($1) ${teamWhere} LIMIT 1
  `, params);
  if (exact.rows.length > 0) return exact.rows[0].player_id;

  // 2. Canonicalized match (strips periods, accents, diacritics)
  const canonMatch = await pool.query(`
    SELECT p.player_id FROM players p ${teamJoin}
    WHERE LOWER(TRANSLATE(REPLACE(p.full_name, '.', ''), 'áàâäéèêëíìîïóòôöúùûüçñşğёÁÀÂÄÉÈÊËÍÌÎÏÓÒÔÖÚÙÛÜÇÑŞĞ', 'aaaeeeeiiiioooouuuucnsgeaaaeeeeiiiioooouuuucnsg'))
          = $1 ${teamWhere} LIMIT 1
  `, canonParams);
  if (canonMatch.rows.length > 0) return canonMatch.rows[0].player_id;

  // 3. Suffix variations (scraped has suffix, DB doesn't or vice versa)
  const nameWithoutSuffix = playerName.replace(SUFFIX_RE, '').trim();
  if (nameWithoutSuffix !== playerName) {
    const canonNoSuffix = canonicalizeName(nameWithoutSuffix);
    const noSuffixParams = teamAbbr ? [canonNoSuffix, teamAbbr] : [canonNoSuffix];
    const sfx = await pool.query(`
      SELECT p.player_id FROM players p ${teamJoin}
      WHERE LOWER(TRANSLATE(REPLACE(p.full_name, '.', ''), 'áàâäéèêëíìîïóòôöúùûüçñşğёÁÀÂÄÉÈÊËÍÌÎÏÓÒÔÖÚÙÛÜÇÑŞĞ', 'aaaeeeeiiiioooouuuucnsgeaaaeeeeiiiioooouuuucnsg'))
            = $1 ${teamWhere} LIMIT 1
    `, noSuffixParams);
    if (sfx.rows.length > 0) return sfx.rows[0].player_id;
  }

  // DB name has suffix, scraped name doesn't
  const dbSfx = await pool.query(`
    SELECT p.player_id FROM players p ${teamJoin}
    WHERE LOWER(TRANSLATE(REPLACE(REGEXP_REPLACE(p.full_name, '\\s+(III|II|IV|V|Jr\\.?|Sr\\.?|IIIrd|IInd)$', '', 'i'), '.', ''),
          'áàâäéèêëíìîïóòôöúùûüçñşğёÁÀÂÄÉÈÊËÍÌÎÏÓÒÔÖÚÙÛÜÇÑŞĞ', 'aaaeeeeiiiioooouuuucnsgeaaaeeeeiiiioooouuuucnsg'))
          = $1 ${teamWhere} LIMIT 1
  `, canonParams);
  if (dbSfx.rows.length > 0) return dbSfx.rows[0].player_id;

  // 4. Last-name-only match (only with team filter to avoid ambiguity)
  if (teamAbbr) {
    const lastName = playerName.split(' ').pop();
    if (lastName && lastName.length > 2) {
      const lastNameMatch = await pool.query(`
        SELECT p.player_id FROM players p ${teamJoin}
        WHERE LOWER(p.last_name) = LOWER($1) ${teamWhere} LIMIT 1
      `, [lastName, teamAbbr]);
      if (lastNameMatch.rows.length > 0) return lastNameMatch.rows[0].player_id;
    }
  }

  return null;
}

/**
 * Resolve player ID from name (fuzzy matching with cross-team fallback)
 */
async function resolvePlayerId(playerName: string, teamCode: string): Promise<string | null> {
  const nbaAbbr = Object.entries(TEAM_CODE_MAP).find(([_, code]) => code === teamCode)?.[0] || teamCode;

  // Phase 1: Try with team roster filter (high confidence)
  const withTeam = await tryResolvePlayer(playerName, nbaAbbr);
  if (withTeam) return withTeam;

  // Phase 2: Cross-team fallback for traded/waived players
  const crossTeam = await tryResolvePlayer(playerName, null);
  if (crossTeam) return crossTeam;

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
/**
 * Ensure bbref_games entry exists, create if it doesn't
 */
async function ensureBbrefGameExists(
  bbrefGameId: string,
  gameDate: string,
  homeAbbr: string,
  awayAbbr: string,
  homeTeamId: string | undefined,
  awayTeamId: string | undefined,
  homeScore: number | null = null,
  awayScore: number | null = null
): Promise<void> {
  // Check if bbref_game exists
  const existing = await pool.query(`
    SELECT bbref_game_id FROM bbref_games WHERE bbref_game_id = $1
  `, [bbrefGameId]);
  
  if (existing.rows.length === 0) {
    // Create bbref_game entry
    await pool.query(`
      INSERT INTO bbref_games (
        bbref_game_id, game_date, home_team_abbr, away_team_abbr,
        home_team_id, away_team_id, home_score, away_score, status,
        created_at, updated_at
      ) VALUES ($1, $2::date, $3, $4, $5, $6, $7::int, $8::int, 
        CASE WHEN $7::int IS NOT NULL AND $8::int IS NOT NULL THEN 'Final' ELSE 'Scheduled' END,
        now(), now())
      ON CONFLICT (bbref_game_id) DO UPDATE SET
        home_score = COALESCE(EXCLUDED.home_score, bbref_games.home_score),
        away_score = COALESCE(EXCLUDED.away_score, bbref_games.away_score),
        status = CASE WHEN EXCLUDED.home_score IS NOT NULL AND EXCLUDED.away_score IS NOT NULL THEN 'Final' ELSE bbref_games.status END,
        updated_at = now()
    `, [bbrefGameId, gameDate, homeAbbr, awayAbbr, homeTeamId, awayTeamId, homeScore, awayScore]);
  } else if (homeScore !== null && awayScore !== null) {
    // Update scores if we have them
    await pool.query(`
      UPDATE bbref_games 
      SET home_score = $1, away_score = $2, status = 'Final', updated_at = now()
      WHERE bbref_game_id = $3
        AND (home_score IS NULL OR away_score IS NULL)
    `, [homeScore, awayScore, bbrefGameId]);
  }
}

export async function processBBRefBoxScore(
  gameId: string,
  dryRun: boolean = false
): Promise<boolean> {
  try {
    // Get game info (now includes bbrefGameId)
    const gameInfo = await getTeamAbbreviations(gameId);
    if (!gameInfo) {
      console.error(`   ❌ Could not find game ${gameId} in database`);
      return false;
    }
    
    const { homeAbbr, awayAbbr, gameDate, bbrefGameId, homeTeamId, awayTeamId } = gameInfo;
    
    // homeAbbr and awayAbbr from bbref_schedule/bbref_games are already BBRef codes
    // If they came from games table, we need to map them
    // Check if they're already BBRef codes (3 letters, might be CHO, BRK, etc.)
    const homeTeamCode = homeAbbr.length === 3 && (homeAbbr === 'CHO' || homeAbbr === 'BRK' || homeAbbr === 'PHO' || homeAbbr === 'NOP') 
      ? homeAbbr 
      : TEAM_CODE_MAP[homeAbbr] || homeAbbr;
    const awayTeamCode = awayAbbr.length === 3 && (awayAbbr === 'CHO' || awayAbbr === 'BRK' || awayAbbr === 'PHO' || awayAbbr === 'NOP')
      ? awayAbbr
      : TEAM_CODE_MAP[awayAbbr] || awayAbbr;
    
    if (!homeTeamCode || !awayTeamCode) {
      console.error(`   ❌ Unknown team code for ${homeAbbr} or ${awayAbbr}`);
      return false;
    }
    
    const gameDateStr = typeof gameDate === 'string' ? gameDate : gameDate.toISOString().split('T')[0];
    console.log(`\n📊 Processing game ${gameId} (${awayAbbr} @ ${homeAbbr}, ${gameDateStr})...`);
    
    if (dryRun) {
      console.log(`   [DRY RUN] Would fetch from Basketball Reference`);
      return true;
    }
    
    // Fetch box score - try home team first, then away team (for neutral site games)
    let boxScoreData = await fetchBBRefBoxScore(gameDate, homeTeamCode);
    
    // If not found, try the away team as "home" team (for neutral site/in-season tournament games)
    if (!boxScoreData) {
      console.log(`   ⚠️  Game not found with home team, trying away team (neutral site game?)...`);
      boxScoreData = await fetchBBRefBoxScore(gameDate, awayTeamCode);
    }
    
    if (!boxScoreData || !boxScoreData.playerStats || boxScoreData.playerStats.length === 0) {
      console.warn(`   ⚠️  No player stats found after trying both teams`);
      return false;
    }
    
    console.log(`   ✅ Found ${boxScoreData.playerStats.length} player stat rows`);
    
    // Map team scores from Basketball Reference team codes to our database home/away
    // Basketball Reference HTML has the actual team codes, regardless of URL
    const { teamScores, teamCodesFound } = boxScoreData;
    
    // homeTeamCode and awayTeamCode are already BBRef codes at this point
    const homeTeamCodeBBRef = homeTeamCode;
    const awayTeamCodeBBRef = awayTeamCode;
    
    // Get scores based on actual team codes found in HTML
    const homeScore = homeTeamCodeBBRef && teamScores[homeTeamCodeBBRef] !== undefined 
      ? teamScores[homeTeamCodeBBRef] 
      : null;
    const awayScore = awayTeamCodeBBRef && teamScores[awayTeamCodeBBRef] !== undefined 
      ? teamScores[awayTeamCodeBBRef] 
      : null;
    
    // Store in database
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Ensure bbref_games entry exists
      await ensureBbrefGameExists(
        bbrefGameId,
        gameDateStr,
        homeTeamCode,
        awayTeamCode,
        homeTeamId || null,
        awayTeamId || null,
        homeScore,
        awayScore
      );
      
      // Also update canonical games table scores if we have them
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
            console.log(`   ✅ Updated canonical game scores: ${awayScore} - ${homeScore}`);
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
        
        // Insert player game stats into BBRef table (PRIMARY source)
        // Note: source, created_at, updated_at have defaults, so we don't include them
        await client.query(`
          INSERT INTO bbref_player_game_stats (
            game_id, player_id, team_id, minutes, points, rebounds, offensive_rebounds, defensive_rebounds,
            assists, steals, blocks, turnovers, personal_fouls,
            field_goals_made, field_goals_attempted,
            three_pointers_made, three_pointers_attempted, free_throws_made,
            free_throws_attempted, plus_minus, started, dnp_reason
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
          ON CONFLICT (game_id, player_id) DO UPDATE SET
            minutes = EXCLUDED.minutes,
            points = EXCLUDED.points,
            rebounds = EXCLUDED.rebounds,
            offensive_rebounds = EXCLUDED.offensive_rebounds,
            defensive_rebounds = EXCLUDED.defensive_rebounds,
            assists = EXCLUDED.assists,
            steals = EXCLUDED.steals,
            blocks = EXCLUDED.blocks,
            turnovers = EXCLUDED.turnovers,
            personal_fouls = EXCLUDED.personal_fouls,
            field_goals_made = EXCLUDED.field_goals_made,
            field_goals_attempted = EXCLUDED.field_goals_attempted,
            three_pointers_made = EXCLUDED.three_pointers_made,
            three_pointers_attempted = EXCLUDED.three_pointers_attempted,
            free_throws_made = EXCLUDED.free_throws_made,
            free_throws_attempted = EXCLUDED.free_throws_attempted,
            plus_minus = EXCLUDED.plus_minus,
            started = EXCLUDED.started,
            dnp_reason = EXCLUDED.dnp_reason,
            source = EXCLUDED.source,
            updated_at = now()
        `, [
          bbrefGameId,  // Use bbref_game_id instead of canonical game_id
          playerId,
          teamId,
          playerStat.minutes ?? null,
          playerStat.points ?? null,
          playerStat.rebounds ?? null,
          playerStat.offensive_rebounds ?? null,
          playerStat.defensive_rebounds ?? null,
          playerStat.assists ?? null,
          playerStat.steals ?? null,
          playerStat.blocks ?? null,
          playerStat.turnovers ?? null,
          playerStat.personal_fouls ?? null,
          playerStat.field_goals_made ?? null,
          playerStat.field_goals_attempted ?? null,
          playerStat.three_pointers_made ?? null,
          playerStat.three_pointers_attempted ?? null,
          playerStat.free_throws_made ?? null,
          playerStat.free_throws_attempted ?? null,
          playerStat.plus_minus ?? null,
          playerStat.started ?? false,
          null, // dnp_reason
        ]);
        
        inserted++;
      }
      
      // Auto-aggregate team stats into bbref_team_game_stats
      if (inserted > 0) {
        const teamIds = new Set<string>();
        for (const playerStat of boxScoreData.playerStats) {
          const tid = await resolveTeamId(playerStat.team_code);
          if (tid) teamIds.add(tid);
        }

        for (const tid of teamIds) {
          const isHome = tid === (homeTeamId || await resolveTeamId(homeTeamCode));
          const agg = await client.query(`
            SELECT
              SUM(points) as points,
              SUM(field_goals_made) as field_goals_made,
              SUM(field_goals_attempted) as field_goals_attempted,
              SUM(three_pointers_made) as three_pointers_made,
              SUM(three_pointers_attempted) as three_pointers_attempted,
              SUM(free_throws_made) as free_throws_made,
              SUM(free_throws_attempted) as free_throws_attempted,
              SUM(rebounds) as rebounds,
              SUM(offensive_rebounds) as offensive_rebounds,
              SUM(defensive_rebounds) as defensive_rebounds,
              SUM(assists) as assists,
              SUM(steals) as steals,
              SUM(blocks) as blocks,
              SUM(turnovers) as turnovers,
              SUM(personal_fouls) as personal_fouls,
              SUM(plus_minus) as plus_minus,
              SUM(minutes) as minutes,
              SUM(field_goals_attempted) +
                0.44 * SUM(free_throws_attempted) -
                COALESCE(SUM(offensive_rebounds), 0) +
                SUM(turnovers) as possessions
            FROM bbref_player_game_stats
            WHERE game_id = $1 AND team_id = $2 AND dnp_reason IS NULL
          `, [bbrefGameId, tid]);

          const s = agg.rows[0];
          await client.query(`
            INSERT INTO bbref_team_game_stats (
              game_id, team_id, points, field_goals_made, field_goals_attempted,
              three_pointers_made, three_pointers_attempted,
              free_throws_made, free_throws_attempted,
              rebounds, offensive_rebounds, defensive_rebounds,
              assists, steals, blocks, turnovers, personal_fouls, plus_minus,
              possessions, minutes, is_home, source
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'bbref'
            )
            ON CONFLICT (game_id, team_id) DO UPDATE SET
              points=EXCLUDED.points, field_goals_made=EXCLUDED.field_goals_made,
              field_goals_attempted=EXCLUDED.field_goals_attempted,
              three_pointers_made=EXCLUDED.three_pointers_made,
              three_pointers_attempted=EXCLUDED.three_pointers_attempted,
              free_throws_made=EXCLUDED.free_throws_made,
              free_throws_attempted=EXCLUDED.free_throws_attempted,
              rebounds=EXCLUDED.rebounds, offensive_rebounds=EXCLUDED.offensive_rebounds,
              defensive_rebounds=EXCLUDED.defensive_rebounds,
              assists=EXCLUDED.assists, steals=EXCLUDED.steals, blocks=EXCLUDED.blocks,
              turnovers=EXCLUDED.turnovers, personal_fouls=EXCLUDED.personal_fouls,
              plus_minus=EXCLUDED.plus_minus, possessions=EXCLUDED.possessions,
              minutes=EXCLUDED.minutes, is_home=EXCLUDED.is_home, updated_at=now()
          `, [
            bbrefGameId, tid,
            s.points, s.field_goals_made, s.field_goals_attempted,
            s.three_pointers_made, s.three_pointers_attempted,
            s.free_throws_made, s.free_throws_attempted,
            s.rebounds, s.offensive_rebounds, s.defensive_rebounds,
            s.assists, s.steals, s.blocks, s.turnovers, s.personal_fouls, s.plus_minus,
            s.possessions, s.minutes, isHome,
          ]);
        }
        console.log(`   ✅ Aggregated team stats for ${teamIds.size} teams`);
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

