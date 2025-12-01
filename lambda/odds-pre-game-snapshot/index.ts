/**
 * Lambda Function: Pre-Game Odds Snapshot
 * 
 * Scheduled: Daily at 09:05 ET via EventBridge
 * Purpose: Fetch and store pre-game odds for all scheduled games
 * 
 * Environment Variables:
 * - SUPABASE_DB_URL (required)
 * - ODDS_API_KEY (required)
 * - ODDS_API_BASE (optional, defaults to https://api.the-odds-api.com/v4)
 * - PREFERRED_BOOKMAKER (optional, defaults to 'draftkings')
 */

// Load .env file for local testing (not needed in Lambda)
// Try to load from parent directory (project root) or current directory
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
    // Try default dotenv behavior
    require('dotenv').config();
  }
} catch {
  // dotenv not available, assume running in Lambda with env vars set
}

import { Pool } from 'pg';
import { z } from 'zod';

// ============================================
// CONFIGURATION
// ============================================

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const ODDS_API_KEY_ENV = process.env.ODDS_API_KEY;
const ODDS_API_BASE = process.env.ODDS_API_BASE || 'https://api.the-odds-api.com/v4';
const PREFERRED_BOOKMAKER = process.env.PREFERRED_BOOKMAKER || 'draftkings';

if (!SUPABASE_DB_URL) {
  throw new Error('Missing SUPABASE_DB_URL environment variable');
}

if (!ODDS_API_KEY_ENV) {
  throw new Error('Missing ODDS_API_KEY environment variable');
}

// After validation, TypeScript knows these are strings
const ODDS_API_KEY: string = ODDS_API_KEY_ENV;

// Clean and validate connection string
let cleanedDbUrl = SUPABASE_DB_URL.trim();
// Remove any trailing whitespace or newlines that might have been added
cleanedDbUrl = cleanedDbUrl.replace(/\s+$/, '').replace(/^\s+/, '');

// Validate connection string format
if (!cleanedDbUrl.startsWith('postgresql://') && !cleanedDbUrl.startsWith('postgres://')) {
  throw new Error(`Invalid connection string format. Must start with postgresql:// or postgres://. Got: ${cleanedDbUrl.substring(0, 20)}...`);
}

// Parse connection string to extract components for better error handling
let poolConfig: any = {
  connectionString: cleanedDbUrl,
  // Connection timeout settings
  connectionTimeoutMillis: 15000, // 15 seconds to establish connection (increased)
  idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
  max: 1, // Only 1 connection for Lambda (pooling handled by Supabase)
  // SSL is required for Supabase
  ssl: {
    rejectUnauthorized: false // Supabase uses valid SSL certs, but this prevents cert validation issues
  }
};

// Try to parse the connection string to validate it
try {
  const url = new URL(cleanedDbUrl);
  console.log('Parsed connection URL:');
  console.log('  Protocol:', url.protocol);
  console.log('  Hostname:', url.hostname);
  console.log('  Port:', url.port);
  console.log('  Database:', url.pathname);
  
  // If hostname is empty or invalid, throw error
  if (!url.hostname || url.hostname.length === 0) {
    throw new Error(`Invalid hostname in connection string: "${url.hostname}"`);
  }
} catch (parseError: any) {
  console.error('Failed to parse connection string:', parseError.message);
  throw new Error(`Invalid connection string format: ${parseError.message}`);
}

// Configure pool with connection timeouts and retry settings
const pool = new Pool(poolConfig);

// ============================================
// ZOD SCHEMAS (same as test script)
// ============================================

const OutcomeSchema = z.object({
  name: z.string(),
  price: z.number().int(),
  point: z.number().optional(),
  description: z.string().optional(),
});

const MarketSchema = z.object({
  key: z.string(),
  last_update: z.string().optional(),
  outcomes: z.array(OutcomeSchema),
});

const BookmakerSchema = z.object({
  key: z.string(),
  title: z.string(),
  last_update: z.string().optional(),
  markets: z.array(MarketSchema),
});

const OddsEventSchema = z.object({
  id: z.string(),
  sport_key: z.string(),
  sport_title: z.string(),
  commence_time: z.string(),
  home_team: z.string(),
  away_team: z.string(),
  bookmakers: z.array(BookmakerSchema).optional(),
});

