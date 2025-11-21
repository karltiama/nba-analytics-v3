import 'dotenv/config';
import { Pool } from 'pg';
import * as cheerio from 'cheerio';
import { parse } from 'csv-parse/sync';
import puppeteer from 'puppeteer';

/**
 * Basketball Reference CSV Box Score Scraper
 * 
 * Scrapes box score data from Basketball Reference CSV exports
 * 
 * Basketball Reference provides CSV export links for each team's box score table
 * The CSV links are found via selectors like: #csv_box-HOU-game-basic
 * 
 * URL Format: https://www.basketball-reference.com/boxscores/YYYYMMDD0TEAM.html
 * CSV URL Format: https://www.basketball-reference.com/boxscores/csv/YYYYMMDD0TEAM.csv
 * 
 * Or direct CSV link from page: The page contains links like:
 * <a href="/boxscores/csv/boxscores/202510210OKC.csv" id="csv_box-HOU-game-basic">CSV</a>
 * 
 * Rate limiting: 4 seconds between requests (15 requests/minute)
 * 
 * Usage:
 *   tsx scripts/scrape-bbref-csv-boxscores.ts --game-id 1842025102199
 *   tsx scripts/scrape-bbref-csv-boxscores.ts --game-date 2025-10-21 --home-team OKC
 *   tsx scripts/scrape-bbref-csv-boxscores.ts --bbref-game-id bbref_202510210000_HOU_OKC
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

/**
 * Map NBA team abbreviations to Basketball Reference team codes
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
 * Get team abbreviations and game date from game ID
 */
