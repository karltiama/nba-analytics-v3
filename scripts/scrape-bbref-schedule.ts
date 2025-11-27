import 'dotenv/config';
import { Pool } from 'pg';
import * as cheerio from 'cheerio';

/**
 * Basketball Reference Schedule Scraper
 * 
 * Scrapes the schedule from Basketball Reference and stores it in bbref_schedule table
 * 
 * URL Format: https://www.basketball-reference.com/leagues/NBA_YYYY_games-MONTH.html
 * Example: https://www.basketball-reference.com/leagues/NBA_2026_games-november.html
 * 
 * Or full season: https://www.basketball-reference.com/leagues/NBA_YYYY_games.html
 * 
 * Rate limiting: 4 seconds between requests (15 requests/minute)
 * 
 * Usage:
 *   tsx scripts/scrape-bbref-schedule.ts --season 2026 --month november
 *   tsx scripts/scrape-bbref-schedule.ts --season 2026  # Full season
 *   tsx scripts/scrape-bbref-schedule.ts --season 2026 --start-date 2025-10-21 --end-date 2026-04-12
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const BASE_DELAY_MS = Number.parseInt(process.env.BBREF_SCRAPE_DELAY_MS || '4000', 10);
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

const BBREF_HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.basketball-reference.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url: string, retryCount = 0): Promise<Response> {
  try {
    const response = await fetch(url, { headers: BBREF_HEADERS });
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Page not found: ${url}`);
      }
      if (response.status === 429 || response.status === 403) {
        throw new Error(`Rate limited or blocked: ${response.status}`);
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return response;
  } catch (error: any) {
    if (retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * (retryCount + 1);
      console.log(`Retry ${retryCount + 1}/${MAX_RETRIES} after ${delay}ms...`);
      await sleep(delay);
      return fetchWithRetry(url, retryCount + 1);
    }
    throw error;
  }
}

function constructScheduleURL(season: number, month?: string): string {
  const year = season; // e.g., 2026 for 2025-26 season
  if (month) {
    return `https://www.basketball-reference.com/leagues/NBA_${year}_games-${month.toLowerCase()}.html`;
  }
  return `https://www.basketball-reference.com/leagues/NBA_${year}_games.html`;
}

// Team abbreviation mapping from Basketball Reference to our internal abbreviations
const TEAM_ABBR_MAP: Record<string, string> = {
  'ATL': 'ATL',
  'BOS': 'BOS',
  'BRK': 'BKN', // Brooklyn
  'BKN': 'BKN',
  'CHO': 'CHA', // Charlotte (Basketball Reference uses CHO)
  'CHA': 'CHA',
  'CHI': 'CHI',
  'CLE': 'CLE',
  'DAL': 'DAL',
  'DEN': 'DEN',
  'DET': 'DET',
  'GSW': 'GSW',
  'HOU': 'HOU',
  'IND': 'IND',
  'LAC': 'LAC',
  'LAL': 'LAL',
  'MEM': 'MEM',
  'MIA': 'MIA',
  'MIL': 'MIL',
  'MIN': 'MIN',
  'NOP': 'NOP',
  'NYK': 'NYK',
  'OKC': 'OKC',
  'ORL': 'ORL',
  'PHI': 'PHI',
  'PHO': 'PHX', // Phoenix
  'PHX': 'PHX',
  'POR': 'POR',
  'SAC': 'SAC',
  'SAS': 'SAS',
  'TOR': 'TOR',
  'UTA': 'UTA',
  'WAS': 'WAS',
};

async function resolveTeamId(abbr: string): Promise<string | null> {
  const normalizedAbbr = TEAM_ABBR_MAP[abbr] || abbr;
  const result = await pool.query(
    'SELECT team_id FROM teams WHERE abbreviation = $1',
    [normalizedAbbr]
  );
  return result.rows.length > 0 ? result.rows[0].team_id : null;
}

function parseDate(dateStr: string): Date | null {
  // Basketball Reference uses formats like "Mon, Nov 18, 2025" or "Nov 18, 2025"
  const cleaned = dateStr.trim();
  
  // Try parsing common formats
  const date = new Date(cleaned);
  if (!isNaN(date.getTime())) {
    return date;
  }
  
  return null;
}

/**
 * Parse start time from BBRef format (e.g., "7:00p", "7:30p ET", "8:00p")
 * Returns Date object in ET timezone (stored as UTC in database)
 */