const OddsApiResponseSchema = z.array(OddsEventSchema);

// ============================================
// TEAM NAME MAPPING (same as test script)
// ============================================

const ODDS_API_TEAM_TO_ABBR: Record<string, string> = {
  'Atlanta Hawks': 'ATL',
  'Boston Celtics': 'BOS',
  'Brooklyn Nets': 'BRK',
  'Charlotte Hornets': 'CHO',
  'Chicago Bulls': 'CHI',
  'Cleveland Cavaliers': 'CLE',
  'Dallas Mavericks': 'DAL',
  'Denver Nuggets': 'DEN',
  'Detroit Pistons': 'DET',
  'Golden State Warriors': 'GSW',
  'Houston Rockets': 'HOU',
  'Indiana Pacers': 'IND',
  'Los Angeles Clippers': 'LAC',
  'LA Clippers': 'LAC',
  'Los Angeles Lakers': 'LAL',
  'Memphis Grizzlies': 'MEM',
  'Miami Heat': 'MIA',
  'Milwaukee Bucks': 'MIL',
  'Minnesota Timberwolves': 'MIN',
  'New Orleans Pelicans': 'NOP',
  'New York Knicks': 'NYK',
  'Oklahoma City Thunder': 'OKC',
  'Orlando Magic': 'ORL',
  'Philadelphia 76ers': 'PHI',
  'Phoenix Suns': 'PHO',
  'Portland Trail Blazers': 'POR',
  'Sacramento Kings': 'SAC',
  'San Antonio Spurs': 'SAS',
  'Toronto Raptors': 'TOR',
  'Utah Jazz': 'UTA',
  'Washington Wizards': 'WAS',
};

function getTeamAbbr(teamName: string): string | null {
  return ODDS_API_TEAM_TO_ABBR[teamName] || null;
}

// ============================================
// MARKET TYPE MAPPING
// ============================================

function mapMarketKeyToType(marketKey: string): 'moneyline' | 'spread' | 'total' | 'player_prop' | null {
  const mapping: Record<string, 'moneyline' | 'spread' | 'total' | 'player_prop'> = {
    'h2h': 'moneyline',
    'spreads': 'spread',
    'totals': 'total',
    'player_points': 'player_prop',
    'player_rebounds': 'player_prop',
    'player_assists': 'player_prop',
  };
  return mapping[marketKey] || null;
}

/**
 * Extract stat type from market key
 * Example: 'player_points' -> 'points'
 */
function getStatTypeFromMarketKey(marketKey: string): string | null {
  if (marketKey.startsWith('player_')) {
    return marketKey.replace('player_', '');
  }
  return null;
}

// ============================================
// GET TODAY'S GAMES FROM BBREF_SCHEDULE
// ============================================

async function getTodaysGamesFromSchedule(): Promise<Array<{
  game_id: string;
  home_team_abbr: string;
  away_team_abbr: string;
  game_date: string;
}>> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  
  const result = await pool.query(`
    SELECT 
      COALESCE(canonical_game_id, bbref_game_id) as game_id,
      home_team_abbr,
      away_team_abbr,
      game_date::text as game_date
    FROM bbref_schedule
    WHERE game_date = $1::date
    ORDER BY COALESCE(start_time, game_date::timestamptz) ASC
  `, [today]);

  return result.rows;
}

// ============================================
// FETCH TEAM ODDS FROM API
// ============================================