async function getTeamAbbreviations(gameId: string): Promise<{ homeAbbr: string; awayAbbr: string; gameDate: Date | string; bbrefGameId?: string } | null> {
  // First try to get from bbref_schedule (primary source)
  const bbrefResult = await pool.query(`
    SELECT 
      bs.home_team_abbr as home_abbr,
      bs.away_team_abbr as away_abbr,
      bs.game_date::text as game_date_et,
      bs.bbref_game_id
    FROM bbref_schedule bs
    WHERE bs.canonical_game_id = $1
    LIMIT 1
  `, [gameId]);

  if (bbrefResult.rows.length > 0) {
    const result = {
      homeAbbr: bbrefResult.rows[0].home_abbr,
      awayAbbr: bbrefResult.rows[0].away_abbr,
      gameDate: bbrefResult.rows[0].game_date_et,
      bbrefGameId: bbrefResult.rows[0].bbref_game_id,
    };
    console.log(`   ✅ Found game in bbref_schedule: ${result.awayAbbr} @ ${result.homeAbbr} on ${result.gameDate}`);
    return result;
  }
  
  console.log(`   ⚠️  Game not found in bbref_schedule, falling back to games table...`);

  // Fallback to games table
  const result = await pool.query(`
    SELECT 
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr,
      DATE((g.start_time AT TIME ZONE 'America/New_York'))::text as game_date_et
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
    gameDate: result.rows[0].game_date_et,
  };
}

/**
 * Construct Basketball Reference box score URL
 */
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

/**
 * Find CSV data from Basketball Reference box score page
 * CSV data is embedded in <pre> elements with IDs like csv_box-GSW-game-basic
 * Returns array of CSV data strings for each team
 */
async function findCSVData(boxScoreURL: string): Promise<Array<{ csvText: string; teamCode: string }>> {
  console.log(`🌐 Loading page with Puppeteer: ${boxScoreURL}`);
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  
  try {
    const page = await browser.newPage();
    
    // Set user agent to avoid detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Navigate to the page
    await page.goto(boxScoreURL, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    
    // Wait for page to fully load
    console.log('   Waiting for page to fully load...');
    await sleep(2000);
    
    // Find and click "Share & Export" button for each team's box score table
    console.log('   Looking for "Share & Export" buttons...');
    
    // Find all tables with box score data (they have IDs like box-GSW-game-basic)
    const teamTables = await page.evaluate(() => {
      const tables: Array<{ tableId: string; teamCode: string }> = [];
      const tableElements = document.querySelectorAll('table[id$="-game-basic"]');
      tableElements.forEach((table) => {
        const id = table.getAttribute('id') || '';
        const teamMatch = id.match(/box-([A-Z]{3})-game-basic/);
        if (teamMatch) {
          tables.push({ tableId: id, teamCode: teamMatch[1] });
        }
      });
      return tables;
    });
    
    console.log(`   Found ${teamTables.length} team box score tables`);
    
    // For each team table, find and click the Share & Export button, then CSV option
    for (const { tableId, teamCode } of teamTables) {
      console.log(`   Processing table for team: ${teamCode}`);
      
      try {
        // First, find and click "Share & Export" button near this table
        const shareButton = await page.evaluateHandle((tableId) => {
          const table = document.getElementById(tableId);
          if (!table) return null;
          
          // Look for span elements with "Share & Export" text (it's a span, not a button)
          // First check span elements specifically
          const spanElements = Array.from(document.querySelectorAll('span'));
          for (const el of spanElements) {
            const text = el.textContent?.trim() || '';
            // Check if it's near the table
            const isNearTable = table.contains(el) || 
                               (table.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
            
            // Look for "Share & Export" or "Share" but exclude cookie/privacy dialogs
            if ((text.includes('Share') || text.includes('Export')) && 
                isNearTable &&
                !text.includes('Cookie') && 
                !text.includes('Privacy') &&
                !text.includes('Preferences')) {
              return el;
            }
          }
          
          // Fallback: check other elements if span not found
          const allElements = Array.from(document.querySelectorAll('button, a, div'));
          for (const el of allElements) {
            const text = el.textContent?.trim() || '';
            const isNearTable = table.contains(el) || 
                               (table.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
            
            if ((text.includes('Share') || text.includes('Export')) && 
                isNearTable &&
                !text.includes('Cookie') && 
                !text.includes('Privacy') &&
                !text.includes('Preferences')) {
              return el;
            }
          }
          return null;
        }, tableId);
        
        if (shareButton && shareButton.asElement()) {
          console.log(`     Clicking "Share & Export" span for ${teamCode}...`);
          // Scroll into view first
          await page.evaluate((element) => {
            (element as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, shareButton);
          await sleep(300);
          // Click using page.click with selector instead
          const spanText = await page.evaluate((element) => {
            return (element as HTMLElement).textContent?.trim();
          }, shareButton);
          if (spanText) {
            // Find and click using XPath or text content
            await page.evaluate((teamCode) => {
              const sectionHeading = document.querySelector(`div.section_heading.assoc_box-${teamCode}-game-basic`);
              if (sectionHeading) {
                const spans = sectionHeading.querySelectorAll('span');
                for (const span of spans) {
                  if (span.textContent?.includes('Share') && span.textContent?.includes('Export')) {
                    (span as HTMLElement).click();
                    return true;
                  }
                }
              }
              return false;
            }, teamCode);
          }
          await sleep(1500); // Wait for dropdown menu to appear
          
          // Now look for "Get table as CSV (for Excel)" button in the dropdown menu
          // Wait a bit for the menu to appear
          await sleep(500);
          
          const csvOption = await page.evaluateHandle((tableId) => {
            // Extract team code from table ID
            const teamMatch = tableId.match(/box-([A-Z]{3})-game-basic/);
            if (!teamMatch) return null;
            const teamCode = teamMatch[1];
            
            // Find the section heading div for this team
            const sectionHeading = document.querySelector(`div.section_heading.assoc_box-${teamCode}-game-basic`);
            if (!sectionHeading) return null;
            
            // Find all buttons in the dropdown menu (they're inside the section heading)
            const buttons = sectionHeading.querySelectorAll('button');
            for (const button of buttons) {
              const text = button.textContent?.trim() || '';
              // Look for the exact text "Get table as CSV (for Excel)"
              if (text.includes('Get table as CSV') || 
                  text.includes('CSV (for Excel)')) {
                return button;
              }
            }
            
            return null;
          }, tableId);
          
          if (csvOption && csvOption.asElement()) {
            console.log(`     Clicking "Get table as CSV (for Excel)" for ${teamCode}...`);
            // Click using page.evaluate to ensure it's clickable
            await page.evaluate((teamCode) => {
              const sectionHeading = document.querySelector(`div.section_heading.assoc_box-${teamCode}-game-basic`);
              if (sectionHeading) {
                const buttons = sectionHeading.querySelectorAll('button');
                for (const button of buttons) {
                  const text = button.textContent?.trim() || '';
                  if (text.includes('Get table as CSV') || text.includes('CSV (for Excel)')) {
                    (button as HTMLElement).click();
                    return true;
                  }
                }
              }
              return false;
            }, teamCode);
            await sleep(2000); // Wait for CSV to generate
          } else {
            console.log(`     ⚠️  Could not find CSV button for ${teamCode}`);
            // Debug: show what buttons exist in the section heading
            const menuOptions = await page.evaluate((tableId) => {
              const teamMatch = tableId.match(/box-([A-Z]{3})-game-basic/);
              if (!teamMatch) return [];
              const teamCode = teamMatch[1];
              const sectionHeading = document.querySelector(`div.section_heading.assoc_box-${teamCode}-game-basic`);
              if (!sectionHeading) return [];
              const buttons = Array.from(sectionHeading.querySelectorAll('button'));
              return buttons.map(btn => btn.textContent?.trim()).filter(Boolean);
            }, tableId);
            if (menuOptions.length > 0) {
              console.log(`     Available buttons: ${menuOptions.join(', ')}`);
            }
          }
        } else {
          console.log(`     ⚠️  Could not find Share & Export button for ${teamCode}`);
        }
      } catch (error: any) {
        console.log(`     ⚠️  Error processing ${teamCode}: ${error.message}`);
      }
    }
    
    // Wait for CSV pre elements to appear after clicking
    console.log('   Waiting for CSV data elements to appear...');
    
    // Wait for at least one CSV pre element to appear
    try {
      await page.waitForSelector('pre[id^="csv_box-"]', { timeout: 10000 });
      console.log('   ✅ CSV elements appeared!');
    } catch (error) {
      console.log('   ⚠️  CSV elements did not appear, checking what exists...');
    }
    
    // Extract CSV data from all pre elements with csv_box- IDs
    const csvData = await page.evaluate(() => {
      const csvElements: Array<{ csvText: string; teamCode: string }> = [];
      
      // Find all <pre> elements with IDs starting with csv_box-
      const preElements = document.querySelectorAll('pre[id^="csv_box-"]');
      
      preElements.forEach((pre) => {
        const id = pre.getAttribute('id');
        const csvText = pre.textContent || '';
        
        if (id && csvText) {
          // Extract team code from ID: csv_box-GSW-game-basic -> GSW
          const teamMatch = id.match(/csv_box-([A-Z]{3})-/);
          const teamCode = teamMatch ? teamMatch[1] : null;
          
          if (teamCode) {
            csvElements.push({ csvText, teamCode });
          }
        }
      });
      
      return csvElements;
    });
    
    console.log(`   Found ${csvData.length} CSV data block(s)`);
    
    // Debug: show what we found
    if (csvData.length > 0) {
      csvData.forEach((data, idx) => {
        const lineCount = data.csvText.split('\n').length;
        console.log(`     ${idx + 1}. Team: ${data.teamCode}, Lines: ${lineCount}`);
      });
    } else {
      console.log('   ⚠️  No CSV <pre> elements found. Checking page structure...');
      
      // Debug: check what pre elements exist
      const allPreElements = await page.evaluate(() => {
        const preElements = Array.from(document.querySelectorAll('pre'));
        return preElements.map(pre => ({
          id: pre.getAttribute('id'),
          textLength: pre.textContent?.length || 0,
        }));
      });
      
      console.log(`   Total <pre> elements found: ${allPreElements.length}`);
      allPreElements.slice(0, 5).forEach((pre, idx) => {
        console.log(`     <pre> element ${idx + 1}: id="${pre.id}", text length=${pre.textLength}`);
      });
    }
    
    return csvData;
  } finally {
    await browser.close();
  }
}

/**
 * Parse minutes from "MM:SS" format to decimal minutes
 */
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

/**
 * Parse integer from string
 */
function parseIntSafe(value: string | null | undefined): number | null {
  if (!value || value === '' || value === '-') return null;
  const num = parseInt(value, 10);
  return isNaN(num) ? null : num;
}

/**
 * Parse float from string
 */
function parseFloatSafe(value: string | null | undefined): number | null {
  if (!value || value === '' || value === '-') return null;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

/**
 * Parse HTML box score table as fallback when CSV is not available
 */
async function parseHTMLBoxScore(html: string, teamCode: string): Promise<any[]> {
  const $ = cheerio.load(html);
  const records: any[] = [];
  
  // Find the table for this team: box-{TEAM}-game-basic
  const tableId = `box-${teamCode}-game-basic`;
  const $table = $(`table#${tableId}`);
  
  if ($table.length === 0) {
    console.log(`   ⚠️  Could not find table ${tableId}`);
    return records;
  }
  
  console.log(`   📊 Parsing HTML table for team: ${teamCode}`);
  
  // Extract headers
  const headers: string[] = [];
  $table.find('thead tr').last().find('th, td').each((i, th) => {
    const text = $(th).text().trim();
    if (text && text !== '') {
      headers.push(text);
    }
  });
  
  let isStartersSection = true;
  let playerIndex = 0;
  
  // Extract player rows
  $table.find('tbody tr').each((rowIdx, row) => {
    const $row = $(row);
    const rowText = $row.text().trim();
    const firstCellText = $row.find('th, td').first().text().trim().toLowerCase();
    
    // Check for section markers
    if (firstCellText === 'starters') {
      isStartersSection = true;
      playerIndex = 0;
      return;
    }
    if (firstCellText === 'reserves') {
      isStartersSection = false;
      return;
    }
    
    // Skip team totals and empty rows
    if (firstCellText === 'team totals' || !firstCellText || firstCellText.includes('did not play')) {
      return;
    }
    
    // Extract player name (first th)
    const playerName = $row.find('th').first().text().trim();
    if (!playerName) return;
    
    // Build record object
    const record: any = { Player: playerName };
    
    // Extract stats from cells
    $row.find('td').each((colIdx, cell) => {
      const headerIndex = colIdx + 1; // +1 because first column (name) is in th
      const header = headers[headerIndex];
      const value = $(cell).text().trim();
      
      if (header && value) {
        record[header] = value;
      }
    });
    
    records.push(record);
    playerIndex++;
  });
  
  console.log(`   Parsed ${records.length} rows from HTML table`);
  return records;
}

/**
 * Parse CSV text data
 */
function parseCSVText(csvText: string): any[] {
  // Clean up the CSV text - remove comment lines and find the actual header row
  const lines = csvText.split('\n');
  
  // Find the header row (usually contains "Player" or "Starters")
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    if (line.includes('player') || line.includes('starters')) {
      headerIndex = i;
      break;
    }
  }
  
  // If we found a header, use everything from that line onwards
  // Otherwise, skip comment lines (starting with ---) and empty lines
  let csvToParse = csvText;
  if (headerIndex >= 0) {
    csvToParse = lines.slice(headerIndex).join('\n');
  } else {
    // Remove comment lines (starting with ---)
    csvToParse = lines
      .filter(line => !line.trim().startsWith('---') && line.trim() !== '')
      .join('\n');
  }
  
  // Parse CSV
  const records = parse(csvToParse, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true, // Allow inconsistent column counts
  });
  
  return records;
}

