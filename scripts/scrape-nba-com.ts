import 'dotenv/config';
import { Pool } from 'pg';
import { z } from 'zod';
import * as cheerio from 'cheerio';

/**
 * NBA.com Web Scraper
 * 
 * This scraper accesses NBA.com's JSON endpoints directly (the same endpoints
 * the website uses). This is more reliable than HTML scraping and doesn't require
 * browser automation.
 * 
 * BEST PRACTICES IMPLEMENTED:
 * ✅ Rate limiting: 2+ seconds between requests (configurable via NBA_SCRAPE_DELAY_MS)
 * ✅ Jitter/randomization: Adds randomness to delays to avoid predictable patterns
 * ✅ Exponential backoff: Increases wait time on errors/rate limits
 * ✅ Request tracking: Limits to 1000 requests/hour (configurable via NBA_SCRAPE_MAX_PER_HOUR)
 * ✅ Proper headers: Mimics browser requests with Referer, User-Agent, etc.
 * ✅ Error handling: Respects Retry-After headers and handles 403/401 gracefully
 * ✅ Conservative defaults: Safer defaults that can be adjusted if needed
 * 
 * NBA.com uses these base URLs:
 * - Scoreboard: https://stats.nba.com/stats/scoreboardV2
 * - Box Score: https://stats.nba.com/stats/boxscoretraditionalv2
 * - Game Details: https://stats.nba.com/stats/boxscoresummaryv2
 * 
 * Environment Variables:
 *   NBA_SCRAPE_DELAY_MS - Delay between requests in ms (default: 2000)
 *   NBA_SCRAPE_MAX_PER_HOUR - Max requests per hour (default: 1000)
 * 
 * Usage:
 *   tsx scripts/scrape-nba-com.ts --scoreboard --date 2025-11-01
 *   tsx scripts/scrape-nba-com.ts --boxscore --game-id 0022500150
 *   tsx scripts/scrape-nba-com.ts --boxscore-html --game-id 0022500150  # HTML fallback
 *   tsx scripts/scrape-nba-com.ts --schedule --season 2025-26
 * 
 * NOTE: This script accesses public endpoints that NBA.com uses for their website.
 * Be respectful with rate limits. If you get 403 errors, increase delays.
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
// Conservative rate limiting: 2-3 seconds between requests (mimics human browsing)
// Can be overridden with NBA_SCRAPE_DELAY_MS env var
const BASE_DELAY_MS = Number.parseInt(process.env.NBA_SCRAPE_DELAY_MS || '2000', 10); // 2 seconds default
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const MAX_REQUESTS_PER_HOUR = Number.parseInt(process.env.NBA_SCRAPE_MAX_PER_HOUR || '1000', 10); // Safety limit

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

// NBA.com requires specific headers to work
const NBA_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nba.com/',
  'Origin': 'https://www.nba.com',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Track request rate to avoid overwhelming the server
let requestCount = 0;
let requestWindowStart = Date.now();
const REQUEST_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Add jitter to delays to avoid predictable patterns
 * Returns delay + random(0 to 20% of delay)
 */
function addJitter(delayMs: number): number {
  const jitter = Math.random() * delayMs * 0.2; // Up to 20% jitter
  return Math.floor(delayMs + jitter);
}

/**
 * Check if we're within rate limits
 */
function checkRateLimit(): void {
  const now = Date.now();
  
  // Reset window if hour has passed
  if (now - requestWindowStart > REQUEST_WINDOW_MS) {
    requestCount = 0;
    requestWindowStart = now;
  }
  
  // Check if we've exceeded max requests
  if (requestCount >= MAX_REQUESTS_PER_HOUR) {
    const waitTime = REQUEST_WINDOW_MS - (now - requestWindowStart);
    throw new Error(
      `Rate limit exceeded: ${requestCount} requests in this hour. ` +
      `Wait ${Math.ceil(waitTime / 1000 / 60)} minutes before retrying.`
    );
  }
  
  requestCount++;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = MAX_RETRIES,
): Promise<Response> {
  // Check rate limit before making request
  checkRateLimit();
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...NBA_HEADERS,
          ...(options.headers || {}),
        },
      });

      if (response.ok) {
        return response;
      }

      // Handle rate limiting (429 Too Many Requests)
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter 
          ? parseInt(retryAfter) * 1000 
          : RETRY_DELAY_MS * Math.pow(2, attempt); // Exponential backoff
        console.warn(`⚠️  Rate limited (429). Waiting ${Math.ceil(delay / 1000)}s before retry ${attempt + 1}/${retries}`);
        await sleep(addJitter(delay));
        continue;
      }

      // Handle service unavailable (503)
      if (response.status === 503) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(`⚠️  Service unavailable (503). Waiting ${Math.ceil(delay / 1000)}s before retry ${attempt + 1}/${retries}`);
        await sleep(addJitter(delay));
        continue;
      }

      // Handle forbidden/unauthorized (might indicate blocking)
      if (response.status === 403 || response.status === 401) {
        console.error(`❌ Access denied (${response.status}). This might indicate your IP is blocked.`);
        console.error('   Consider:');
        console.error('   - Increasing NBA_SCRAPE_DELAY_MS (currently ' + BASE_DELAY_MS + 'ms)');
        console.error('   - Waiting longer between requests');
        console.error('   - Checking if NBA.com has changed their access policies');
        throw new Error(`HTTP ${response.status}: Access denied`);
      }

      // For other errors, throw if last attempt
      if (attempt === retries) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Exponential backoff for other errors
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
 * Fetch scoreboard (games for a specific date)
 */