async function fetchTeamOdds(): Promise<z.infer<typeof OddsApiResponseSchema>> {
  // Validate ODDS_API_BASE
  if (!ODDS_API_BASE || !ODDS_API_BASE.startsWith('http')) {
    throw new Error(`Invalid ODDS_API_BASE: "${ODDS_API_BASE}". Must be a valid URL starting with http:// or https://`);
  }
  
  // Validate ODDS_API_KEY
  if (!ODDS_API_KEY) {
    throw new Error('ODDS_API_KEY is not set');
  }
  
  const apiUrl = `${ODDS_API_BASE}/sports/basketball_nba/odds`;
  console.log('Fetching odds from:', apiUrl.replace(/apiKey=[^&]+/, 'apiKey=***'));
  
  const url = new URL(apiUrl);
  url.searchParams.set('apiKey', ODDS_API_KEY);
  url.searchParams.set('regions', 'us');
  // Only fetch team odds here (player props require separate per-event calls)
  url.searchParams.set('markets', 'h2h,spreads,totals');
  url.searchParams.set('oddsFormat', 'american');
  url.searchParams.set('dateFormat', 'iso');

  console.log('Full URL (hidden key):', url.toString().replace(/apiKey=[^&]+/, 'apiKey=***'));
  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`Odds API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return OddsApiResponseSchema.parse(data);
}

// ============================================
// MAP EVENT TO GAME ID
// ============================================

async function findGameIdFromSchedule(
  homeTeamAbbr: string,
  awayTeamAbbr: string,
  gameDate: string
): Promise<string | null> {
  const dateObj = new Date(gameDate);
  const utcDateStr = dateObj.toISOString().split('T')[0];
  const etDateStr = new Date(dateObj.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    .toISOString()
    .split('T')[0];

  const result = await pool.query(
    `SELECT bbref_game_id, canonical_game_id, game_date
     FROM bbref_schedule
     WHERE (
       game_date = $1::date 
       OR game_date = $2::date
       OR game_date BETWEEN $1::date - INTERVAL '1 day' AND $1::date + INTERVAL '1 day'
     )
       AND home_team_abbr = $3
       AND away_team_abbr = $4
     ORDER BY ABS(EXTRACT(EPOCH FROM (COALESCE(start_time, game_date::timestamptz) - $5::timestamptz)))
     LIMIT 1`,
    [utcDateStr, etDateStr, homeTeamAbbr, awayTeamAbbr, gameDate]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0].canonical_game_id || result.rows[0].bbref_game_id;
}

// ============================================
// RESOLVE PLAYER ID FROM NAME
// ============================================

/**
 * Normalize player name for matching (handles suffixes, special chars, etc.)
 */
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
    // Normalize special characters
    .replace(/[áàâä]/g, 'a')
    .replace(/[éèêë]/g, 'e')
    .replace(/[íìîï]/g, 'i')
    .replace(/[óòôö]/g, 'o')
    .replace(/[úùûü]/g, 'u')
    .replace(/[ç]/g, 'c')
    .replace(/[ñ]/g, 'n')
    .toLowerCase();
}

/**
 * Resolve player_id from player name, using game context (home/away teams)
 * Uses fuzzy matching strategies similar to other scripts in the codebase
 */
async function resolvePlayerId(
  playerName: string,
  homeTeamAbbr: string,
  awayTeamAbbr: string
): Promise<string | null> {
  const nameParts = playerName.trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts[nameParts.length - 1] || '';
  
  const normalizedName = normalizePlayerName(playerName);
  
  // Strategy 1: Exact match with team context (most accurate)
  // Try home team first, then away team
  for (const teamAbbr of [homeTeamAbbr, awayTeamAbbr]) {
    const exactMatch = await pool.query(`
      SELECT p.player_id
      FROM players p
      JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
      JOIN teams t ON ptr.team_id = t.team_id
      WHERE LOWER(p.full_name) = LOWER($1)
        AND t.abbreviation = $2
      LIMIT 1
    `, [playerName, teamAbbr]);
    
    if (exactMatch.rows.length > 0) {
      return exactMatch.rows[0].player_id;
    }
  }
  
  // Strategy 2: Remove suffixes and match (handles "LeBron James Jr" vs "LeBron James")
  const nameWithoutSuffix = playerName
    .replace(/\s+Sr\.?$/i, '')
    .replace(/\s+Jr\.?$/i, '')
    .replace(/\s+II$/i, '')
    .replace(/\s+III$/i, '')
    .replace(/\s+IV$/i, '')
    .trim();
  
  if (nameWithoutSuffix !== playerName) {
    for (const teamAbbr of [homeTeamAbbr, awayTeamAbbr]) {
      const suffixMatch = await pool.query(`
        SELECT p.player_id
        FROM players p
        JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
        JOIN teams t ON ptr.team_id = t.team_id
        WHERE LOWER(p.full_name) = LOWER($1)
          AND t.abbreviation = $2
        LIMIT 1
      `, [nameWithoutSuffix, teamAbbr]);
      
      if (suffixMatch.rows.length > 0) {
        return suffixMatch.rows[0].player_id;
      }
    }
  }
  
  // Strategy 3: Normalized match (handles "J.R. Smith" vs "JR Smith")
  for (const teamAbbr of [homeTeamAbbr, awayTeamAbbr]) {
    const normalizedMatch = await pool.query(`
      SELECT p.player_id
      FROM players p
      JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
      JOIN teams t ON ptr.team_id = t.team_id
      WHERE LOWER(REPLACE(REPLACE(p.full_name, '.', ''), '''', '')) = $1
        AND t.abbreviation = $2
      LIMIT 1
    `, [normalizedName, teamAbbr]);
    
    if (normalizedMatch.rows.length > 0) {
      return normalizedMatch.rows[0].player_id;
    }
  }
  
  // Strategy 4: First + Last name match
  if (firstName && lastName && nameParts.length >= 2) {
    for (const teamAbbr of [homeTeamAbbr, awayTeamAbbr]) {
      const firstLastMatch = await pool.query(`
        SELECT p.player_id
        FROM players p
        JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
        JOIN teams t ON ptr.team_id = t.team_id
        WHERE LOWER(p.first_name) = LOWER($1)
          AND LOWER(p.last_name) = LOWER($2)
          AND t.abbreviation = $3
        LIMIT 1
      `, [firstName, lastName, teamAbbr]);
      
      if (firstLastMatch.rows.length > 0) {
        return firstLastMatch.rows[0].player_id;
      }
    }
  }
  
  // Strategy 5: Last name only (less accurate, but sometimes needed)
  if (lastName) {
    for (const teamAbbr of [homeTeamAbbr, awayTeamAbbr]) {
      const lastNameMatch = await pool.query(`
        SELECT p.player_id
        FROM players p
        JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
        JOIN teams t ON ptr.team_id = t.team_id
        WHERE LOWER(p.last_name) = LOWER($1)
          AND t.abbreviation = $2
        LIMIT 1
      `, [lastName, teamAbbr]);
      
      if (lastNameMatch.rows.length > 0) {
        return lastNameMatch.rows[0].player_id;
      }
    }
  }
  
  // Strategy 6: Try exact match without team filter (player might not be in roster yet)
  const noTeamExact = await pool.query(`
    SELECT p.player_id
    FROM players p
    WHERE LOWER(p.full_name) = LOWER($1)
    LIMIT 1
  `, [playerName]);
  
  if (noTeamExact.rows.length > 0) {
    return noTeamExact.rows[0].player_id;
  }
  
  // Strategy 7: Try normalized match without team filter
  const noTeamNormalized = await pool.query(`
    SELECT p.player_id
    FROM players p
    WHERE LOWER(REPLACE(REPLACE(p.full_name, '.', ''), '''', '')) = $1
    LIMIT 1
  `, [normalizedName]);
  
  if (noTeamNormalized.rows.length > 0) {
    return noTeamNormalized.rows[0].player_id;
  }
  
  // Strategy 8: Try first + last name without team filter
  if (firstName && lastName && nameParts.length >= 2) {
    const noTeamFirstLast = await pool.query(`
      SELECT p.player_id
      FROM players p
      WHERE LOWER(p.first_name) = LOWER($1)
        AND LOWER(p.last_name) = LOWER($2)
      LIMIT 1
    `, [firstName, lastName]);
    
    if (noTeamFirstLast.rows.length > 0) {
      return noTeamFirstLast.rows[0].player_id;
    }
  }
  
  // Strategy 9: Check if player has played in recent games for these teams
  // This helps catch players who might not be in rosters but have game stats
  for (const teamAbbr of [homeTeamAbbr, awayTeamAbbr]) {
    const recentGameMatch = await pool.query(`
      SELECT DISTINCT pgs.player_id
      FROM player_game_stats pgs
      JOIN players p ON pgs.player_id = p.player_id
      JOIN teams t ON pgs.team_id = t.team_id
      WHERE LOWER(p.full_name) = LOWER($1)
        AND t.abbreviation = $2
        AND pgs.game_id IN (
          SELECT game_id 
          FROM games 
          WHERE start_time > NOW() - INTERVAL '30 days'
          ORDER BY start_time DESC
          LIMIT 50
        )
      LIMIT 1
    `, [playerName, teamAbbr]);
    
    if (recentGameMatch.rows.length > 0) {
      return recentGameMatch.rows[0].player_id;
    }
  }
  
  // Player not found
  console.warn(`⚠️  Could not resolve player: "${playerName}" (teams: ${awayTeamAbbr} @ ${homeTeamAbbr})`);
  return null;
}

// ============================================
// STORE RAW PAYLOAD
// ============================================

async function storeStagingEvent(
  event: z.infer<typeof OddsEventSchema>,
  cursor: string
): Promise<number> {
  // Test connection first with a simple query
  try {
    await pool.query('SELECT 1');
  } catch (connError: any) {
    console.error('Database connection test failed:', connError.message);
    console.error('Connection error code:', connError.code);
    // Log connection string (masked) for debugging
    const maskedUrl = SUPABASE_DB_URL ? SUPABASE_DB_URL.replace(/:[^:@]+@/, ':****@').replace(/@[^:]+:/, '@****:') : 'NOT SET';
    console.error('Connection string (masked):', maskedUrl);
    throw new Error(`Database connection failed: ${connError.message || connError.code || 'Unknown error'}`);
  }
  
  const result = await pool.query(
    `INSERT INTO staging_events (source, kind, cursor, payload, fetched_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING id`,
    ['oddsapi', 'odds', cursor, JSON.stringify(event)]
  );

  return result.rows[0].id;
}

// ============================================
// INSERT MARKETS
// ============================================

async function insertMarket(params: {
  gameId: string;
  marketType: 'moneyline' | 'spread' | 'total' | 'player_prop';
  bookmaker: string;
  snapshotType: string;
  side: string | null;
  line: number | null;
  odds: number;
  providerId: string;
  rawData?: any;
  playerId?: string | null;
  statType?: string | null;
  statLine?: number | null;
}): Promise<void> {
  const { gameId, marketType, bookmaker, snapshotType, side, line, odds, providerId, rawData, playerId, statType, statLine } = params;

  if (snapshotType === 'pre_game' || snapshotType === 'closing') {
    // Check for existing market (handles both team markets and player props)
    const existing = await pool.query(
      `SELECT id FROM markets
       WHERE game_id = $1
         AND market_type = $2
         AND bookmaker = $3
         AND snapshot_type = $4
         AND COALESCE(side, '') = COALESCE($5, '')
         AND COALESCE(player_id, '') = COALESCE($6, '')
         AND COALESCE(stat_type, '') = COALESCE($7, '')`,
      [gameId, marketType, bookmaker, snapshotType, side, playerId || null, statType || null]
    );

    if (existing.rows.length > 0) {
      // Update existing market
      await pool.query(
        `UPDATE markets
         SET odds = $1,
             line = $2,
             stat_line = $3,
             updated_at = NOW(),
             fetched_at = NOW()
         WHERE id = $4`,
        [odds, line, statLine, existing.rows[0].id]
      );
    } else {
      // Insert new market
      await pool.query(
        `INSERT INTO markets (
          game_id, market_type, bookmaker, snapshot_type, side, line, odds,
          player_id, stat_type, stat_line,
          provider_id, raw_data, fetched_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
        [
          gameId, marketType, bookmaker, snapshotType, side || null, line || null, odds,
          playerId || null, statType || null, statLine || null,
          providerId, rawData ? JSON.stringify(rawData) : null
        ]
      );
    }
  } else {
    // For live/mid_game snapshots, always insert (no unique constraint)
    await pool.query(
      `INSERT INTO markets (
        game_id, market_type, bookmaker, snapshot_type, side, line, odds,
        player_id, stat_type, stat_line,
        provider_id, raw_data, fetched_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
      [
        gameId, marketType, bookmaker, snapshotType, side || null, line || null, odds,
        playerId || null, statType || null, statLine || null,
        providerId, rawData ? JSON.stringify(rawData) : null
      ]
    );
  }
}

// ============================================
// PROCESS EVENT
// ============================================

async function processEvent(
  event: z.infer<typeof OddsEventSchema>,
  stagingEventId: number,
  gameId: string
): Promise<{ processed: number; skipped: number; errors: number }> {
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  if (!event.bookmakers || event.bookmakers.length === 0) {
    console.warn(`No bookmakers for event ${event.id}`);
    skipped++;
    return { processed, skipped, errors };
  }

  // Process preferred bookmaker first, then others if needed
  const preferredBookmaker = event.bookmakers.find(b => b.key === PREFERRED_BOOKMAKER);
  const bookmakersToProcess = preferredBookmaker 
    ? [preferredBookmaker, ...event.bookmakers.filter(b => b.key !== PREFERRED_BOOKMAKER)]
    : event.bookmakers;

  for (const bookmaker of bookmakersToProcess) {
      for (const market of bookmaker.markets) {
      const marketType = mapMarketKeyToType(market.key);

      // Only process team markets (player props handled separately)
      if (!marketType || marketType === 'player_prop') {
        continue;
      }

      for (const outcome of market.outcomes) {
        try {
          let side: string | null = null;
          let line: number | null = null;

          if (marketType === 'moneyline' || marketType === 'spread') {
            // Team markets: moneyline or spread
            side = outcome.name === event.home_team ? 'home' : 'away';
            line = marketType === 'spread' ? outcome.point || null : null;
          } else if (marketType === 'total') {
            // Total (over/under)
            side = outcome.name.toLowerCase().includes('over') ? 'over' : 'under';
            line = outcome.point || null;
          }

          await insertMarket({
            gameId,
            marketType,
            bookmaker: bookmaker.key,
            snapshotType: 'pre_game',
            side,
            line,
            odds: outcome.price,
            providerId: event.id,
            rawData: market,
          });

          processed++;
        } catch (error) {
          console.error(`Error processing outcome:`, error);
          errors++;
        }
      }
    }
  }

  await pool.query(
    `UPDATE staging_events SET processed = true, processed_at = NOW() WHERE id = $1`,
    [stagingEventId]
  );

  return { processed, skipped, errors };
}

// ============================================
// PROCESS PLAYER PROPS
// ============================================

async function processPlayerProps(
  playerPropsData: any,
  gameId: string,
  eventId: string,
  homeAbbr: string,
  awayAbbr: string
): Promise<{ processed: number; skipped: number; errors: number }> {
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  if (!playerPropsData.bookmakers || playerPropsData.bookmakers.length === 0) {
    return { processed, skipped, errors };
  }

  // Process preferred bookmaker first, then others if needed
  const preferredBookmaker = playerPropsData.bookmakers.find((b: any) => b.key === PREFERRED_BOOKMAKER);
  const bookmakersToProcess = preferredBookmaker 
    ? [preferredBookmaker, ...playerPropsData.bookmakers.filter((b: any) => b.key !== PREFERRED_BOOKMAKER)]
    : playerPropsData.bookmakers;

  for (const bookmaker of bookmakersToProcess) {
    for (const market of bookmaker.markets || []) {
      // Only process player prop markets
      if (!market.key.startsWith('player_')) {
        continue;
      }

      const statType = getStatTypeFromMarketKey(market.key);
      if (!statType) {
        continue;
      }

      for (const outcome of market.outcomes || []) {
        try {
          let side: string | null = null;
          let statLine: number | null = null;
          let playerId: string | null = null;

          // IMPORTANT: For player props, the API structure is:
          // - outcome.name = "Over" or "Under" (the side)
          // - outcome.description = Player name (e.g., "LeBron James")
          const playerName = outcome.description || outcome.name;
          const sideName = (outcome.name || '').toLowerCase();
          
          // Handle Yes/No bets (double_double, triple_double, first_basket)
          if (market.key.includes('double_double') || market.key.includes('triple_double') || market.key.includes('first_basket')) {
            // For Yes/No props, check if name contains "yes" or "no"
            // Some bookmakers might have different structures
            side = sideName.includes('yes') || (!sideName.includes('no') && !outcome.point) ? 'yes' : 'no';
            statLine = null; // Yes/No bets don't have a line
          } else {
            // Over/Under bets - name is "Over" or "Under"
            side = sideName.includes('over') ? 'over' : 'under';
            statLine = outcome.point || null;
          }

          // Resolve player_id from player name (use description, not name)
          playerId = await resolvePlayerId(playerName, homeAbbr, awayAbbr);

          if (!playerId) {
            console.warn(`Skipping player prop: Could not resolve player "${outcome.name}" for ${statType}`);
            skipped++;
            continue;
          }

          await insertMarket({
            gameId,
            marketType: 'player_prop',
            bookmaker: bookmaker.key,
            snapshotType: 'pre_game',
            side,
            line: null, // Player props use stat_line, not line
            odds: outcome.price,
            providerId: eventId,
            rawData: market,
            playerId,
            statType,
            statLine,
          });

          processed++;
        } catch (error) {
          console.error(`Error processing player prop outcome:`, error);
          errors++;
        }
      }
    }
  }

  return { processed, skipped, errors };
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
  try {
    console.log('Starting pre-game odds snapshot...');
    console.log('Event:', JSON.stringify(event));
    
    // Verify environment variables are set (for debugging)
    console.log('Environment check:');
    console.log('- SUPABASE_DB_URL:', SUPABASE_DB_URL ? 'SET (length: ' + SUPABASE_DB_URL.length + ')' : 'MISSING');
    if (SUPABASE_DB_URL) {
      // Log connection string format (masked) to help debug
      const maskedUrl = SUPABASE_DB_URL.replace(/:[^:@]+@/, ':****@').replace(/@([^:]+):/, '@****:');
      console.log('  Connection string (masked):', maskedUrl);
      console.log('  Raw first 50 chars:', SUPABASE_DB_URL.substring(0, 50));
      console.log('  Raw last 20 chars:', SUPABASE_DB_URL.substring(Math.max(0, SUPABASE_DB_URL.length - 20)));
      // Check if it starts with postgresql://
      if (!SUPABASE_DB_URL.trim().startsWith('postgresql://') && !SUPABASE_DB_URL.trim().startsWith('postgres://')) {
        console.error('  ⚠️  WARNING: Connection string does not start with postgresql:// or postgres://');
        console.error('  Actual start:', JSON.stringify(SUPABASE_DB_URL.substring(0, 20)));
      } else {
        console.log('  ✅ Starts with postgresql:// or postgres://');
      }
      // Check for db. prefix
      if (SUPABASE_DB_URL.includes('@db.')) {
        console.log('  ✅ Has db. prefix (correct format)');
      } else if (SUPABASE_DB_URL.includes('@mbubzxjglvhaxikdghqb.')) {
        console.log('  ⚠️  Missing db. prefix - should be @db.mbubzxjglvhaxikdghqb.supabase.co');
      }
      // Check for hidden characters
      const hasNewlines = SUPABASE_DB_URL.includes('\n') || SUPABASE_DB_URL.includes('\r');
      if (hasNewlines) {
        console.error('  ⚠️  WARNING: Connection string contains newline characters!');
      }
    }
    console.log('- ODDS_API_KEY:', ODDS_API_KEY ? 'SET (length: ' + ODDS_API_KEY.length + ')' : 'MISSING');
    console.log('- ODDS_API_BASE:', ODDS_API_BASE || 'NOT SET (using default)');
    console.log('- PREFERRED_BOOKMAKER:', PREFERRED_BOOKMAKER);
    
    // Validate ODDS_API_BASE format
    if (ODDS_API_BASE && !ODDS_API_BASE.startsWith('http')) {
      throw new Error(`Invalid ODDS_API_BASE format: "${ODDS_API_BASE}". Must start with http:// or https://`);
    }

    // Get today's date in ET timezone
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    console.log(`Fetching odds for: ${today}`);

    // Step 1: Get today's games from bbref_schedule (source of truth)
    const scheduledGames = await getTodaysGamesFromSchedule();
    console.log(`Found ${scheduledGames.length} games scheduled for today in bbref_schedule`);

    if (scheduledGames.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No games scheduled for today',
          date: today,
          processed: 0,
        }),
      };
    }

    // Step 2: Fetch team odds from API (returns all upcoming games)
    const allEvents = await fetchTeamOdds();
    console.log(`Fetched ${allEvents.length} total events from Odds API`);

    // Step 3: Match API events to bbref_schedule games
    // Only process events that match games in our schedule
    const matchedEvents: Array<{ event: z.infer<typeof OddsEventSchema>; gameId: string }> = [];
    
    for (const scheduledGame of scheduledGames) {
      const homeAbbr = scheduledGame.home_team_abbr;
      const awayAbbr = scheduledGame.away_team_abbr;
      
      // Find matching event from API
      const matchingEvent = allEvents.find(event => {
        const eventHomeAbbr = getTeamAbbr(event.home_team);
        const eventAwayAbbr = getTeamAbbr(event.away_team);
        return eventHomeAbbr === homeAbbr && eventAwayAbbr === awayAbbr;
      });

      if (matchingEvent) {
        matchedEvents.push({
          event: matchingEvent,
          gameId: scheduledGame.game_id,
        });
      } else {
        console.warn(`No matching Odds API event found for: ${awayAbbr} @ ${homeAbbr}`);
      }
    }

    console.log(`Matched ${matchedEvents.length} events to scheduled games`);
    console.log(`Skipped ${scheduledGames.length - matchedEvents.length} games without Odds API data`);

    // Step 4: Process team odds for matched events
    let totalProcessed = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let playerPropsProcessed = 0;
    let playerPropsSkipped = 0;

    for (const { event: oddsEvent, gameId } of matchedEvents) {
      // Store raw team odds payload
      const stagingEventId = await storeStagingEvent(oddsEvent, today);
      
      // Process team odds (moneyline, spread, total)
      const result = await processEvent(oddsEvent, stagingEventId, gameId);
      totalProcessed += result.processed;
      totalSkipped += result.skipped;
      totalErrors += result.errors;

      // Step 5: Fetch and process player props for this event
      console.log(`Fetching player props for event: ${oddsEvent.id} (${getTeamAbbr(oddsEvent.away_team)} @ ${getTeamAbbr(oddsEvent.home_team)})`);
      const playerPropsData = await fetchPlayerPropsForEvent(oddsEvent.id);
      
      if (playerPropsData && playerPropsData.bookmakers) {
        // Process player props similar to team odds
        const propsResult = await processPlayerProps(playerPropsData, gameId, oddsEvent.id, getTeamAbbr(oddsEvent.home_team), getTeamAbbr(oddsEvent.away_team));
        playerPropsProcessed += propsResult.processed;
        playerPropsSkipped += propsResult.skipped;
        totalErrors += propsResult.errors;
      } else {
        console.log(`  No player props available for this event`);
        playerPropsSkipped++;
      }
    }

    const summary = {
      date: today,
      scheduledGames: scheduledGames.length,
      matchedEvents: matchedEvents.length,
      teamMarketsProcessed: totalProcessed,
      playerPropsProcessed: playerPropsProcessed,
      eventsSkipped: totalSkipped,
      playerPropsSkipped: playerPropsSkipped,
      errors: totalErrors,
      timestamp: new Date().toISOString(),
    };

    console.log('Summary:', JSON.stringify(summary, null, 2));

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        ...summary,
      }),
    };
  } catch (error: any) {
    console.error('Error in pre-game odds snapshot:', error);
    console.error('Error stack:', error?.stack);
    console.error('Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    
    // Handle errors that might not have a message property
    const errorMessage = error?.message || error?.toString() || 'Unknown error occurred';
    const errorDetails = {
      message: errorMessage,
      name: error?.name,
      code: error?.code,
    };
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: errorMessage,
        errorDetails: errorDetails,
        timestamp: new Date().toISOString(),
      }),
    };
  } finally {
    // Note: In Lambda, we don't close the pool to allow connection reuse
    // For local testing, we'll close it in the test runner
  }
};

// For local testing - run if executed directly
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('index.ts') || 
  process.argv[1].endsWith('index.js') ||
  process.argv[1].includes('odds-pre-game-snapshot')
);

if (isMainModule) {
  handler({}).then((result) => {
    console.log('\n=== Lambda Response ===');
    console.log(JSON.stringify(result, null, 2));
    // Close pool for local testing
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

