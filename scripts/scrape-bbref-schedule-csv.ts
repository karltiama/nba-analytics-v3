import 'dotenv/config';
import { Pool } from 'pg';
import { parse } from 'csv-parse/sync';
import puppeteer from 'puppeteer';

/**
 * Basketball Reference Schedule CSV Scraper
 * 
 * Scrapes schedule data from Basketball Reference using CSV export
 * This gets the "Start (ET)" column which contains game start times
 * 
 * Uses Puppeteer to:
 * 1. Navigate to schedule page
 * 2. Click "Share & Export" button
 * 3. Click "Get table as CSV"
 * 4. Parse CSV data with start times
 * 
 * URL Format: https://www.basketball-reference.com/leagues/NBA_YYYY_games-[month].html
 * Example: https://www.basketball-reference.com/leagues/NBA_2026_games-october.html
 * 
 * CSV Format:
 * Date,Start (ET),Visitor/Neutral,PTS,Home/Neutral,PTS,,,Attend.,LOG,Arena,Notes
 * Tue Oct 21 2025,7:30p,Houston Rockets,124,Oklahoma City Thunder,125,Box Score,2OT,18203,3:15,Paycom Center,
 * 
 * Rate limiting: 4 seconds between requests (15 requests/minute)
 * 
 * Usage:
 *   tsx scripts/scrape-bbref-schedule-csv.ts --season 2026
 *   tsx scripts/scrape-bbref-schedule-csv.ts --season 2026 --month october
 *   tsx scripts/scrape-bbref-schedule-csv.ts --season 2026 --start-month october --end-month april
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const BASE_DELAY_MS = Number.parseInt(process.env.BBREF_SCRAPE_DELAY_MS || '4000', 10);

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Month names in lowercase (as used in URLs)
const MONTHS = [
  'october',
  'november',
  'december',
  'january',
  'february',
  'march',
  'april',
];

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

/**
 * Parse date from CSV format: "Tue Oct 21 2025"
 */
function parseDate(dateStr: string): Date | null {
  const cleaned = dateStr.trim();
  const date = new Date(cleaned);
  if (!isNaN(date.getTime())) {
    return date;
  }
  return null;
}

/**
 * Parse start time from CSV format: "7:30p", "10:00p", etc.
 * Returns timestamp string in EST format (YYYY-MM-DD HH:MM:SS-05:00)
 * Basketball Reference gives times in Eastern Time, and we store all as EST (UTC-5)
 */
function parseStartTime(gameDate: Date, timeStr: string): string | null {
  if (!timeStr || timeStr.trim() === '') return null;
  
  // Remove "ET" or other timezone indicators
  const cleaned = timeStr.replace(/ET|PT|CT|MT|EST|PST|CST|MST/gi, '').trim();
  
  // Match patterns like "7:30p", "10:00p", "12:30p", "7:30pm"
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
  
  // Format as EST timestamp (UTC-5) - always use EST regardless of DST
  const year = gameDate.getFullYear();
  const month = String(gameDate.getMonth() + 1).padStart(2, '0');
  const day = String(gameDate.getDate()).padStart(2, '0');
  const hoursStr = String(hours).padStart(2, '0');
  const minutesStr = String(minutes).padStart(2, '0');
  
  // Return as PostgreSQL timestamp string in EST (UTC-5)
  return `${year}-${month}-${day} ${hoursStr}:${minutesStr}:00-05:00`;
}

/**
 * Extract team abbreviation from team name
 * Examples: "Houston Rockets" -> "HOU", "Los Angeles Lakers" -> "LAL"
 */