async function fetchScoreboard(date: string): Promise<any> {
  const url = new URL('https://stats.nba.com/stats/scoreboardV2');
  url.searchParams.set('GameDate', date);
  url.searchParams.set('LeagueID', '00');
  url.searchParams.set('DayOffset', '0');

  console.log(`📅 Fetching scoreboard for ${date}...`);
  const response = await fetchWithRetry(url.toString());
  const data = await response.json();
  
  // Add delay after request to be respectful
  await sleep(addJitter(BASE_DELAY_MS));

  return data;
}

/**
 * Fetch box score for a specific game
 */
async function fetchBoxScore(gameId: string): Promise<any> {
  const url = new URL('https://stats.nba.com/stats/boxscoretraditionalv2');
  url.searchParams.set('GameID', gameId);
  url.searchParams.set('EndPeriod', '10');
  url.searchParams.set('EndRange', '0');
  url.searchParams.set('RangeType', '0');
  url.searchParams.set('StartPeriod', '1');
  url.searchParams.set('StartRange', '0');

  console.log(`📊 Fetching box score for game ${gameId}...`);
  const response = await fetchWithRetry(url.toString());
  const data = await response.json();
  
  // Add delay after request
  await sleep(addJitter(BASE_DELAY_MS));

  return data;
}

/**
 * Fetch game summary (includes quarter scores, team totals)
 */
async function fetchGameSummary(gameId: string): Promise<any> {
  const url = new URL('https://stats.nba.com/stats/boxscoresummaryv2');
  url.searchParams.set('GameID', gameId);

  console.log(`📋 Fetching game summary for game ${gameId}...`);
  const response = await fetchWithRetry(url.toString());
  const data = await response.json();
  
  // Add delay after request
  await sleep(addJitter(BASE_DELAY_MS));

  return data;
}

/**
 * Get team abbreviations for a game to construct HTML box score URL
 */
async function getTeamAbbreviations(gameId: string): Promise<{ homeAbbr: string; awayAbbr: string } | null> {
  const result = await pool.query(`
    SELECT 
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE g.game_id = $1
  `, [gameId]);

  if (result.rows.length === 0) {
    return null;
  }

  return {
    homeAbbr: result.rows[0].home_abbr.toLowerCase(),
    awayAbbr: result.rows[0].away_abbr.toLowerCase(),
  };
}

/**
 * Fetch box score from NBA.com HTML page as fallback
 * URL format: https://www.nba.com/game/{away}-vs-{home}-{gameId}/box-score
 * Example: https://www.nba.com/game/det-vs-atl-0022500251/box-score
 */