function parseStartTime(gameDate: Date, timeStr: string): Date | null {
  if (!timeStr || timeStr.trim() === '') return null;
  
  // Remove "ET" or other timezone indicators
  const cleaned = timeStr.replace(/ET|PT|CT|MT|EST|PST|CST|MST/gi, '').trim();
  
  // Match patterns like "7:00p", "7:30p", "8:00p", "12:30p", "7:00pm"
  const match = cleaned.match(/(\d{1,2}):(\d{2})([ap]m?)/i);
  if (!match) return null;
  
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3].toLowerCase().replace('m', '');
  
  // Convert to 24-hour format
  if (ampm === 'p' && hours !== 12) {
    hours += 12;
  } else if (ampm === 'a' && hours === 12) {
    hours = 0;
  }
  
  // Create date string in ET timezone format
  // Format: YYYY-MM-DDTHH:MM:SS-05:00 (ET is UTC-5)
  const year = gameDate.getFullYear();
  const month = String(gameDate.getMonth() + 1).padStart(2, '0');
  const day = String(gameDate.getDate()).padStart(2, '0');
  const hoursStr = String(hours).padStart(2, '0');
  const minutesStr = String(minutes).padStart(2, '0');
  
  // Create ISO string with ET timezone offset
  const dateStr = `${year}-${month}-${day}T${hoursStr}:${minutesStr}:00-05:00`;
  const date = new Date(dateStr);
  
  if (isNaN(date.getTime())) {
    return null;
  }
  
  return date;
}

function generateBbrefGameId(date: Date, awayAbbr: string, homeAbbr: string): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `bbref_${year}${month}${day}0000_${awayAbbr}_${homeAbbr}`;
}

