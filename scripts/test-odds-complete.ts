/**
 * Complete Odds Test Script
 * 
 * Tests fetching both team odds and player props for today's games.
 * Uses bbref_schedule to determine which games to process.
 * 
 * Requirements:
 * - ODDS_API_KEY in .env file
 * - SUPABASE_DB_URL in .env file
 * - bbref_schedule must have today's games
 * 
 * Usage:
 *   npx tsx scripts/test-odds-complete.ts
 * 
 * What it does:
 * 1. Gets today's games from bbref_schedule
 * 2. Fetches team odds (single API call)
 * 3. Matches API events to scheduled games
 * 4. Fetches player props for matched games (per-event calls)
 * 5. Shows summary of what was fetched
 * 6. Optionally stores in database (set STORE_IN_DB=true)
 */

import 'dotenv/config';
import { Pool } from 'pg';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
// Configuration
const STORE_IN_DB = true;
const INCLUDE_PLAYER_PROPS = process.env.INCLUDE_PLAYER_PROPS !== 'false'; // Set to 'false' to skip player props

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

if (!ODDS_API_KEY) {
  console.error('Missing ODDS_API_KEY. Set it in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

// Team name to abbreviation mapping
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

function mapMarketKeyToType(marketKey: string): 'moneyline' | 'spread' | 'total' | 'player_prop' | null {
  const mapping: Record<string, 'moneyline' | 'spread' | 'total' | 'player_prop'> = {
    'h2h': 'moneyline',
    'spreads': 'spread',
    'totals': 'total',
  };
  return mapping[marketKey] || null;
}

function getStatTypeFromMarketKey(marketKey: string): string | null {
  if (marketKey.startsWith('player_')) {
    return marketKey.replace('player_', '');
  }
  return null;
}

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

async function resolvePlayerId(
  playerName: string,
  homeTeamAbbr: string,
  awayTeamAbbr: string
): Promise<string | null> {
  const nameParts = playerName.trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts[nameParts.length - 1] || '';
  
  const normalizedName = normalizePlayerName(playerName);
  
  // Strategy 1: Exact match with team context (check rosters)
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
  
  // Strategy 4: First + Last name with team context
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
  
  // Strategy 5: Last name only with team context (less accurate, but sometimes needed)
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
  
  return null;
}

async function storeStagingEvent(event: any, cursor: string): Promise<number> {
  const result = await pool.query(
    `INSERT INTO staging_events (source, kind, cursor, payload, fetched_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING id`,
    ['oddsapi', 'odds', cursor, JSON.stringify(event)]
  );
  return result.rows[0].id;
}

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

async function processTeamMarkets(event: any, gameId: string, stagingEventId: number): Promise<{ processed: number; skipped: number; errors: number }> {
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  if (!event.bookmakers || event.bookmakers.length === 0) {
    return { processed, skipped, errors };
  }

  const PREFERRED_BOOKMAKER = 'draftkings';
  const preferredBookmaker = event.bookmakers.find((b: any) => b.key === PREFERRED_BOOKMAKER);
  const bookmakersToProcess = preferredBookmaker 
    ? [preferredBookmaker, ...event.bookmakers.filter((b: any) => b.key !== PREFERRED_BOOKMAKER)]
    : event.bookmakers;

  for (const bookmaker of bookmakersToProcess) {
    for (const market of bookmaker.markets || []) {
      const marketType = mapMarketKeyToType(market.key);
      if (!marketType || marketType === 'player_prop') {
        continue;
      }

      for (const outcome of market.outcomes || []) {
        try {
          let side: string | null = null;
          let line: number | null = null;

          if (marketType === 'moneyline' || marketType === 'spread') {
            side = outcome.name === event.home_team ? 'home' : 'away';
            line = marketType === 'spread' ? outcome.point || null : null;
          } else if (marketType === 'total') {
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
        } catch (error: any) {
          console.error(`  Error processing team market:`, error.message);
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

  const PREFERRED_BOOKMAKER = 'draftkings';
  const preferredBookmaker = playerPropsData.bookmakers.find((b: any) => b.key === PREFERRED_BOOKMAKER);
  const bookmakersToProcess = preferredBookmaker 
    ? [preferredBookmaker, ...playerPropsData.bookmakers.filter((b: any) => b.key !== PREFERRED_BOOKMAKER)]
    : playerPropsData.bookmakers;

  // Count total outcomes for progress tracking
  let totalOutcomes = 0;
  for (const bookmaker of bookmakersToProcess) {
    for (const market of bookmaker.markets || []) {
      if (market.key.startsWith('player_')) {
        totalOutcomes += (market.outcomes || []).length;
      }
    }
  }

  let currentOutcome = 0;
  const progressInterval = setInterval(() => {
    if (totalOutcomes > 0) {
      const percent = Math.round((currentOutcome / totalOutcomes) * 100);
      process.stdout.write(`\r   ⏳ Progress: ${currentOutcome}/${totalOutcomes} (${percent}%)`);
    }
  }, 500); // Update every 500ms

  try {
    for (const bookmaker of bookmakersToProcess) {
      for (const market of bookmaker.markets || []) {
        if (!market.key.startsWith('player_')) {
          continue;
        }

        const statType = getStatTypeFromMarketKey(market.key);
        if (!statType) {
          continue;
        }

        for (const outcome of market.outcomes || []) {
          currentOutcome++;
          try {
            let side: string | null = null;
            let statLine: number | null = null;
            let playerId: string | null = null;

            // IMPORTANT: For player props, the API structure is:
            // - outcome.name = "Over" or "Under" (the side)
            // - outcome.description = Player name (e.g., "LeBron James")
            const playerName = outcome.description || outcome.name;
            const sideName = (outcome.name || '').toLowerCase();
            
            if (market.key.includes('double_double') || market.key.includes('triple_double') || market.key.includes('first_basket')) {
              // For Yes/No props, check if name contains "yes" or "no"
              // Some bookmakers might have different structures
              side = sideName.includes('yes') || (!sideName.includes('no') && !outcome.point) ? 'yes' : 'no';
              statLine = null;
            } else {
              // For Over/Under props, name is "Over" or "Under"
              side = sideName.includes('over') ? 'over' : 'under';
              statLine = outcome.point || null;
            }

            playerId = await resolvePlayerId(playerName, homeAbbr, awayAbbr);

            if (!playerId) {
              skipped++;
              continue;
            }

            await insertMarket({
              gameId,
              marketType: 'player_prop',
              bookmaker: bookmaker.key,
              snapshotType: 'pre_game',
              side,
              line: null,
              odds: outcome.price,
              providerId: eventId,
              rawData: market,
              playerId,
              statType,
              statLine,
            });

            processed++;
          } catch (error: any) {
            console.error(`\n  ❌ Error processing player prop:`, error.message);
            errors++;
          }
        }
      }
    }
  } finally {
    clearInterval(progressInterval);
    if (totalOutcomes > 0) {
      process.stdout.write(`\r   ✅ Completed: ${currentOutcome}/${totalOutcomes} outcomes processed\n`);
    }
  }

  return { processed, skipped, errors };
}

// Player prop markets to fetch
const PLAYER_PROP_MARKETS = [
  'player_points',
  'player_rebounds',
  'player_assists',
  'player_threes',
  'player_blocks',
  'player_double_double',
  'player_triple_double',
  'player_first_basket',
];

async function getTodaysGamesFromSchedule() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  
  const result = await pool.query(`
    SELECT 
      COALESCE(canonical_game_id, bbref_game_id) as game_id,
      bbref_game_id,
      home_team_abbr,
      away_team_abbr,
      game_date::text as game_date
    FROM bbref_schedule
    WHERE game_date = $1::date
    ORDER BY COALESCE(start_time, game_date::timestamptz) ASC
  `, [today]);

  return result.rows;
}

async function fetchTeamOdds() {
  const url = new URL(`${ODDS_API_BASE}/sports/basketball_nba/odds`);
  url.searchParams.set('apiKey', ODDS_API_KEY);
  url.searchParams.set('regions', 'us');
  url.searchParams.set('markets', 'h2h,spreads,totals');
  url.searchParams.set('oddsFormat', 'american');
  url.searchParams.set('dateFormat', 'iso');

  console.log('🔍 Fetching team odds...');
  const response = await fetch(url.toString());

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Team odds API error: ${response.status} ${response.statusText}\n${errorText}`);
  }

  const data = await response.json();
  console.log(`✅ Fetched ${data.length} events from Odds API\n`);
  return data;
}

async function fetchPlayerProps(eventId: string) {
  try {
    const url = new URL(`${ODDS_API_BASE}/sports/basketball_nba/events/${eventId}/odds`);
    url.searchParams.set('apiKey', ODDS_API_KEY);
    url.searchParams.set('regions', 'us');
    url.searchParams.set('markets', PLAYER_PROP_MARKETS.join(','));
    url.searchParams.set('oddsFormat', 'american');
    url.searchParams.set('dateFormat', 'iso');

    const response = await fetch(url.toString());

    if (!response.ok) {
      if (response.status === 404 || response.status === 422) {
        return null; // Player props not available
      }
      throw new Error(`Player props API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error: any) {
    console.warn(`  ⚠️  Error fetching player props: ${error.message}`);
    return null;
  }
}

async function main() {
  try {
    console.log('='.repeat(80));
    console.log('COMPLETE ODDS TEST - Team Odds + Player Props');
    console.log('='.repeat(80));
    console.log(`Store in DB: ${STORE_IN_DB ? 'YES ✅' : 'NO (test only)'}`);
    console.log(`Include Player Props: ${INCLUDE_PLAYER_PROPS ? 'YES ✅' : 'NO (team odds only)'}\n`);

    // Step 1: Get today's games from bbref_schedule
    const scheduledGames = await getTodaysGamesFromSchedule();
    console.log(`📅 Step 1: Found ${scheduledGames.length} games scheduled for today in bbref_schedule\n`);

    if (scheduledGames.length === 0) {
      console.log('⚠️  No games scheduled for today. Exiting.');
      return;
    }

    // Step 2: Fetch team odds
    const allEvents = await fetchTeamOdds();

    // Step 3: Match events to scheduled games
    const matchedGames: Array<{
      scheduledGame: any;
      event: any;
      gameId: string;
    }> = [];

    for (const scheduledGame of scheduledGames) {
      const homeAbbr = scheduledGame.home_team_abbr;
      const awayAbbr = scheduledGame.away_team_abbr;

      const matchingEvent = allEvents.find((event: any) => {
        const eventHomeAbbr = getTeamAbbr(event.home_team);
        const eventAwayAbbr = getTeamAbbr(event.away_team);
        return eventHomeAbbr === homeAbbr && eventAwayAbbr === awayAbbr;
      });

      if (matchingEvent) {
        matchedGames.push({
          scheduledGame,
          event: matchingEvent,
          gameId: scheduledGame.game_id,
        });
      } else {
        console.log(`⚠️  No matching Odds API event for: ${awayAbbr} @ ${homeAbbr}`);
      }
    }

    console.log(`\n✅ Step 2: Matched ${matchedGames.length} events to scheduled games\n`);

    // Step 4: Process each matched game
    let totalTeamMarkets = 0;
    let totalPlayerProps = 0;
    const gameSummaries: any[] = [];

    for (const { scheduledGame, event, gameId } of matchedGames) {
      const homeAbbr = scheduledGame.home_team_abbr;
      const awayAbbr = scheduledGame.away_team_abbr;
      const matchup = `${awayAbbr} @ ${homeAbbr}`;

      console.log(`\n${'─'.repeat(80)}`);
      console.log(`🎮 Game: ${matchup}`);
      console.log(`   Game ID: ${gameId}`);
      console.log(`   Event ID: ${event.id}`);

      // Count team markets
      let teamMarkets = 0;
      if (event.bookmakers && event.bookmakers.length > 0) {
        for (const bookmaker of event.bookmakers) {
          for (const market of bookmaker.markets || []) {
            if (['h2h', 'spreads', 'totals'].includes(market.key)) {
              teamMarkets += (market.outcomes || []).length;
            }
          }
        }
      }
      totalTeamMarkets += teamMarkets;
      console.log(`   Team Markets: ${teamMarkets} outcomes`);

      // Fetch player props (if enabled)
      let playerPropsCount = 0;
      const playerPropTypes = new Set<string>();

      if (INCLUDE_PLAYER_PROPS) {
        console.log(`   Fetching player props...`);
        const playerPropsData = await fetchPlayerProps(event.id);

        if (playerPropsData && playerPropsData.bookmakers) {
          for (const bookmaker of playerPropsData.bookmakers) {
            for (const market of bookmaker.markets || []) {
              if (market.key.startsWith('player_')) {
                playerPropTypes.add(market.key);
                playerPropsCount += (market.outcomes || []).length;
              }
            }
          }
          totalPlayerProps += playerPropsCount;
          console.log(`   ✅ Player Props: ${playerPropsCount} outcomes`);
          console.log(`   📊 Prop Types: ${Array.from(playerPropTypes).sort().join(', ')}`);
        } else {
          console.log(`   ⚠️  No player props available`);
        }
      } else {
        console.log(`   ⏭️  Player props skipped`);
      }

      gameSummaries.push({
        matchup,
        gameId,
        eventId: event.id,
        teamMarkets,
        playerPropsCount: playerPropsCount || 0,
        playerPropTypes: Array.from(playerPropTypes),
      });
    }

    // Summary
    console.log(`\n${'='.repeat(80)}`);
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`Scheduled Games: ${scheduledGames.length}`);
    console.log(`Matched Events: ${matchedGames.length}`);
    console.log(`Total Team Markets: ${totalTeamMarkets} outcomes`);
    console.log(`Total Player Props: ${totalPlayerProps} outcomes`);
    console.log(`\nAPI Calls Made:`);
    console.log(`  - Team Odds: 1 call`);
    console.log(`  - Player Props: ${matchedGames.length} calls`);
    console.log(`  - Total: ${1 + matchedGames.length} calls`);

    // Show per-game breakdown
    console.log(`\n${'─'.repeat(80)}`);
    console.log('PER-GAME BREAKDOWN');
    console.log('─'.repeat(80));
    for (const summary of gameSummaries) {
      console.log(`\n${summary.matchup}:`);
      console.log(`  Team Markets: ${summary.teamMarkets} outcomes`);
      console.log(`  Player Props: ${summary.playerPropsCount} outcomes`);
      if (summary.playerPropTypes.length > 0) {
        console.log(`  Prop Types: ${summary.playerPropTypes.join(', ')}`);
      }
    }

    // Store in database
    console.log(`\n${'─'.repeat(80)}`);
    console.log('STORING IN DATABASE...');
    console.log('─'.repeat(80));

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    let totalStoredTeamMarkets = 0;
    let totalStoredPlayerProps = 0;
    let totalSkippedPlayers = 0;
    let totalErrors = 0;

    for (const { scheduledGame, event, gameId } of matchedGames) {
      const homeAbbr = scheduledGame.home_team_abbr;
      const awayAbbr = scheduledGame.away_team_abbr;
      const matchup = `${awayAbbr} @ ${homeAbbr}`;

      console.log(`\n💾 Storing: ${matchup}`);

      // Store team odds
      const stagingEventId = await storeStagingEvent(event, today);
      const teamResult = await processTeamMarkets(event, gameId, stagingEventId);
      totalStoredTeamMarkets += teamResult.processed;
      totalErrors += teamResult.errors;
      console.log(`   ✅ Team Markets: ${teamResult.processed} stored`);

      // Store player props (if enabled)
      if (INCLUDE_PLAYER_PROPS) {
        console.log(`   📥 Fetching player props...`);
        const playerPropsData = await fetchPlayerProps(event.id);
        if (playerPropsData && playerPropsData.bookmakers) {
          console.log(`   🔄 Processing player props (this may take a minute)...`);
          const propsResult = await processPlayerProps(playerPropsData, gameId, event.id, homeAbbr, awayAbbr);
          totalStoredPlayerProps += propsResult.processed;
          totalSkippedPlayers += propsResult.skipped;
          totalErrors += propsResult.errors;
          console.log(`   ✅ Player Props: ${propsResult.processed} stored, ${propsResult.skipped} skipped (unresolved players)`);
        } else {
          console.log(`   ⚠️  No player props available`);
        }
      } else {
        console.log(`   ⏭️  Player props skipped (INCLUDE_PLAYER_PROPS=false)`);
      }
    }

    console.log(`\n${'─'.repeat(80)}`);
    console.log('STORAGE SUMMARY');
    console.log('─'.repeat(80));
    console.log(`Team Markets Stored: ${totalStoredTeamMarkets}`);
    console.log(`Player Props Stored: ${totalStoredPlayerProps}`);
    console.log(`Players Skipped (unresolved): ${totalSkippedPlayers}`);
    console.log(`Errors: ${totalErrors}`);

    // Verify storage
    const verifyResult = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE market_type != 'player_prop') as team_markets,
        COUNT(*) FILTER (WHERE market_type = 'player_prop') as player_props,
        COUNT(DISTINCT game_id) as games_with_odds
      FROM markets
      WHERE fetched_at > NOW() - INTERVAL '5 minutes'
    `);

    if (verifyResult.rows.length > 0) {
      const row = verifyResult.rows[0];
      console.log(`\n✅ Verification:`);
      console.log(`   Team Markets in DB: ${row.team_markets}`);
      console.log(`   Player Props in DB: ${row.player_props}`);
      console.log(`   Games with Odds: ${row.games_with_odds}`);
    }

    console.log(`\n✅ Test completed successfully!\n`);

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