async function fetchBoxScoreHTML(gameId: string): Promise<any> {
  // Get team abbreviations
  const teamAbbrs = await getTeamAbbreviations(gameId);
  if (!teamAbbrs) {
    throw new Error(`Could not find team abbreviations for game ${gameId}`);
  }

  // Construct URL: away-vs-home-gameId
  const url = `https://www.nba.com/game/${teamAbbrs.awayAbbr}-vs-${teamAbbrs.homeAbbr}-${gameId}/box-score`;
  
  console.log(`🌐 Fetching HTML box score from ${url}...`);
  
  const response = await fetchWithRetry(url, {
    headers: {
      ...NBA_HEADERS,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    },
  });

  const html = await response.text();
  const $ = cheerio.load(html);

  // NBA.com box score page structure:
  // The page likely has tables with player stats
  // We need to find the player stats tables (one for each team)
  
  // Try to find player stats tables
  // Common selectors: table, [data-testid], .BoxScore, etc.
  const playerStats: any[] = [];
  
  // Look for tables containing player stats
  // NBA.com typically uses data attributes or specific class names
  $('table').each((index, table) => {
    const $table = $(table);
    const headers: string[] = [];
    
    // Extract headers
    $table.find('thead th, thead td, tr:first-child th, tr:first-child td').each((i, th) => {
      const text = $(th).text().trim();
      if (text) headers.push(text);
    });

    // Extract rows (skip header row)
    $table.find('tbody tr, tr:not(:first-child)').each((rowIdx, row) => {
      const $row = $(row);
      const rowData: any = {};
      
      $row.find('td, th').each((colIdx, cell) => {
        const header = headers[colIdx] || `col_${colIdx}`;
        const text = $(cell).text().trim();
        rowData[header] = text;
      });

      // Only add rows that look like player stats (have common stat columns)
      if (rowData['MIN'] || rowData['PTS'] || rowData['REB'] || rowData['AST']) {
        playerStats.push(rowData);
      }
    });
  });

  // Alternative: Look for JSON data embedded in the page
  // NBA.com uses Next.js with embedded JSON in script tags
  // Try to find script tag with pageProps
  const scripts = $('script').toArray();
  for (const script of scripts) {
    const content = $(script).html() || '';
    
    // Look for Next.js pageProps data
    if (content.includes('"pageProps"') && content.includes('"props"')) {
      try {
        // Try to parse the entire script content as JSON
        let jsonData: any;
        if (content.trim().startsWith('{')) {
          jsonData = JSON.parse(content);
        } else {
          // Extract JSON object from script content
          const jsonMatch = content.match(/\{[\s\S]*"pageProps"[\s\S]*\}/);
          if (jsonMatch) {
            jsonData = JSON.parse(jsonMatch[0]);
          }
        }
        
        if (jsonData && jsonData.props && jsonData.props.pageProps) {
          const pageProps = jsonData.props.pageProps;
          
          // Look for box score data in various possible locations
          if (pageProps.gameData || pageProps.boxScore || pageProps.playerStats || pageProps.boxScoreTraditional) {
            console.log('   ✅ Found Next.js pageProps with game data');
            await sleep(addJitter(BASE_DELAY_MS));
            return {
              source: 'nextjs_pageprops',
              gameData: pageProps.gameData,
              boxScore: pageProps.boxScore || pageProps.boxScoreTraditional,
              playerStats: pageProps.playerStats,
              rawPageProps: pageProps,
            };
          }
        }
      } catch (e: any) {
        // Continue trying other scripts
        console.log(`   ⚠️  Failed to parse script with pageProps: ${e.message.substring(0, 50)}`);
      }
    }
  }
  
  // Fallback: Search all scripts for boxScore or playerStats
  for (const script of scripts) {
    const content = $(script).html() || '';
    
    // Try to find boxScore or playerStats keywords
    if (content.includes('boxScore') || content.includes('playerStats')) {
      try {
        // Look for JSON objects containing these keywords
        const jsonMatch = content.match(/\{[\s\S]*"boxScore"[\s\S]*\}/);
        if (jsonMatch) {
          const jsonData = JSON.parse(jsonMatch[0]);
          if (jsonData.boxScore || jsonData.playerStats) {
            console.log('   ✅ Found embedded JSON data');
            await sleep(addJitter(BASE_DELAY_MS));
            return jsonData;
          }
        }
      } catch (e) {
        // Continue trying other methods
      }
    }
  }

  // If we found player stats in tables, return them
  if (playerStats.length > 0) {
    console.log(`   ✅ Found ${playerStats.length} player stat rows in HTML tables`);
    await sleep(addJitter(BASE_DELAY_MS));
    return {
      playerStats,
      source: 'html_table',
    };
  }

  // Fallback: Try to find any data-testid attributes that might contain stats
  const dataElements: any = {};
  $('[data-testid]').each((i, el) => {
    const testId = $(el).attr('data-testid');
    const text = $(el).text().trim();
    if (testId && text) {
      dataElements[testId] = text;
    }
  });

  if (Object.keys(dataElements).length > 0) {
    console.log(`   ⚠️  Found ${Object.keys(dataElements).length} data-testid elements (may need parsing)`);
    await sleep(addJitter(BASE_DELAY_MS));
    return {
      dataElements,
      source: 'html_data_attributes',
      rawHtml: html.substring(0, 1000), // First 1000 chars for debugging
    };
  }

  throw new Error('Could not extract player stats from HTML page. Page structure may have changed.');
}