async function scrapeSchedulePage(season: number, month?: string, startDate?: Date, endDate?: Date): Promise<any[]> {
  const url = constructScheduleURL(season, month);
  console.log(`Fetching schedule from: ${url}`);
  
  const response = await fetchWithRetry(url);
  const html = await response.text();
  const $ = cheerio.load(html);
  
  const games: any[] = [];
  
  // Basketball Reference schedule tables have class "stats_table" or id starting with "schedule"
  const scheduleTables = $('table.stats_table, table[id^="schedule"]');
  
  if (scheduleTables.length === 0) {
    console.log('No schedule tables found. Checking all tables...');
    const allTables = $('table');
    console.log(`Found ${allTables.length} total tables`);
    allTables.slice(0, 3).each((idx, table) => {
      const $table = $(table);
      const id = $table.attr('id');
      const classes = $table.attr('class');
      console.log(`  Table ${idx + 1}: id="${id}", class="${classes}"`);
    });
  }
  
  scheduleTables.each((tableIdx, table) => {
    const $table = $(table);
    
    // Skip if this isn't a games table (check for date column)
    const hasDateColumn = $table.find('th').toArray().some(th => {
      const text = $(th).text().trim().toLowerCase();
      return text.includes('date') || text.includes('game');
    });
    
    if (!hasDateColumn) {
      console.log(`Skipping table ${tableIdx + 1} - no date column found`);
      return;
    }
    
    console.log(`Parsing schedule table ${tableIdx + 1}...`);
    
    // Extract headers
    const headers: string[] = [];
    $table.find('thead tr').last().find('th').each((i, th) => {
      headers.push($(th).text().trim());
    });
    
    console.log(`Headers found: ${headers.join(', ')}`);
    
    // Find column indices
    const dateIdx = headers.findIndex(h => h.toLowerCase().includes('date'));
    const visitorIdx = headers.findIndex(h => h.toLowerCase().includes('visitor'));
    const homeIdx = headers.findIndex(h => h.toLowerCase().includes('home'));
    const timeIdx = headers.findIndex(h => h.toLowerCase().includes('time') || h.toLowerCase().includes('start'));
    
    console.log(`Column indices - Date: ${dateIdx}, Visitor: ${visitorIdx}, Home: ${homeIdx}, Time: ${timeIdx}`);
    
    if (dateIdx === -1 || visitorIdx === -1 || homeIdx === -1) {
      console.log('Could not find required columns in schedule table');
      return;
    }
    
    // Parse game rows
    const rows = $table.find('tbody tr');
    console.log(`Found ${rows.length} rows in table`);
    
    let parsedCount = 0;
    rows.each((rowIdx, row) => {
      const $row = $(row);
      const cells = $row.find('td, th').toArray();
      
      // Skip header rows or rows with too few cells
      if (cells.length < Math.max(dateIdx, visitorIdx, homeIdx) + 1) {
        return;
      }
      
      const dateCell = $(cells[dateIdx]).text().trim();
      const visitorCell = $(cells[visitorIdx]).text().trim();
      const homeCell = $(cells[homeIdx]).text().trim();
      const timeCell = timeIdx !== -1 ? $(cells[timeIdx]).text().trim() : '';
      
      // Skip empty rows
      if (!dateCell || !visitorCell || !homeCell) {
        return;
      }
      
      // Skip if date cell looks like a header (e.g., "Date")
      if (dateCell.toLowerCase() === 'date' || dateCell.toLowerCase().includes('game')) {
        return;
      }
      
      // Extract team abbreviations - Basketball Reference uses links with team abbreviations
      // Try to find team abbreviation in links first (more reliable)
      const visitorLink = $(cells[visitorIdx]).find('a').attr('href');
      const homeLink = $(cells[homeIdx]).find('a').attr('href');
      
      let visitorAbbr: string | null = null;
      let homeAbbr: string | null = null;
      
      // Extract from link (format: /teams/ATL/2026.html)
      if (visitorLink) {
        const match = visitorLink.match(/\/teams\/([A-Z]{3})\//);
        if (match) {
          visitorAbbr = match[1];
        }
      }
      
      if (homeLink) {
        const match = homeLink.match(/\/teams\/([A-Z]{3})\//);
        if (match) {
          homeAbbr = match[1];
        }
      }
      
      // Fallback: try to extract from text
      if (!visitorAbbr) {
        const match = visitorCell.match(/([A-Z]{3})/);
        visitorAbbr = match ? match[1] : null;
      }
      
      if (!homeAbbr) {
        const match = homeCell.match(/([A-Z]{3})/);
        homeAbbr = match ? match[1] : null;
      }
      
      if (!visitorAbbr || !homeAbbr) {
        if (parsedCount < 3) {
          console.log(`Could not extract team abbreviations from row ${rowIdx + 1}: visitor="${visitorCell}", home="${homeCell}"`);
        }
        return;
      }
      
      const gameDate = parseDate(dateCell);
      if (!gameDate) {
        if (parsedCount < 3) {
          console.log(`Could not parse date from row ${rowIdx + 1}: "${dateCell}"`);
        }
        return;
      }
      
      // Parse start time if available
      let startTime: Date | null = null;
      if (timeCell && timeIdx !== -1) {
        startTime = parseStartTime(gameDate, timeCell);
      }
      
      // Filter by date range if provided
      if (startDate && gameDate < startDate) {
        return;
      }
      if (endDate && gameDate > endDate) {
        return;
      }
      
      games.push({
        date: gameDate,
        visitorAbbr,
        homeAbbr,
        startTime,
      });
      
      parsedCount++;
    });
    
    console.log(`Parsed ${parsedCount} games from table ${tableIdx + 1}`);
  });
  
  console.log(`Found ${games.length} games in schedule`);
  return games;
}

async function storeSchedule(games: any[], season: string): Promise<void> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    let inserted = 0;
    let updated = 0;
    let errors = 0;
    
    for (const game of games) {
      try {
        const homeTeamId = await resolveTeamId(game.homeAbbr);
        const awayTeamId = await resolveTeamId(game.visitorAbbr);
        
        if (!homeTeamId || !awayTeamId) {
          console.log(`Skipping ${game.visitorAbbr} @ ${game.homeAbbr} - could not resolve team IDs`);
          errors++;
          continue;
        }
        
        const gameDate = new Date(game.date);
        gameDate.setHours(0, 0, 0, 0);
        const dateStr = gameDate.toISOString().split('T')[0];
        
        const bbrefGameId = generateBbrefGameId(gameDate, game.visitorAbbr, game.homeAbbr);
        
        // Prepare start_time
        const startTimeISO = game.startTime ? game.startTime.toISOString() : null;
        
        const result = await client.query(`
          INSERT INTO bbref_schedule (
            bbref_game_id,
            game_date,
            start_time,
            home_team_abbr,
            away_team_abbr,
            home_team_id,
            away_team_id,
            season
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (bbref_game_id) DO UPDATE SET
            game_date = excluded.game_date,
            start_time = COALESCE(bbref_schedule.start_time, excluded.start_time),
            home_team_abbr = excluded.home_team_abbr,
            away_team_abbr = excluded.away_team_abbr,
            home_team_id = excluded.home_team_id,
            away_team_id = excluded.away_team_id,
            season = excluded.season,
            updated_at = now()
          RETURNING (xmax = 0) as is_new
        `, [
          bbrefGameId,
          dateStr,
          startTimeISO,
          game.homeAbbr,
          game.visitorAbbr,
          homeTeamId,
          awayTeamId,
          season,
        ]);
        
        if (result.rows[0].is_new) {
          inserted++;
        } else {
          updated++;
        }
      } catch (error: any) {
        console.error(`Error storing game ${game.visitorAbbr} @ ${game.homeAbbr}: ${error.message}`);
        errors++;
      }
    }
    
    await client.query('COMMIT');
    
    console.log(`\nSchedule stored:`);
    console.log(`  Inserted: ${inserted}`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Errors: ${errors}`);
  } catch (error: any) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const seasonIndex = args.indexOf('--season');
  const monthIndex = args.indexOf('--month');
  const startDateIndex = args.indexOf('--start-date');
  const endDateIndex = args.indexOf('--end-date');
  
  if (seasonIndex === -1 || !args[seasonIndex + 1]) {
    console.error('Usage: tsx scripts/scrape-bbref-schedule.ts --season 2026 [--month november] [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD]');
    console.error('       tsx scripts/scrape-bbref-schedule.ts --season 2026 --all-months  # Scrape Oct-Apr');
    process.exit(1);
  }
  
  const season = parseInt(args[seasonIndex + 1], 10);
  const month = monthIndex !== -1 ? args[monthIndex + 1] : undefined;
  const allMonths = args.includes('--all-months');
  const startDateStr = startDateIndex !== -1 ? args[startDateIndex + 1] : undefined;
  const endDateStr = endDateIndex !== -1 ? args[endDateIndex + 1] : undefined;
  
  if (isNaN(season)) {
    console.error('Invalid season. Use format: 2026 (for 2025-26 season)');
    process.exit(1);
  }
  
  let startDate: Date | undefined;
  let endDate: Date | undefined;
  
  if (startDateStr) {
    startDate = new Date(startDateStr);
    if (isNaN(startDate.getTime())) {
      console.error(`Invalid start date: ${startDateStr}. Use format: YYYY-MM-DD`);
      process.exit(1);
    }
    startDate.setHours(0, 0, 0, 0);
  }
  
  if (endDateStr) {
    endDate = new Date(endDateStr);
    if (isNaN(endDate.getTime())) {
      console.error(`Invalid end date: ${endDateStr}. Use format: YYYY-MM-DD`);
      process.exit(1);
    }
    endDate.setHours(23, 59, 59, 999);
  }
  
  const seasonStr = `${season - 1}-${String(season).slice(-2)}`;
  
  // Months to scrape: October through April
  const monthsToScrape = ['october', 'november', 'december', 'january', 'february', 'march', 'april'];
  
  try {
    if (allMonths) {
      console.log(`\nScraping Basketball Reference schedule for ${seasonStr} (October - April)...\n`);
      
      let allGames: any[] = [];
      
      for (const monthName of monthsToScrape) {
        console.log(`\n=== Scraping ${monthName.toUpperCase()} ===\n`);
        
        try {
          const games = await scrapeSchedulePage(season, monthName, startDate, endDate);
          allGames = allGames.concat(games);
          
          // Rate limiting: wait between months
          if (monthName !== monthsToScrape[monthsToScrape.length - 1]) {
            console.log(`Waiting ${BASE_DELAY_MS / 1000} seconds before next month...`);
            await sleep(BASE_DELAY_MS);
          }
        } catch (error: any) {
          console.error(`Error scraping ${monthName}: ${error.message}`);
          console.log('Continuing with next month...');
        }
      }
      
      if (allGames.length === 0) {
        console.log('\nNo games found in schedule');
        return;
      }
      
      console.log(`\n\nTotal games found: ${allGames.length}`);
      console.log(`Storing all games in bbref_schedule table...\n`);
      await storeSchedule(allGames, seasonStr);
      
      console.log('\nDone!');
    } else {
      const dateRangeStr = startDate && endDate 
        ? ` (${startDateStr} to ${endDateStr})`
        : startDate 
          ? ` (from ${startDateStr})`
          : endDate
            ? ` (until ${endDateStr})`
            : '';
      
      console.log(`\nScraping Basketball Reference schedule for ${seasonStr}${month ? ` (${month})` : ''}${dateRangeStr}...\n`);
      
      const games = await scrapeSchedulePage(season, month, startDate, endDate);
      
      if (games.length === 0) {
        console.log('No games found in schedule');
        return;
      }
      
      console.log(`\nStoring ${games.length} games in bbref_schedule table...\n`);
      await storeSchedule(games, seasonStr);
      
      console.log('\nDone!');
    }
  } catch (error: any) {
    console.error('\nError:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