/**
 * Normalize player name for matching (remove common variations)
 */
function normalizePlayerName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/\./g, '') // Remove periods (e.g., "J.R." -> "JR")
    .replace(/'/g, '') // Remove apostrophes (e.g., "O'Brien" -> "OBrien")
    .toLowerCase();
}

/**
 * Resolve player ID from name (fuzzy matching with multiple strategies)
 */
async function resolvePlayerId(playerName: string, teamCode: string): Promise<string | null> {
  // Map BBRef code to NBA abbreviation
  const nbaAbbr = Object.entries(TEAM_CODE_MAP).find(([_, code]) => code === teamCode)?.[0] || teamCode;
  
  const normalizedName = normalizePlayerName(playerName);
  const nameParts = playerName.trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts[nameParts.length - 1] || '';
  
  // Strategy 1: Exact match (case-insensitive)
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
  
  // Strategy 2: Normalized exact match (handles "J.R. Smith" vs "JR Smith")
  const normalizedMatch = await pool.query(`
    SELECT p.player_id
    FROM players p
    JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
    JOIN teams t ON ptr.team_id = t.team_id
    WHERE LOWER(REPLACE(REPLACE(p.full_name, '.', ''), '''', '')) = $1
      AND t.abbreviation = $2
    LIMIT 1
  `, [normalizedName, nbaAbbr]);
  
  if (normalizedMatch.rows.length > 0) {
    return normalizedMatch.rows[0].player_id;
  }
  
  // Strategy 3: First name + last name match (handles "Jimmy Butler" vs "Jimmy Butler III")
  if (firstName && lastName && nameParts.length >= 2) {
    const firstLastMatch = await pool.query(`
      SELECT p.player_id
      FROM players p
      JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
      JOIN teams t ON ptr.team_id = t.team_id
      WHERE LOWER(p.first_name) = LOWER($1)
        AND LOWER(p.last_name) = LOWER($2)
        AND t.abbreviation = $3
      LIMIT 1
    `, [firstName, lastName, nbaAbbr]);
    
    if (firstLastMatch.rows.length > 0) {
      return firstLastMatch.rows[0].player_id;
    }
  }
  
  // Strategy 4: Last name match (fuzzy - multiple players might match)
  if (lastName) {
    const lastNameMatch = await pool.query(`
      SELECT p.player_id
      FROM players p
      JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
      JOIN teams t ON ptr.team_id = t.team_id
      WHERE LOWER(p.last_name) = LOWER($1)
        AND t.abbreviation = $2
      LIMIT 1
    `, [lastName, nbaAbbr]);
    
    if (lastNameMatch.rows.length > 0) {
      return lastNameMatch.rows[0].player_id;
    }
  }
  
  // Strategy 5: Partial name match (contains)
  const partialMatch = await pool.query(`
    SELECT p.player_id
    FROM players p
    JOIN player_team_rosters ptr ON p.player_id = ptr.player_id
    JOIN teams t ON ptr.team_id = t.team_id
    WHERE LOWER(p.full_name) LIKE LOWER($1)
      AND t.abbreviation = $2
    LIMIT 1
  `, [`%${playerName}%`, nbaAbbr]);
  
  if (partialMatch.rows.length > 0) {
    return partialMatch.rows[0].player_id;
  }
  
  return null;
}