/**
 * Fetch box score with fallback: Try JSON API first, then HTML scraping
 */
async function fetchBoxScoreWithFallback(gameId: string): Promise<any> {
  try {
    // Try JSON API first (preferred method)
    console.log(`📊 Attempting JSON API for game ${gameId}...`);
    return await fetchBoxScore(gameId);
  } catch (error: any) {
    console.warn(`⚠️  JSON API failed: ${error.message}`);
    console.log(`   Falling back to HTML scraping...`);
    
    try {
      // Fallback to HTML scraping
      return await fetchBoxScoreHTML(gameId);
    } catch (htmlError: any) {
      throw new Error(`Both JSON API and HTML scraping failed. JSON: ${error.message}, HTML: ${htmlError.message}`);
    }
  }
}

/**
 * Parse scoreboard response and extract games
 */
function parseScoreboard(data: any): Array<{
  gameId: string;
  date: string;
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  season: string;
}> {
  if (!data.resultSets || data.resultSets.length === 0) {
    return [];
  }

  // ScoreboardV2 returns multiple result sets
  // resultSets[0] = GameHeader
  const gameHeader = data.resultSets[0];
  const headers = gameHeader.headers;
  const rows = gameHeader.rowSet || [];

  const games = rows.map((row: any[]) => {
    const game: any = {};
    headers.forEach((header: string, idx: number) => {
      game[header] = row[idx];
    });

    return {
      gameId: game.GAME_ID || game.GAME_ID?.toString(),
      date: game.GAME_DATE_EST || game.GAME_DATE_EST?.toString(),
      homeTeamId: game.HOME_TEAM_ID,
      awayTeamId: game.VISITOR_TEAM_ID,
      homeScore: game.HOME_TEAM_SCORE || null,
      awayScore: game.VISITOR_TEAM_SCORE || null,
      status: game.GAME_STATUS_TEXT || 'Scheduled',
      season: game.SEASON || game.SEASON?.toString(),
    };
  });

  return games;
}

/**
 * Store games from scoreboard into database
 */