function extractTeamAbbr(teamName: string): string | null {
  // Common team name patterns
  const teamNameMap: Record<string, string> = {
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
  
  // Try exact match first
  if (teamNameMap[teamName]) {
    return teamNameMap[teamName];
  }
  
  // Try to extract from common patterns
  const normalized = teamName.trim();
  
  // Check if it's already an abbreviation (3 letters)
  if (normalized.length === 3 && /^[A-Z]{3}$/.test(normalized)) {
    return normalized;
  }
  
  return null;
}

/**
 * Fetch schedule CSV from Basketball Reference using Puppeteer
 */
async function fetchScheduleCSV(season: number, month: string): Promise<string | null> {
  const url = `https://www.basketball-reference.com/leagues/NBA_${season}_games-${month}.html`;
  console.log(`\n🌐 Loading schedule page: ${url}`);
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  
  try {
    const page = await browser.newPage();
    
    // Set user agent to avoid detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Navigate to the page
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    
    // Wait for page to fully load
    console.log('   Waiting for page to fully load...');
    await sleep(2000);
    
    // Find and click "Share & Export" button for the schedule table
    console.log('   Looking for "Share & Export" button...');
    
    try {
      // Look for the schedule table first
      const scheduleTable = await page.$('table#schedule');
      if (!scheduleTable) {
        console.log('   ⚠️  Schedule table not found');
        return null;
      }
      
      // Find "Share & Export" button - look for section heading near schedule table
      console.log('   Looking for section heading with Share & Export...');
      await page.evaluate(() => {
        // Look for section heading that contains the schedule table
        const scheduleTable = document.querySelector('table#schedule');
        if (!scheduleTable) return;
        
        // Find the section heading (usually a div with class section_heading)
        const sectionHeadings = document.querySelectorAll('div.section_heading');
        for (const heading of sectionHeadings) {
          // Check if this heading is associated with the schedule table
          const spans = heading.querySelectorAll('span');
          for (const span of spans) {
            const text = span.textContent?.trim() || '';
            if (text.includes('Share') && text.includes('Export')) {
              (span as HTMLElement).click();
              return;
            }
          }
        }
      });
      
      await sleep(1500); // Wait for dropdown menu to appear
      
      // Now look for "Get table as CSV" option in the dropdown
      console.log('   Looking for "Get table as CSV" option...');
      await page.evaluate(() => {
        const sectionHeadings = document.querySelectorAll('div.section_heading');
        for (const heading of sectionHeadings) {
          const buttons = heading.querySelectorAll('button');
          for (const button of buttons) {
            const text = button.textContent?.trim() || '';
            if (text.includes('Get table as CSV') || text.includes('CSV (for Excel)')) {
              (button as HTMLElement).click();
              return;
            }
          }
        }
      });
      
      await sleep(2000); // Wait for CSV to generate
      
      // Wait for CSV pre element to appear
      console.log('   Waiting for CSV data to appear...');
      try {
        await page.waitForSelector('pre[id^="csv_schedule"], pre[id*="schedule"]', { timeout: 10000 });
        console.log('   ✅ CSV element appeared!');
      } catch (error) {
        console.log('   ⚠️  CSV element did not appear with expected ID, checking all pre elements...');
      }
      
      // Extract CSV data from pre element
      const csvData = await page.evaluate(() => {
        // First try to find pre with schedule-related ID
        const preElements = document.querySelectorAll('pre[id*="schedule"], pre[id^="csv_"]');
        
        for (const pre of preElements) {
          const text = pre.textContent || '';
          // Check if this looks like schedule CSV data
          if (text.includes('Date,Start (ET)') || 
              text.includes('Visitor/Neutral') || 
              (text.includes('Date') && text.includes('Visitor'))) {
            return text;
          }
        }
        
        // Fallback: check all pre elements
        const allPreElements = document.querySelectorAll('pre');
        for (const pre of allPreElements) {
          const text = pre.textContent || '';
          if (text.includes('Date,Start (ET)') || 
              (text.includes('Date') && text.includes('Visitor') && text.includes('Home'))) {
            return text;
          }
        }
        
        return null;
      });
      
      if (csvData) {
        console.log('   ✅ CSV data extracted successfully');
        // Debug: show first few lines of CSV
        const firstLines = csvData.split('\n').slice(0, 3).join('\n');
        console.log(`   📄 First few lines:\n${firstLines}`);
        return csvData;
      }
      
      console.log('   ⚠️  Could not extract CSV data from pre elements');
      return null;
      
    } catch (error: any) {
      console.error(`   ❌ Error extracting CSV: ${error.message}`);
      return null;
    } finally {
      await browser.close();
    }
  } catch (error: any) {
    console.error(`   ❌ Error: ${error.message}`);
    await browser.close();
    return null;
  }
}

/**
 * Parse CSV data and extract games
 */
function parseScheduleCSV(csvText: string): Array<{
  date: Date;
  startTime: string | null;
  visitorTeam: string;
  homeTeam: string;
  visitorAbbr: string | null;
  homeAbbr: string | null;
}> {
  // Remove citation line at the top if present
  const lines = csvText.split('\n');
  let csvStartIndex = 0;
  
  // Find the actual header row (should contain "Date" and "Start (ET)")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    if (line.includes('date') && (line.includes('start') || line.includes('visitor'))) {
      csvStartIndex = i;
      break;
    }
  }
  
  const cleanedCsv = lines.slice(csvStartIndex).join('\n');
  
  const records = parse(cleanedCsv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true, // Allow inconsistent column counts
    relax_quotes: true,
    skip_records_with_error: true, // Skip malformed rows
  });
  
  const games: Array<{
    date: Date;
    startTime: string | null;
    visitorTeam: string;
    homeTeam: string;
    visitorAbbr: string | null;
    homeAbbr: string | null;
  }> = [];
  
  // Debug: show column names from first record
  if (records.length > 0) {
    console.log(`   📋 CSV columns found: ${Object.keys(records[0]).join(', ')}`);
    if (records.length > 1) {
      console.log(`   📋 First data record sample: ${JSON.stringify(records[1])}`);
    }
  }
  
  for (const record of records) {
    // CSV columns: Date,Start (ET),Visitor/Neutral,PTS,Home/Neutral,PTS,,,Attend.,LOG,Arena,Notes
    const dateStr = record['Date'] || record['date'] || record['DATE'];
    const startTimeStr = record['Start (ET)'] || record['start (et)'] || record['Start'] || record['start'] || record['START (ET)'];
    const visitorTeam = record['Visitor/Neutral'] || record['visitor/neutral'] || record['Visitor'] || record['visitor'] || record['VISITOR/NEUTRAL'];
    const homeTeam = record['Home/Neutral'] || record['home/neutral'] || record['Home'] || record['home'] || record['HOME/NEUTRAL'];
    
    if (!dateStr || !visitorTeam || !homeTeam) {
      // Debug: show why we're skipping
      if (records.indexOf(record) < 3) {
        console.log(`   ⚠️  Skipping record: date=${dateStr}, visitor=${visitorTeam}, home=${homeTeam}`);
      }
      continue;
    }
    
    const gameDate = parseDate(dateStr);
    if (!gameDate) {
      continue;
    }
    
    const startTime = startTimeStr ? parseStartTime(gameDate, startTimeStr) : null;
    const visitorAbbr = extractTeamAbbr(visitorTeam);
    const homeAbbr = extractTeamAbbr(homeTeam);
    
    games.push({
      date: gameDate,
      startTime,
      visitorTeam,
      homeTeam,
      visitorAbbr,
      homeAbbr,
    });
  }
  
  return games;
}