/**
 * Process and store CSV box score data
 */
export async function processCSVBoxScore(
  gameId: string,
  dryRun: boolean = false
): Promise<boolean> {
  try {
    const gameInfo = await getTeamAbbreviations(gameId);
    if (!gameInfo) {
      console.error(`   ❌ Could not find game ${gameId} in database`);
      return false;
    }
    
    const { homeAbbr, awayAbbr, gameDate, bbrefGameId } = gameInfo;
    
    // If we got data from bbref_schedule, the abbreviations are already Basketball Reference codes
    // If we got data from games table, we need to map NBA abbreviations to BBRef codes
    const homeTeamCode = bbrefGameId ? homeAbbr : (TEAM_CODE_MAP[homeAbbr] || homeAbbr);
    
    if (!homeTeamCode) {
      console.error(`   ❌ Unknown team code for ${homeAbbr}`);
      return false;
    }
    
    const gameDateStr = typeof gameDate === 'string' ? gameDate : gameDate.toISOString().split('T')[0];
    console.log(`\n📊 Processing CSV box score for game ${gameId} (${awayAbbr} @ ${homeAbbr}, ${gameDateStr})...`);
    console.log(`   Data source: ${bbrefGameId ? 'bbref_schedule ✅' : 'games table (fallback)'}`);
    
    if (dryRun) {
      console.log(`   [DRY RUN] Would fetch CSV data from Basketball Reference`);
      console.log(`   Would construct URL using: date=${gameDateStr}, homeTeamCode=${homeTeamCode}`);
      return true;
    }
    
    // Construct box score URL using data from bbref_schedule
    // homeTeamCode is the Basketball Reference team code (e.g., 'OKC', 'PHO', 'BRK')
    const boxScoreURL = constructBBRefURL(gameDate, homeTeamCode);
    console.log(`   Constructed Basketball Reference URL: ${boxScoreURL}`);
    
    // Find CSV data embedded in <pre> elements
    const csvDataBlocks = await findCSVData(boxScoreURL);
    
    if (csvDataBlocks.length === 0) {
      console.warn(`   ⚠️  No CSV data found in <pre> elements`);
      return false;
    }
    
    await sleep(addJitter(BASE_DELAY_MS));
    
    const client = await pool.connect();
    let totalInserted = 0;
    let totalSkipped = 0;
    const unresolvedPlayers: Array<{ name: string; team: string }> = [];
    
    try {
      await client.query('BEGIN');
      
      // Process each team's CSV data
      for (const { csvText, teamCode } of csvDataBlocks) {
        console.log(`\n   Processing CSV data for team: ${teamCode}`);
        
        const csvRecords = parseCSVText(csvText);
        console.log(`   Parsed ${csvRecords.length} CSV records`);
        
        // Debug: show first few records
        if (csvRecords.length > 0) {
          console.log(`   First record keys: ${Object.keys(csvRecords[0]).join(', ')}`);
          console.log(`   First record sample: ${JSON.stringify(csvRecords[0]).substring(0, 200)}`);
        }
        
        let inserted = 0;
        let skipped = 0;
        
        // Track if we're in starters section
        let isStartersSection = true;
        let playerIndex = 0;
        
        for (const record of csvRecords) {
          // Get player name from "Starters" column (Basketball Reference CSV format)
          const playerName = record['Starters'] || record['Player'] || record['player'] || record[''] || '';
          const playerNameLower = playerName.toLowerCase().trim();
          
          // Check for section markers
          if (playerNameLower === 'starters') {
            isStartersSection = true;
            playerIndex = 0; // Reset counter
            continue;
          }
          if (playerNameLower === 'reserves') {
            isStartersSection = false;
            playerIndex = 0; // Reset counter
            continue;
          }
          
          // Skip header rows and team totals
          if (!playerName || 
              playerNameLower === 'player' || 
              playerNameLower === 'team totals' || 
              playerNameLower.includes('did not play') ||
              playerNameLower.includes('did not dress')) {
            continue;
          }
          
          // Determine if player started (first 5 players in starters section)
          const started = isStartersSection && playerIndex < 5;
          playerIndex++;
          
          // Parse minutes
          const mp = record['MP'] || record['mp'] || '';
          const minutes = parseMinutes(mp);
          
          // Skip if no minutes and not DNP
          if (!minutes && !mp.includes('Did Not') && mp !== '') {
            continue;
          }
          
          // Resolve player ID
          const playerId = await resolvePlayerId(playerName.trim(), teamCode);
          
          if (!playerId) {
            unresolvedPlayers.push({ name: playerName.trim(), team: teamCode });
            console.warn(`     ⚠️  Could not resolve player: ${playerName} (${teamCode})`);
          }
          
          // Store in database
          await client.query(`
            INSERT INTO scraped_boxscores (
              game_id, game_date, team_code, player_name, player_id,
              minutes, points, rebounds, assists, steals, blocks, turnovers,
              field_goals_made, field_goals_attempted, field_goal_pct,
              three_pointers_made, three_pointers_attempted, three_point_pct,
              free_throws_made, free_throws_attempted, free_throw_pct,
              offensive_rebounds, defensive_rebounds,
              personal_fouls, plus_minus,
              started, dnp_reason,
              source, raw_data, scraped_at
            ) VALUES (
              $1, $2, $3, $4, $5,
              $6, $7, $8, $9, $10, $11, $12,
              $13, $14, $15,
              $16, $17, $18,
              $19, $20, $21,
              $22, $23,
              $24, $25,
              $26, $27,
              'bbref_csv', $28::jsonb, now()
            )
            ON CONFLICT (game_id, team_code, player_name, source) DO UPDATE SET
              minutes = EXCLUDED.minutes,
              points = EXCLUDED.points,
              rebounds = EXCLUDED.rebounds,
              assists = EXCLUDED.assists,
              steals = EXCLUDED.steals,
              blocks = EXCLUDED.blocks,
              turnovers = EXCLUDED.turnovers,
              field_goals_made = EXCLUDED.field_goals_made,
              field_goals_attempted = EXCLUDED.field_goals_attempted,
              field_goal_pct = EXCLUDED.field_goal_pct,
              three_pointers_made = EXCLUDED.three_pointers_made,
              three_pointers_attempted = EXCLUDED.three_pointers_attempted,
              three_point_pct = EXCLUDED.three_point_pct,
              free_throws_made = EXCLUDED.free_throws_made,
              free_throws_attempted = EXCLUDED.free_throws_attempted,
              free_throw_pct = EXCLUDED.free_throw_pct,
              offensive_rebounds = EXCLUDED.offensive_rebounds,
              defensive_rebounds = EXCLUDED.defensive_rebounds,
              personal_fouls = EXCLUDED.personal_fouls,
              plus_minus = EXCLUDED.plus_minus,
              started = EXCLUDED.started,
              dnp_reason = EXCLUDED.dnp_reason,
              player_id = COALESCE(scraped_boxscores.player_id, EXCLUDED.player_id),
              raw_data = EXCLUDED.raw_data,
              updated_at = now()
          `, [
            gameId,
            gameDateStr,
            teamCode,
            playerName.trim(),
            playerId,
            minutes,
            parseIntSafe(record['PTS'] || record['pts']),
            parseIntSafe(record['TRB'] || record['trb'] || record['REB'] || record['reb']),
            parseIntSafe(record['AST'] || record['ast']),
            parseIntSafe(record['STL'] || record['stl']),
            parseIntSafe(record['BLK'] || record['blk']),
            parseIntSafe(record['TOV'] || record['tov']),
            parseIntSafe(record['FG'] || record['fg']),
            parseIntSafe(record['FGA'] || record['fga']),
            parseFloatSafe(record['FG%'] || record['fg%'] || record['FG_PCT'] || record['FG.']),
            parseIntSafe(record['3P'] || record['3p'] || record['three_p'] || record['3P']),
            parseIntSafe(record['3PA'] || record['3pa'] || record['three_pa'] || record['3PA']),
            parseFloatSafe(record['3P%'] || record['3p%'] || record['3P_PCT'] || record['3P.']),
            parseIntSafe(record['FT'] || record['ft']),
            parseIntSafe(record['FTA'] || record['fta']),
            parseFloatSafe(record['FT%'] || record['ft%'] || record['FT_PCT'] || record['FT.']),
            parseIntSafe(record['ORB'] || record['orb']),
            parseIntSafe(record['DRB'] || record['drb']),
            parseIntSafe(record['PF'] || record['pf']),
            parseIntSafe(record['+/-'] || record['+/-'] || record['PLUS_MINUS'] || record['+/-']),
            started,
            (mp.includes('Did Not') || playerNameLower.includes('did not') ? mp : null),
            JSON.stringify(record),
          ]);
          
          inserted++;
        }
        
        totalInserted += inserted;
        totalSkipped += skipped;
        
        console.log(`   ✅ Inserted ${inserted} player stats for ${teamCode}`);
        
        // Rate limiting between teams
        if (teamCode !== csvDataBlocks[csvDataBlocks.length - 1]?.teamCode) {
          await sleep(addJitter(BASE_DELAY_MS));
        }
      }
      
      await client.query('COMMIT');
      
      // Summary report
      console.log(`\n   ✅ Total: Inserted ${totalInserted} player stats${totalSkipped > 0 ? `, skipped ${totalSkipped}` : ''}`);
      
      if (unresolvedPlayers.length > 0) {
        console.log(`\n   ⚠️  Unresolved Players (${unresolvedPlayers.length}):`);
        const uniqueUnresolved = Array.from(
          new Map(unresolvedPlayers.map(p => [p.name, p])).values()
        );
        uniqueUnresolved.slice(0, 10).forEach(p => {
          console.log(`      - ${p.name} (${p.team})`);
        });
        if (uniqueUnresolved.length > 10) {
          console.log(`      ... and ${uniqueUnresolved.length - 10} more`);
        }
        console.log(`\n   💡 Tip: Run 'tsx scripts/resolve-missing-player-ids.ts' to batch-resolve missing player IDs`);
      } else {
        console.log(`\n   ✅ All players resolved successfully!`);
      }
      
      return totalInserted > 0;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`   ❌ Error processing CSV box score:`, error);
      return false;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error(`   ❌ Failed to fetch or process CSV box score:`, error.message);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const gameIdIndex = args.indexOf('--game-id');
  const dateIndex = args.indexOf('--game-date');
  const homeTeamIndex = args.indexOf('--home-team');
  const bbrefGameIdIndex = args.indexOf('--bbref-game-id');
  const dryRunIndex = args.indexOf('--dry-run');
  
  const dryRun = dryRunIndex !== -1;
  
  try {
    if (gameIdIndex !== -1 && args[gameIdIndex + 1]) {
      const gameId = args[gameIdIndex + 1];
      await processCSVBoxScore(gameId, dryRun);
    } else if (bbrefGameIdIndex !== -1 && args[bbrefGameIdIndex + 1]) {
      // Get game_id from bbref_game_id
      const bbrefGameId = args[bbrefGameIdIndex + 1];
      const result = await pool.query(`
        SELECT canonical_game_id 
        FROM bbref_schedule 
        WHERE bbref_game_id = $1
        LIMIT 1
      `, [bbrefGameId]);
      
      if (result.rows.length === 0) {
        console.error(`Could not find game for bbref_game_id: ${bbrefGameId}`);
        process.exit(1);
      }
      
      await processCSVBoxScore(result.rows[0].canonical_game_id, dryRun);
    } else if (dateIndex !== -1 && homeTeamIndex !== -1) {
      console.log('Manual date/team specification not yet implemented for CSV scraping');
      console.log('Use --game-id or --bbref-game-id instead');
      process.exit(1);
    } else {
      console.log('Usage:');
      console.log('  tsx scripts/scrape-bbref-csv-boxscores.ts --game-id 1842025102199');
      console.log('  tsx scripts/scrape-bbref-csv-boxscores.ts --bbref-game-id bbref_202510210000_HOU_OKC');
      console.log('  tsx scripts/scrape-bbref-csv-boxscores.ts --game-id 1842025102199 --dry-run');
      process.exit(1);
    }
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module || import.meta.url === `file://${process.argv[1]}`) {
  main();
}

