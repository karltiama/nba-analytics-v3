/**
 * Lambda Function: Box Score Scraper
 * 
 * Scheduled: Daily at 03:00 ET via EventBridge
 * Purpose: Scrape box scores from Basketball Reference for Final games without box scores
 * Uses HTML scraping with cheerio (same as scripts/scrape-basketball-reference.ts)
 * 
 * Environment Variables:
 * - SUPABASE_DB_URL (required)
 * - BBREF_SCRAPE_DELAY_MS (optional, default: 4000)
 * - MAX_GAMES_PER_RUN (optional, default: 50)
 */

// Load .env file for local testing (not needed in Lambda)
try {
  const path = require('path');
  const fs = require('fs');
  const rootEnv = path.join(__dirname, '../../.env');
  const localEnv = path.join(__dirname, '.env');
  
  if (fs.existsSync(rootEnv)) {
    require('dotenv').config({ path: rootEnv });
  } else if (fs.existsSync(localEnv)) {
    require('dotenv').config({ path: localEnv });
  } else {
    require('dotenv').config();
  }
} catch {
  // dotenv not available, assume running in Lambda with env vars set
}

import { Pool } from 'pg';
import * as cheerio from 'cheerio';

// ============================================
// CONFIGURATION
// ============================================

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const BASE_DELAY_MS = Number.parseInt(process.env.BBREF_SCRAPE_DELAY_MS || '4000', 10);
const MAX_GAMES_PER_RUN = Number.parseInt(process.env.MAX_GAMES_PER_RUN || '50', 10);
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

if (!SUPABASE_DB_URL) {
  throw new Error('Missing SUPABASE_DB_URL environment variable');
}

// Clean and validate connection string
let cleanedDbUrl = SUPABASE_DB_URL.trim();
cleanedDbUrl = cleanedDbUrl.replace(/\s+$/, '').replace(/^\s+/, '');

if (!cleanedDbUrl.startsWith('postgresql://') && !cleanedDbUrl.startsWith('postgres://')) {
  throw new Error(`Invalid connection string format. Must start with postgresql:// or postgres://. Got: ${cleanedDbUrl.substring(0, 20)}...`);
}

const poolConfig: any = {
  connectionString: cleanedDbUrl,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  max: 1,
  ssl: {
    rejectUnauthorized: false
  }
};

const pool = new Pool(poolConfig);

const BBREF_HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.basketball-reference.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function addJitter(delayMs: number): number {
  const jitter = Math.random() * delayMs * 0.2;
  return Math.floor(delayMs + jitter);
}

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = MAX_RETRIES,
): Promise<Response> {
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

// ============================================
// TEAM CODE MAPPING
// ============================================

export const TEAM_CODE_MAP: Record<string, string> = {
  'ATL': 'ATL', 'BOS': 'BOS', 'BKN': 'BRK', 'CHA': 'CHO', 'CHI': 'CHI',
  'CLE': 'CLE', 'DAL': 'DAL', 'DEN': 'DEN', 'DET': 'DET', 'GSW': 'GSW',
  'HOU': 'HOU', 'IND': 'IND', 'LAC': 'LAC', 'LAL': 'LAL', 'MEM': 'MEM',
  'MIA': 'MIA', 'MIL': 'MIL', 'MIN': 'MIN', 'NOP': 'NOP', 'NYK': 'NYK',
  'OKC': 'OKC', 'ORL': 'ORL', 'PHI': 'PHI', 'PHX': 'PHO', 'POR': 'POR',
  'SAC': 'SAC', 'SAS': 'SAS', 'TOR': 'TOR', 'UTA': 'UTA', 'WAS': 'WAS',
};

// ============================================
// DATABASE QUERIES
// ============================================

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
  const timeStr = '0000';
  return `bbref_${dateStr}${timeStr}_${awayAbbr}_${homeAbbr}`;
}

