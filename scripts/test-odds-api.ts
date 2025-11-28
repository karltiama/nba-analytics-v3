/**
 * Test Odds API Integration
 * 
 * Fetches today's NBA odds from Odds API and stores them in the database.
 * 
 * Requirements:
 * - ODDS_API_KEY in .env file
 * - SUPABASE_DB_URL in .env file
 * - staging_events and markets tables must exist
 * - bbref_schedule must have today's games
 * 
 * Usage:
 *   tsx scripts/test-odds-api.ts
 * 
 * What it does:
 * 1. Fetches odds for today's NBA games from Odds API
 * 2. Stores raw payload in staging_events table
 * 3. Maps Odds API team names to bbref_schedule team abbreviations
 * 4. Finds game_id from bbref_schedule by matching teams and date
 * 5. Normalizes and inserts markets (moneyline, spread, total) into markets table
 * 6. Shows summary of inserted data
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { z } from 'zod';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

if (!ODDS_API_KEY) {
  console.error('Missing ODDS_API_KEY. Set it in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

// ============================================
// ZOD SCHEMAS
// ============================================

const OutcomeSchema = z.object({
  name: z.string(),
  price: z.number().int(), // American odds
  point: z.number().optional(), // For spreads/totals
  description: z.string().optional(), // For player props
});

const MarketSchema = z.object({
  key: z.string(), // 'h2h', 'spreads', 'totals', 'player_points', etc.
  last_update: z.string().optional(),
  outcomes: z.array(OutcomeSchema),
});

const BookmakerSchema = z.object({
  key: z.string(), // 'draftkings', 'fanduel', etc.
  title: z.string(),
  last_update: z.string().optional(),
  markets: z.array(MarketSchema),
});

const OddsEventSchema = z.object({
  id: z.string(), // Odds API event ID
  sport_key: z.string(),
  sport_title: z.string(),
  commence_time: z.string(), // ISO8601 datetime
  home_team: z.string(),
  away_team: z.string(),
  bookmakers: z.array(BookmakerSchema).optional(),
});

const OddsApiResponseSchema = z.array(OddsEventSchema);

// ============================================
// TEAM NAME MAPPING
// ============================================

// Map Odds API team names to bbref_schedule abbreviations
// Note: bbref_schedule uses different abbreviations than teams table in some cases:
// - Brooklyn: BRK (not BKN)
// - Charlotte: CHO (not CHA)
// - Phoenix: PHO (not PHX)
const ODDS_API_TEAM_TO_ABBR: Record<string, string> = {
  'Atlanta Hawks': 'ATL',
  'Boston Celtics': 'BOS',
  'Brooklyn Nets': 'BRK', // bbref uses BRK, not BKN
  'Charlotte Hornets': 'CHO', // bbref uses CHO, not CHA
  'Chicago Bulls': 'CHI',
  'Cleveland Cavaliers': 'CLE',
  'Dallas Mavericks': 'DAL',
  'Denver Nuggets': 'DEN',
  'Detroit Pistons': 'DET',
  'Golden State Warriors': 'GSW',
  'Houston Rockets': 'HOU',
  'Indiana Pacers': 'IND',
  'Los Angeles Clippers': 'LAC',
  'LA Clippers': 'LAC', // Alternative name
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
  'Phoenix Suns': 'PHO', // bbref uses PHO, not PHX
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
    'player_threes': 'player_prop',
    'player_steals': 'player_prop',
    'player_blocks': 'player_prop',
  };
  return mapping[marketKey] || null;
}

function mapMarketKeyToStatType(marketKey: string): string | null {
  const mapping: Record<string, string> = {
    'player_points': 'points',
    'player_rebounds': 'rebounds',
    'player_assists': 'assists',
    'player_threes': 'threes',
    'player_steals': 'steals',
    'player_blocks': 'blocks',
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

  console.log(`Fetching odds from: ${url.toString().replace(ODDS_API_KEY, '***')}`);

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`Odds API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const validated = OddsApiResponseSchema.parse(data);

  console.log(`Fetched ${validated.length} events from Odds API`);
  return validated;
}

// ============================================
// MAP EVENT TO GAME ID (via bbref_schedule)
// ============================================

async function findGameIdFromSchedule(
  homeTeamAbbr: string,
  awayTeamAbbr: string,
  gameDate: string
): Promise<string | null> {
  // Parse date from ISO8601 (UTC) and convert to ET date
  // Odds API returns UTC times, but bbref_schedule uses ET dates
  const dateObj = new Date(gameDate);
  
  // Convert UTC to ET (ET is UTC-5 or UTC-4 depending on DST)
  // For simplicity, we'll check both the UTC date and ET date
  const utcDateStr = dateObj.toISOString().split('T')[0];
  
  // Also try the date in ET timezone
  const etDateStr = new Date(dateObj.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    .toISOString()
    .split('T')[0];

  // Try matching by date (either UTC date or ET date) and team abbreviations
  // Also try matching within a day range in case of timezone issues
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

  // Prefer canonical_game_id if available, otherwise use bbref_game_id
  return result.rows[0].canonical_game_id || result.rows[0].bbref_game_id;
}

// ============================================
// STORE RAW PAYLOAD IN STAGING
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
  playerId?: string | null;
  statType?: string | null;
  statLine?: number | null;
  providerId: string;
  rawData?: any;
}): Promise<void> {
  const {
    gameId,
    marketType,
    bookmaker,
    snapshotType,
    side,
    line,
    odds,
    playerId,
    statType,
    statLine,
    providerId,
    rawData,
  } = params;

  // For pre_game/closing snapshots, use UPSERT pattern
  // For other snapshot types, just insert (allows multiple rows for line movement)
  if (snapshotType === 'pre_game' || snapshotType === 'closing') {
    // Check if row exists first, then update or insert
    const existing = await pool.query(
      `SELECT id FROM markets
       WHERE game_id = $1
         AND market_type = $2
         AND bookmaker = $3
         AND snapshot_type = $4
         AND COALESCE(side, '') = COALESCE($5, '')
         AND COALESCE(player_id, '') = COALESCE($6, '')
         AND COALESCE(stat_type, '') = COALESCE($7, '')`,
      [gameId, marketType, bookmaker, snapshotType, side, playerId, statType]
    );

    if (existing.rows.length > 0) {
      // Update existing
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
      // Insert new
      await pool.query(
        `INSERT INTO markets (
          game_id, market_type, bookmaker, snapshot_type, side, line, odds,
          player_id, stat_type, stat_line, provider_id, raw_data, fetched_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
        [
          gameId,
          marketType,
          bookmaker,
          snapshotType,
          side || null,
          line || null,
          odds,
          playerId || null,
          statType || null,
          statLine || null,
          providerId,
          rawData ? JSON.stringify(rawData) : null,
        ]
      );
    }
  } else {
    // For live/mid_game, always insert (track line movement)
    await pool.query(
      `INSERT INTO markets (
        game_id, market_type, bookmaker, snapshot_type, side, line, odds,
        player_id, stat_type, stat_line, provider_id, raw_data, fetched_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
      [
        gameId,
        marketType,
        bookmaker,
        snapshotType,
        side || null,
        line || null,
        odds,
        playerId || null,
        statType || null,
        statLine || null,
        providerId,
        rawData ? JSON.stringify(rawData) : null,
      ]
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

  // Map teams to abbreviations
  const homeAbbr = getTeamAbbr(event.home_team);
  const awayAbbr = getTeamAbbr(event.away_team);

  if (!homeAbbr || !awayAbbr) {
    console.warn(
      `   ⚠️  Could not map teams: "${event.home_team}" (${homeAbbr || '?'}) vs "${event.away_team}" (${awayAbbr || '?'})`
    );
    skipped++;
    return { processed, skipped, errors };
  }

  // Find game_id from bbref_schedule
  const gameId = await findGameIdFromSchedule(homeAbbr, awayAbbr, event.commence_time);

  if (!gameId) {
    console.warn(
      `   ⚠️  Could not find game in bbref_schedule: ${awayAbbr} @ ${homeAbbr} on ${event.commence_time}`
    );
    skipped++;
    return { processed, skipped, errors };
  }

      console.log(`   ✓ Found game: ${gameId} (${awayAbbr} @ ${homeAbbr})`);

      // Process each bookmaker
      if (!event.bookmakers || event.bookmakers.length === 0) {
        console.warn(`   ⚠️  No bookmakers for event ${event.id}`);
        skipped++;
        return { processed, skipped, errors };
      }

      console.log(`   📚 Found ${event.bookmakers.length} bookmaker(s)`);

      for (const bookmaker of event.bookmakers) {
        console.log(`   📖 Processing ${bookmaker.title} (${bookmaker.key})...`);
    for (const market of bookmaker.markets) {
      const marketType = mapMarketKeyToType(market.key);

      if (!marketType) {
        // Skip unsupported market types
        continue;
      }

      // Process each outcome
      for (const outcome of market.outcomes) {
        try {
          let side: string | null = null;
          let line: number | null = null;
          let statLine: number | null = null;
          let statType: string | null = null;

          if (marketType === 'moneyline' || marketType === 'spread') {
            // Determine if home or away
            side = outcome.name === event.home_team ? 'home' : 'away';
            line = marketType === 'spread' ? outcome.point || null : null;
          } else if (marketType === 'total') {
            // Over/under
            side = outcome.name.toLowerCase().includes('over') ? 'over' : 'under';
            line = outcome.point || null;
          } else if (marketType === 'player_prop') {
            // Player props
            side = outcome.description?.toLowerCase().includes('over') ? 'over' : 'under';
            statLine = outcome.point || null;
            statType = mapMarketKeyToStatType(market.key);
            // TODO: Resolve player_id from outcome.name (would need player mapping)
            // For now, skip player props
            console.warn(`   ⚠️  Skipping player prop: ${outcome.name} ${outcome.description}`);
            continue;
          }

          await insertMarket({
            gameId,
            marketType,
            bookmaker: bookmaker.key,
            snapshotType: 'pre_game',
            side,
            line,
            odds: outcome.price,
            statType,
            statLine,
            providerId: event.id,
            rawData: market,
          });

          processed++;
        } catch (error) {
          console.error(`   ✗ Error processing outcome:`, error);
          errors++;
        }
      }
    }
  }

  // Mark staging event as processed
  await pool.query(
    `UPDATE staging_events SET processed = true, processed_at = NOW() WHERE id = $1`,
    [stagingEventId]
  );

  return { processed, skipped, errors };
}

// ============================================
// MAIN
// ============================================

async function main() {
  const client = await pool.connect();

  try {
    console.log('=== Testing Odds API Integration ===\n');

    // Get today's date in ET timezone
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    console.log(`Fetching odds for: ${today}\n`);

    // Fetch odds from API
    const events = await fetchTodaysOdds();

    if (events.length === 0) {
      console.log('No events found for today.');
      return;
    }

    console.log(`\nProcessing ${events.length} events...\n`);

    await client.query('BEGIN');

    let totalProcessed = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const event of events) {
      console.log(`\n📊 Processing: ${event.away_team} @ ${event.home_team}`);
      console.log(`   Event ID: ${event.id}`);
      console.log(`   Commence Time: ${event.commence_time}`);

      // Store raw payload
      const stagingEventId = await storeStagingEvent(event, today);

      // Process and insert markets
      const result = await processEvent(event, stagingEventId);
      totalProcessed += result.processed;
      totalSkipped += result.skipped;
      totalErrors += result.errors;
    }

    await client.query('COMMIT');

    console.log('\n=== Summary ===');
    console.log(`Events fetched from API: ${events.length}`);
    console.log(`Markets inserted/updated: ${totalProcessed}`);
    console.log(`Events skipped (no game match): ${totalSkipped}`);
    console.log(`Errors: ${totalErrors}`);

    // Show breakdown by market type
    const marketBreakdown = await pool.query(
      `SELECT market_type, COUNT(*) as count
       FROM markets
       WHERE fetched_at > NOW() - INTERVAL '1 minute'
       GROUP BY market_type
       ORDER BY count DESC`
    );

    if (marketBreakdown.rows.length > 0) {
      console.log('\n=== Markets by Type ===');
      marketBreakdown.rows.forEach((row: any) => {
        console.log(`  ${row.market_type}: ${row.count}`);
      });
    }

    // Show breakdown by bookmaker
    const bookmakerBreakdown = await pool.query(
      `SELECT bookmaker, COUNT(*) as count
       FROM markets
       WHERE fetched_at > NOW() - INTERVAL '1 minute'
       GROUP BY bookmaker
       ORDER BY count DESC`
    );

    if (bookmakerBreakdown.rows.length > 0) {
      console.log('\n=== Markets by Bookmaker ===');
      bookmakerBreakdown.rows.forEach((row: any) => {
        console.log(`  ${row.bookmaker}: ${row.count}`);
      });
    }

    // Show sample of inserted data
    const sample = await pool.query(
      `SELECT 
        m.game_id,
        m.market_type,
        m.bookmaker,
        m.side,
        m.line,
        m.odds,
        bs.home_team_abbr || ' vs ' || bs.away_team_abbr as matchup
      FROM markets m
      JOIN bbref_schedule bs ON m.game_id = bs.bbref_game_id OR m.game_id = bs.canonical_game_id
      WHERE m.fetched_at > NOW() - INTERVAL '1 minute'
      ORDER BY m.fetched_at DESC
      LIMIT 10`
    );

    if (sample.rows.length > 0) {
      console.log('\n=== Sample Inserted Markets ===');
      sample.rows.forEach((row) => {
        const lineStr = row.line !== null ? ` ${row.line}` : '';
        console.log(
          `  ${row.matchup || row.game_id?.substring(0, 20)}: ${row.market_type} ${row.side || ''}${lineStr} @ ${row.odds > 0 ? '+' : ''}${row.odds} (${row.bookmaker})`
        );
      });
    }

    // Show staging events summary
    const stagingSummary = await pool.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE processed = true) as processed,
        COUNT(*) FILTER (WHERE processed = false) as unprocessed
       FROM staging_events
       WHERE source = 'oddsapi' 
         AND fetched_at > NOW() - INTERVAL '1 minute'`
    );

    if (stagingSummary.rows.length > 0) {
      const summary = stagingSummary.rows[0];
      console.log('\n=== Staging Events ===');
      console.log(`  Total: ${summary.total}`);
      console.log(`  Processed: ${summary.processed}`);
      if (summary.unprocessed > 0) {
        console.log(`  ⚠️  Unprocessed: ${summary.unprocessed}`);
      }
    }

    console.log('\n✅ Done! View results at: http://localhost:3000/admin/odds-debug');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});

