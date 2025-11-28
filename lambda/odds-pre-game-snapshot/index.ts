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

import { Pool } from 'pg';
import { z } from 'zod';

// ============================================
// CONFIGURATION
// ============================================

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_API_BASE = process.env.ODDS_API_BASE || 'https://api.the-odds-api.com/v4';
const PREFERRED_BOOKMAKER = process.env.PREFERRED_BOOKMAKER || 'draftkings';

if (!SUPABASE_DB_URL) {
  throw new Error('Missing SUPABASE_DB_URL environment variable');
}

if (!ODDS_API_KEY) {
  throw new Error('Missing ODDS_API_KEY environment variable');
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

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
  };
  return mapping[marketKey] || null;
}

// ============================================
// FETCH ODDS FROM API
// ============================================

async function fetchTodaysOdds(): Promise<z.infer<typeof OddsApiResponseSchema>> {
  const url = new URL(`${ODDS_API_BASE}/sports/basketball_nba/odds`);
  url.searchParams.set('apiKey', ODDS_API_KEY);
  url.searchParams.set('regions', 'us');
  url.searchParams.set('markets', 'h2h,spreads,totals');
  url.searchParams.set('oddsFormat', 'american');
  url.searchParams.set('dateFormat', 'iso');

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
// STORE RAW PAYLOAD
// ============================================

async function storeStagingEvent(
  event: z.infer<typeof OddsEventSchema>,
  cursor: string
): Promise<number> {
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
}): Promise<void> {
  const { gameId, marketType, bookmaker, snapshotType, side, line, odds, providerId, rawData } = params;

  if (snapshotType === 'pre_game' || snapshotType === 'closing') {
    const existing = await pool.query(
      `SELECT id FROM markets
       WHERE game_id = $1
         AND market_type = $2
         AND bookmaker = $3
         AND snapshot_type = $4
         AND COALESCE(side, '') = COALESCE($5, '')
         AND COALESCE(player_id, '') = ''
         AND COALESCE(stat_type, '') = ''`,
      [gameId, marketType, bookmaker, snapshotType, side]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE markets
         SET odds = $1,
             line = $2,
             updated_at = NOW(),
             fetched_at = NOW()
         WHERE id = $3`,
        [odds, line, existing.rows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO markets (
          game_id, market_type, bookmaker, snapshot_type, side, line, odds,
          provider_id, raw_data, fetched_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [gameId, marketType, bookmaker, snapshotType, side || null, line || null, odds, providerId, rawData ? JSON.stringify(rawData) : null]
      );
    }
  } else {
    await pool.query(
      `INSERT INTO markets (
        game_id, market_type, bookmaker, snapshot_type, side, line, odds,
        provider_id, raw_data, fetched_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [gameId, marketType, bookmaker, snapshotType, side || null, line || null, odds, providerId, rawData ? JSON.stringify(rawData) : null]
    );
  }
}

// ============================================
// PROCESS EVENT
// ============================================

async function processEvent(
  event: z.infer<typeof OddsEventSchema>,
  stagingEventId: number
): Promise<{ processed: number; skipped: number; errors: number }> {
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  const homeAbbr = getTeamAbbr(event.home_team);
  const awayAbbr = getTeamAbbr(event.away_team);

  if (!homeAbbr || !awayAbbr) {
    console.warn(`Could not map teams: "${event.home_team}" vs "${event.away_team}"`);
    skipped++;
    return { processed, skipped, errors };
  }

  const gameId = await findGameIdFromSchedule(homeAbbr, awayAbbr, event.commence_time);

  if (!gameId) {
    console.warn(`Could not find game: ${awayAbbr} @ ${homeAbbr} on ${event.commence_time}`);
    skipped++;
    return { processed, skipped, errors };
  }

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

      if (!marketType) {
        continue;
      }

      for (const outcome of market.outcomes) {
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
// LAMBDA HANDLER
// ============================================

interface LambdaEvent {
  source?: string;
  'detail-type'?: string;
  time?: string;
}

export const handler = async (event: LambdaEvent) => {
  const client = await pool.connect();

  try {
    console.log('Starting pre-game odds snapshot...');
    console.log('Event:', JSON.stringify(event));

    // Get today's date in ET timezone
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    console.log(`Fetching odds for: ${today}`);

    // Fetch odds from API
    const events = await fetchTodaysOdds();
    console.log(`Fetched ${events.length} events from Odds API`);

    if (events.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No events found for today',
          date: today,
          processed: 0,
        }),
      };
    }

    await client.query('BEGIN');

    let totalProcessed = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const oddsEvent of events) {
      const stagingEventId = await storeStagingEvent(oddsEvent, today);
      const result = await processEvent(oddsEvent, stagingEventId);
      totalProcessed += result.processed;
      totalSkipped += result.skipped;
      totalErrors += result.errors;
    }

    await client.query('COMMIT');

    const summary = {
      date: today,
      eventsFetched: events.length,
      marketsProcessed: totalProcessed,
      eventsSkipped: totalSkipped,
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
    await client.query('ROLLBACK');
    console.error('Error in pre-game odds snapshot:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
    };
  } finally {
    client.release();
    await pool.end();
  }
};

// For local testing
if (require.main === module) {
  handler({}).then((result) => {
    console.log('Result:', JSON.stringify(result, null, 2));
    process.exit(0);
  }).catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
}