async function storeScoreboardGames(games: ReturnType<typeof parseScoreboard>) {
  if (games.length === 0) {
    console.log('No games to store');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let stored = 0;
    for (const game of games) {
      // Get team IDs from provider_id_map
      const homeTeamResult = await client.query(
        `SELECT internal_id FROM provider_id_map 
         WHERE entity_type = 'team' AND provider = 'nba' AND provider_id = $1`,
        [game.homeTeamId.toString()]
      );
      const awayTeamResult = await client.query(
        `SELECT internal_id FROM provider_id_map 
         WHERE entity_type = 'team' AND provider = 'nba' AND provider_id = $1`,
        [game.awayTeamId.toString()]
      );

      if (homeTeamResult.rows.length === 0 || awayTeamResult.rows.length === 0) {
        console.warn(`Skipping game ${game.gameId}: team mapping not found`);
        continue;
      }

      const homeTeamId = homeTeamResult.rows[0].internal_id;
      const awayTeamId = awayTeamResult.rows[0].internal_id;

      // Parse date - NBA.com returns dates in format "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SS"
      let gameDate: Date;
      try {
        if (!game.date) {
          throw new Error('Missing date');
        }
        const dateStr = String(game.date).trim();
        // If date already includes time, use it; otherwise append midnight UTC
        if (dateStr.includes('T')) {
          gameDate = new Date(dateStr);
        } else {
          // NBA.com dates are in Eastern Time, but we'll store as UTC midnight
          gameDate = new Date(dateStr + 'T00:00:00Z');
        }
        if (isNaN(gameDate.getTime())) {
          throw new Error(`Invalid date format: ${dateStr}`);
        }
      } catch (error: any) {
        console.warn(`⚠️  Skipping game ${game.gameId}: Invalid date format "${game.date}" - ${error.message}`);
        continue;
      }

      // Determine status
      let status = 'Scheduled';
      if (game.status === 'Final' || game.status === 'FINAL') {
        status = 'Final';
      } else if (game.status && game.status.toLowerCase().includes('progress')) {
        status = 'InProgress';
      }

      // Upsert game
      await client.query(
        `INSERT INTO games (
          game_id, season, start_time, status, home_team_id, away_team_id, 
          home_score, away_score, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
        ON CONFLICT (game_id) DO UPDATE SET
          status = EXCLUDED.status,
          home_score = EXCLUDED.home_score,
          away_score = EXCLUDED.away_score,
          updated_at = now()`,
        [
          game.gameId,
          game.season,
          gameDate.toISOString(),
          status,
          homeTeamId,
          awayTeamId,
          game.homeScore,
          game.awayScore,
        ]
      );

      // Store provider mapping
      await client.query(
        `INSERT INTO provider_id_map (
          entity_type, internal_id, provider, provider_id, created_at, updated_at
        ) VALUES ('game', $1, 'nba', $2, now(), now())
        ON CONFLICT (entity_type, provider, provider_id) DO NOTHING`,
        [game.gameId, game.gameId]
      );

      stored++;
    }

    await client.query('COMMIT');
    console.log(`✅ Stored ${stored} games`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const scoreboardIndex = args.indexOf('--scoreboard');
  const boxscoreIndex = args.indexOf('--boxscore');
  const boxscoreHtmlIndex = args.indexOf('--boxscore-html');
  const scheduleIndex = args.indexOf('--schedule');
  const dateIndex = args.indexOf('--date');
  const gameIdIndex = args.indexOf('--game-id');
  const seasonIndex = args.indexOf('--season');

  try {
    if (scoreboardIndex !== -1) {
      // Fetch scoreboard for a specific date
      const date = dateIndex !== -1 && args[dateIndex + 1]
        ? args[dateIndex + 1]
        : new Date().toISOString().split('T')[0];

      const data = await fetchScoreboard(date);
      const games = parseScoreboard(data);
      console.log(`Found ${games.length} games for ${date}`);
      
      await storeScoreboardGames(games);
      
      console.log(`\n✅ Completed. Made ${requestCount} request(s) this hour.`);
      console.log(`   Rate limit: ${MAX_REQUESTS_PER_HOUR} requests/hour`);
    } else if (boxscoreIndex !== -1) {
      // Fetch box score for a specific game
      if (gameIdIndex === -1 || !args[gameIdIndex + 1]) {
        console.error('--game-id required for boxscore');
        process.exit(1);
      }

      const gameId = args[gameIdIndex + 1];
      const boxScoreData = await fetchBoxScore(gameId);
      const summaryData = await fetchGameSummary(gameId);

      console.log('Box Score Data:', JSON.stringify(boxScoreData, null, 2));
      console.log('\nSummary Data:', JSON.stringify(summaryData, null, 2));
    } else if (boxscoreHtmlIndex !== -1) {
      // Fetch box score using HTML scraping (fallback method)
      if (gameIdIndex === -1 || !args[gameIdIndex + 1]) {
        console.error('--game-id required for boxscore-html');
        process.exit(1);
      }

      const gameId = args[gameIdIndex + 1];
      const htmlBoxScoreData = await fetchBoxScoreHTML(gameId);

      console.log('\nHTML Box Score Data:', JSON.stringify(htmlBoxScoreData, null, 2));
      console.log('\n💡 Note: This is raw HTML parsing. Structure may need refinement.');
    } else if (scheduleIndex !== -1) {
      // Fetch schedule for a season (multiple dates)
      const season = seasonIndex !== -1 && args[seasonIndex + 1]
        ? args[seasonIndex + 1]
        : '2025-26';

      console.log(`Fetching schedule for season ${season}...`);
      console.log('This will fetch games day by day. Use --start-date and --end-date to limit range.');
      
      // TODO: Implement date range fetching
      console.log('Schedule fetching not yet implemented. Use --scoreboard --date for now.');
    } else {
      console.log('Usage:');
      console.log('  tsx scripts/scrape-nba-com.ts --scoreboard --date 2025-11-01');
      console.log('  tsx scripts/scrape-nba-com.ts --boxscore --game-id 0022500150');
      console.log('  tsx scripts/scrape-nba-com.ts --boxscore-html --game-id 0022500150');
      console.log('  tsx scripts/scrape-nba-com.ts --schedule --season 2025-26');
    }
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.message.includes('Rate limit exceeded')) {
      console.error('\n💡 Tips to avoid rate limiting:');
      console.error('   - Increase NBA_SCRAPE_DELAY_MS (currently ' + BASE_DELAY_MS + 'ms)');
      console.error('   - Reduce batch sizes');
      console.error('   - Run scripts during off-peak hours');
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