/**
 * Generate bbref_game_id from date and team abbreviations
 */
function generateBbrefGameId(date: Date, awayAbbr: string, homeAbbr: string): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `bbref_${year}${month}${day}0000_${awayAbbr}_${homeAbbr}`;
}

/**
 * Store schedule games in database
 */
async function storeSchedule(games: Array<{
  date: Date;
  startTime: Date | null;
  visitorTeam: string;
  homeTeam: string;
  visitorAbbr: string | null;
  homeAbbr: string | null;
}>, season: string): Promise<void> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    let inserted = 0;
    let updated = 0;
    let errors = 0;
    
    for (const game of games) {
      try {
        if (!game.visitorAbbr || !game.homeAbbr) {
          console.log(`  ⚠️  Skipping ${game.visitorTeam} @ ${game.homeTeam} - could not extract team abbreviations`);
          errors++;
          continue;
        }
        
        const homeTeamId = await resolveTeamId(game.homeAbbr);
        const awayTeamId = await resolveTeamId(game.visitorAbbr);
        
        if (!homeTeamId || !awayTeamId) {
          console.log(`  ⚠️  Skipping ${game.visitorAbbr} @ ${game.homeAbbr} - could not resolve team IDs`);
          errors++;
          continue;
        }
        
        const gameDate = new Date(game.date);
        gameDate.setHours(0, 0, 0, 0);
        const dateStr = gameDate.toISOString().split('T')[0];
        
        const bbrefGameId = generateBbrefGameId(gameDate, game.visitorAbbr, game.homeAbbr);
        
        // startTime is already formatted as EST timestamp string
        const startTimeParam = game.startTime;
        
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
          ) VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7, $8)
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
          startTimeParam,
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
        console.error(`  ❌ Error storing game ${game.visitorTeam} @ ${game.homeTeam}: ${error.message}`);
        errors++;
      }
    }
    
    await client.query('COMMIT');
    
    console.log(`\n  📊 Stored:`);
    console.log(`    Inserted: ${inserted}`);
    console.log(`    Updated: ${updated}`);
    console.log(`    Errors: ${errors}`);
  } catch (error: any) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(80));
  console.log('🏀 Basketball Reference Schedule CSV Scraper');
  console.log('='.repeat(80));
  
  const args = process.argv.slice(2);
  let season: number | undefined;
  let month: string | undefined;
  let startMonth: string | undefined;
  let endMonth: string | undefined;
  
  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--season' && args[i + 1]) {
      season = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--month' && args[i + 1]) {
      month = args[i + 1].toLowerCase();
      i++;
    } else if (args[i] === '--start-month' && args[i + 1]) {
      startMonth = args[i + 1].toLowerCase();
      i++;
    } else if (args[i] === '--end-month' && args[i + 1]) {
      endMonth = args[i + 1].toLowerCase();
      i++;
    }
  }
  
  if (!season) {
    // Default to current year
    season = new Date().getFullYear();
    console.log(`\n⚠️  No season specified, using ${season}`);
  }
  
  const seasonStr = `${season - 1}-${String(season).slice(-2)}`;
  
  // Determine which months to process
  let monthsToProcess: string[] = [];
  
  if (month) {
    monthsToProcess = [month];
  } else if (startMonth && endMonth) {
    const startIdx = MONTHS.indexOf(startMonth);
    const endIdx = MONTHS.indexOf(endMonth);
    if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
      console.error('❌ Invalid month range');
      process.exit(1);
    }
    monthsToProcess = MONTHS.slice(startIdx, endIdx + 1);
  } else {
    // Default: all months
    monthsToProcess = MONTHS;
  }
  
  console.log(`\n📅 Season: ${seasonStr} (${season})`);
  console.log(`📆 Months to process: ${monthsToProcess.join(', ')}\n`);
  
  try {
    for (const monthName of monthsToProcess) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📅 Processing ${monthName.toUpperCase()}`);
      console.log('='.repeat(80));
      
      // Fetch CSV data
      const csvData = await fetchScheduleCSV(season, monthName);
      
      if (!csvData) {
        console.log(`\n⚠️  No CSV data found for ${monthName}, skipping...`);
        await sleep(BASE_DELAY_MS);
        continue;
      }
      
      // Parse CSV
      console.log('\n📋 Parsing CSV data...');
      const games = parseScheduleCSV(csvData);
      console.log(`  Found ${games.length} games`);
      
      if (games.length === 0) {
        console.log(`  ⚠️  No games parsed from CSV`);
        await sleep(BASE_DELAY_MS);
        continue;
      }
      
      // Show sample of games with start times
      const gamesWithTimes = games.filter(g => g.startTime);
      console.log(`  Games with start times: ${gamesWithTimes.length}/${games.length}`);
      if (gamesWithTimes.length > 0) {
        const sample = gamesWithTimes.slice(0, 3);
        console.log('  Sample games:');
        for (const g of sample) {
      // Parse the EST timestamp string to display
      let timeStr = 'N/A';
      if (g.startTime) {
        // g.startTime is in format "YYYY-MM-DD HH:MM:SS-05:00"
        const match = g.startTime.match(/(\d{2}):(\d{2}):\d{2}/);
        if (match) {
          let hours = parseInt(match[1], 10);
          const minutes = match[2];
          const ampm = hours >= 12 ? 'PM' : 'AM';
          if (hours > 12) hours -= 12;
          if (hours === 0) hours = 12;
          timeStr = `${hours}:${minutes} ${ampm}`;
        }
      }
          console.log(`    ${g.visitorAbbr} @ ${g.homeAbbr} - ${timeStr} ET`);
        }
      }
      
      // Store in database
      console.log('\n💾 Storing games in database...');
      await storeSchedule(games, seasonStr);
      
      // Rate limiting between months
      if (monthName !== monthsToProcess[monthsToProcess.length - 1]) {
        console.log(`\n⏳ Waiting ${BASE_DELAY_MS / 1000}s before next month...`);
        await sleep(BASE_DELAY_MS);
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('✅ Schedule scraping complete!');
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