async function getTeamAbbreviations(gameId: string): Promise<{ 
  homeAbbr: string; 
  awayAbbr: string; 
  gameDate: Date | string;
  bbrefGameId: string;
  homeTeamId?: string;
  awayTeamId?: string;
} | null> {
  // First try bbref_schedule
  const bbrefScheduleResult = await pool.query(`
    SELECT 
      bs.home_team_abbr as home_abbr,
      bs.away_team_abbr as away_abbr,
      bs.game_date::text as game_date_et,
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
      bg.game_date::text as game_date_et,
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
      DATE((g.start_time AT TIME ZONE 'America/New_York'))::text as game_date_et,
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
  const homeTeamCode = TEAM_CODE_MAP[row.home_abbr];
  const awayTeamCode = TEAM_CODE_MAP[row.away_abbr];
  
  if (!homeTeamCode || !awayTeamCode) {
    return null;
  }
  
  const bbrefGameId = generateBbrefGameId(row.game_date_et, awayTeamCode, homeTeamCode);

  return {
    homeAbbr: row.home_abbr,
    awayAbbr: row.away_abbr,
    gameDate: row.game_date_et,
    bbrefGameId,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
  };
}

/**
 * Query for Final games without box scores in BBRef tables
 */
async function getGamesWithoutBoxScores(limit: number = MAX_GAMES_PER_RUN): Promise<Array<{
  game_id: string;
  home_abbr: string;
  away_abbr: string;
  game_date: string;
  start_time: Date;
}>> {
  const result = await pool.query(`
    SELECT DISTINCT
      g.game_id,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr,
      DATE((g.start_time AT TIME ZONE 'America/New_York'))::text as game_date,
      g.start_time
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE g.status = 'Final'
      AND g.status != 'Cancelled'
      AND g.status != 'Postponed'
      AND NOT EXISTS (
        SELECT 1 
        FROM bbref_schedule bs
        JOIN bbref_player_game_stats bpgs ON bs.bbref_game_id = bpgs.game_id
        WHERE bs.canonical_game_id = g.game_id
      )
    ORDER BY g.start_time ASC
    LIMIT $1
  `, [limit]);

  return result.rows;
}

// ============================================
// BASKETBALL REFERENCE SCRAPING
// ============================================

function constructBBRefURL(date: Date | string, homeTeamCode: string): string {
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
  return `https://www.basketball-reference.com/boxscores/${dateStr}0${homeTeamCode}.html`;
}

function parseMinutes(value: string | null | undefined): number | null {
  if (!value || value === '') return null;
  if (value.includes('Did Not') || value === 'DNP') return null;
  
  const parts = value.split(':');
  if (parts.length === 2) {
    const minutes = parseInt(parts[0], 10);
    const seconds = parseInt(parts[1], 10);
    if (!isNaN(minutes) && !isNaN(seconds)) {
      return minutes + seconds / 60;
    }
  }
  
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

function parseIntSafe(value: string | null | undefined): number | null {
  if (!value || value === '' || value === '-') return null;
  const num = parseInt(value, 10);
  return isNaN(num) ? null : num;
}

async function fetchBBRefBoxScore(date: Date | string, homeTeamCode: string): Promise<any | null> {
  const url = constructBBRefURL(date, homeTeamCode);
  console.log(`🌐 Fetching Basketball Reference: ${url}`);
  
  try {
    const response = await fetchWithRetry(url);
    const html = await response.text();
  
    // Basketball Reference sometimes wraps tables in HTML comments
    const htmlWithoutComments = html.replace(/<!--/g, '').replace(/-->/g, '');
    const $ = cheerio.load(htmlWithoutComments);
  
    const playerStats: any[] = [];
  
    // Look for tables with IDs ending in "-game-basic"
    $('table[id$="-game-basic"]').each((index, table) => {
      const $table = $(table);
      const tableId = $table.attr('id') || '';
      
      const teamMatch = tableId.match(/box-([A-Z]{3})-game-basic/);
      const teamCode = teamMatch ? teamMatch[1] : null;
      
      if (!teamCode) {
        return;
      }
      
      console.log(`   📊 Parsing table for team: ${teamCode}`);
      
      // Extract headers
      const headers: string[] = [];
      $table.find('thead tr').last().find('th, td').each((i, th) => {
        const text = $(th).text().trim();
        if (text && text !== '') {
          headers.push(text);
        }
      });
      
      let isStartersSection = true;
      let isReservesSection = false;
      
      // Extract player rows
      $table.find('tbody tr').each((rowIdx, row) => {
        const $row = $(row);
        const rowText = $row.text().trim();
        const firstCellText = $row.find('th, td').first().text().trim();
        
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
        
        if (rowText.includes('Team Totals') || firstCellText === 'Team Totals') {
          return;
        }
        
        if (rowText.includes('Did Not Play') || rowText.includes('Did Not Dress')) {
          return;
        }
        
        const playerData: any = {
          team_code: teamCode,
          source: 'basketball_reference',
          started: isStartersSection && !isReservesSection,
        };
        
        const nameCell = $row.find('th').first();
        const playerName = nameCell.text().trim();
        
        if (!playerName || playerName === '') {
          return;
        }
        
        playerData.player_name = playerName;
        
        // Extract stats from td cells
        const cells = $row.find('td').toArray();
        cells.forEach((cell, colIdx) => {
          const headerIndex = colIdx + 1;
          const header = headers[headerIndex];
          const value = $(cell).text().trim();
          
          if (!header || !value || value === '') return;
          
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
  
    // Calculate team scores
    const teamScores: Record<string, number> = {};
    for (const playerStat of playerStats) {
      const teamCode = playerStat.team_code;
      const points = playerStat.points || 0;
      if (!teamScores[teamCode]) {
        teamScores[teamCode] = 0;
      }
      teamScores[teamCode] += points;
    }
    
    const teamCodesFound = Object.keys(teamScores);
    
    await sleep(addJitter(BASE_DELAY_MS));
    
    return {
      source: 'basketball_reference',
      url,
      playerStats,
      date: typeof date === 'string' ? date : date.toISOString().split('T')[0],
      urlHomeTeamCode: homeTeamCode,
      teamScores,
      teamCodesFound,
    };
  } catch (error: any) {
    if (error.message && error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}

// ============================================
// PLAYER RESOLUTION
// ============================================

async function resolvePlayerId(playerName: string, teamCode: string): Promise<string | null> {
  // Map BBRef code to NBA abbreviation
  const nbaAbbr = Object.entries(TEAM_CODE_MAP).find(([_, code]) => code === teamCode)?.[0] || teamCode;
  
  // Try exact match
  const exactMatch = await pool.query(`
    SELECT p.player_id
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
  
  // Try fuzzy matching (last name)
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
    `, [lastName, nbaAbbr]);
    
    if (fuzzyMatch.rows.length > 0) {
      return fuzzyMatch.rows[0].player_id;
    }
  }
  
  return null;
}

async function resolveTeamId(teamCode: string): Promise<string | null> {
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

// ============================================
// PROCESS BOX SCORE
// ============================================

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
  const existing = await pool.query(`
    SELECT bbref_game_id FROM bbref_games WHERE bbref_game_id = $1
  `, [bbrefGameId]);
  
  if (existing.rows.length === 0) {
    await pool.query(`
      INSERT INTO bbref_games (
        bbref_game_id, game_date, home_team_abbr, away_team_abbr,
        home_team_id, away_team_id, home_score, away_score, status,
        created_at, updated_at
      ) VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, 
        CASE WHEN $7 IS NOT NULL AND $8 IS NOT NULL THEN 'Final' ELSE 'Scheduled' END,
        now(), now())
      ON CONFLICT (bbref_game_id) DO UPDATE SET
        home_score = COALESCE(EXCLUDED.home_score, bbref_games.home_score),
        away_score = COALESCE(EXCLUDED.away_score, bbref_games.away_score),
        status = CASE WHEN EXCLUDED.home_score IS NOT NULL AND EXCLUDED.away_score IS NOT NULL THEN 'Final' ELSE bbref_games.status END,
        updated_at = now()
    `, [bbrefGameId, gameDate, homeAbbr, awayAbbr, homeTeamId, awayTeamId, homeScore, awayScore]);
  } else if (homeScore !== null && awayScore !== null) {
    await pool.query(`
      UPDATE bbref_games 
      SET home_score = $1, away_score = $2, status = 'Final', updated_at = now()
      WHERE bbref_game_id = $3
        AND (home_score IS NULL OR away_score IS NULL)
    `, [homeScore, awayScore, bbrefGameId]);
  }
}

async function processBBRefBoxScore(gameId: string): Promise<{ success: boolean; inserted: number; errors: string[] }> {
  const errors: string[] = [];
  let inserted = 0;
  
  try {
    const gameInfo = await getTeamAbbreviations(gameId);
    if (!gameInfo) {
      errors.push(`Could not find game ${gameId} in database`);
      return { success: false, inserted: 0, errors };
    }
    
    const { homeAbbr, awayAbbr, gameDate, bbrefGameId, homeTeamId, awayTeamId } = gameInfo;
    
    // homeAbbr and awayAbbr from bbref_schedule/bbref_games are already BBRef codes
    // If they came from games table, we need to map them
    const homeTeamCode = homeAbbr.length === 3 && (homeAbbr === 'CHO' || homeAbbr === 'BRK' || homeAbbr === 'PHO' || homeAbbr === 'NOP') 
      ? homeAbbr 
      : TEAM_CODE_MAP[homeAbbr] || homeAbbr;
    const awayTeamCode = awayAbbr.length === 3 && (awayAbbr === 'CHO' || awayAbbr === 'BRK' || awayAbbr === 'PHO' || awayAbbr === 'NOP')
      ? awayAbbr
      : TEAM_CODE_MAP[awayAbbr] || awayAbbr;
    
    if (!homeTeamCode || !awayTeamCode) {
      errors.push(`Unknown team code for ${homeAbbr} or ${awayAbbr}`);
      return { success: false, inserted: 0, errors };
    }
    
    const gameDateStr = typeof gameDate === 'string' ? gameDate : gameDate.toISOString().split('T')[0];
    console.log(`📊 Processing game ${gameId} (${awayAbbr} @ ${homeAbbr}, ${gameDateStr})...`);
    
    // Check if box score already exists in BBRef table
    const existingCheck = await pool.query(`
      SELECT COUNT(*) as count
      FROM bbref_player_game_stats
      WHERE game_id = $1
    `, [bbrefGameId]);
    
    if (parseInt(existingCheck.rows[0].count) > 0) {
      console.log(`   ⏭️  Box score already exists, skipping`);
      return { success: true, inserted: 0, errors: [] };
    }
    
    // Fetch box score - try home team first, then away team
    let boxScoreData = await fetchBBRefBoxScore(gameDate, homeTeamCode);
    
    if (!boxScoreData) {
      console.log(`   ⚠️  Game not found with home team, trying away team...`);
      boxScoreData = await fetchBBRefBoxScore(gameDate, awayTeamCode);
    }
    
    if (!boxScoreData || !boxScoreData.playerStats || boxScoreData.playerStats.length === 0) {
      errors.push(`No player stats found for game ${gameId}`);
      return { success: false, inserted: 0, errors };
    }
    
    console.log(`   ✅ Found ${boxScoreData.playerStats.length} player stat rows`);
    
    const { teamScores, teamCodesFound } = boxScoreData;
    // homeTeamCode and awayTeamCode are already BBRef codes at this point
    const homeTeamCodeBBRef = homeTeamCode;
    const awayTeamCodeBBRef = awayTeamCode;
    
    const homeScore = homeTeamCodeBBRef && teamScores[homeTeamCodeBBRef] !== undefined 
      ? teamScores[homeTeamCodeBBRef] 
      : null;
    const awayScore = awayTeamCodeBBRef && teamScores[awayTeamCodeBBRef] !== undefined 
      ? teamScores[awayTeamCodeBBRef] 
      : null;
    
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
      
      await client.query('COMMIT');
      console.log(`   ✅ Inserted ${inserted} player stats${skipped > 0 ? `, skipped ${skipped}` : ''}`);
      return { success: true, inserted, errors: [] };
    } catch (error: any) {
      await client.query('ROLLBACK');
      errors.push(`Database error: ${error.message}`);
      return { success: false, inserted: 0, errors };
    } finally {
      client.release();
    }
  } catch (error: any) {
    errors.push(`Scraping error: ${error.message}`);
    return { success: false, inserted: 0, errors };
  }
}

// ============================================
// LAMBDA HANDLER
// ============================================

interface LambdaEvent {
  source?: string;
  'detail-type'?: string;
  time?: string;
}

export const handler = async (event: LambdaEvent) => {
  const startTime = Date.now();
  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalInserted = 0;
  const allErrors: string[] = [];
  
  try {
    console.log('Starting box score scraping Lambda...');
    console.log('Event:', JSON.stringify(event));
    
    // Get games to process
    const games = await getGamesWithoutBoxScores(MAX_GAMES_PER_RUN);
    console.log(`Found ${games.length} Final games without box scores`);
    
    if (games.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'No games to process',
          processed: 0,
          timestamp: new Date().toISOString(),
        }),
      };
    }
    
    // Process each game
    for (const game of games) {
      console.log(`\n[${totalProcessed + 1}/${games.length}] Processing game: ${game.game_id}`);
      
      try {
        const result = await processBBRefBoxScore(game.game_id);
        
        if (result.success) {
          totalSuccess++;
          totalInserted += result.inserted;
          console.log(`✅ Success: Inserted ${result.inserted} player stats`);
        } else {
          totalFailed++;
          allErrors.push(`Game ${game.game_id}: ${result.errors.join('; ')}`);
          console.error(`❌ Failed: ${result.errors.join('; ')}`);
        }
        
        totalProcessed++;
        
        // Rate limiting between games
        if (totalProcessed < games.length) {
          await sleep(addJitter(BASE_DELAY_MS));
        }
      } catch (error: any) {
        totalFailed++;
        totalProcessed++;
        const errorMsg = `Game ${game.game_id}: ${error.message}`;
        allErrors.push(errorMsg);
        console.error(`❌ Error processing game ${game.game_id}:`, error);
      }
    }
    
    const duration = Date.now() - startTime;
    const summary = {
      success: true,
      processed: totalProcessed,
      successful: totalSuccess,
      failed: totalFailed,
      totalInserted,
      errors: allErrors.slice(0, 10),
      errorCount: allErrors.length,
      durationMs: duration,
      timestamp: new Date().toISOString(),
    };
    
    console.log('\n=== Summary ===');
    console.log(JSON.stringify(summary, null, 2));
    
    return {
      statusCode: 200,
      body: JSON.stringify(summary),
    };
  } catch (error: any) {
    console.error('Fatal error in Lambda:', error);
    console.error('Error stack:', error?.stack);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Unknown error',
        timestamp: new Date().toISOString(),
      }),
    };
  }
};

// For local testing
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('index.ts') || 
  process.argv[1].endsWith('index.js') ||
  process.argv[1].includes('boxscore-scraper')
);

if (isMainModule) {
  handler({}).then((result) => {
    console.log('\n=== Lambda Response ===');
    console.log(JSON.stringify(result, null, 2));
    pool.end().then(() => {
      console.log('\n✅ Test completed successfully');
      process.exit(0);
    }).catch((err) => {
      console.error('Error closing pool:', err);
      process.exit(1);
    });
  }).catch((error) => {
    console.error('Error:', error);
    pool.end().finally(() => {
      process.exit(1);
    });
  });
}
