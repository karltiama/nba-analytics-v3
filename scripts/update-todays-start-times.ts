import 'dotenv/config';
import { Pool } from 'pg';
import * as cheerio from 'cheerio';

/**
 * Update start times for today's games in bbref_schedule
 * Scrapes Basketball Reference schedule page to get actual start times
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const BASE_DELAY_MS = 4000;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

const BBREF_HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.basketball-reference.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Parse start time from BBRef format (e.g., "7:00p", "7:30p ET", "8:00p")
 */
function parseStartTime(gameDate: Date, timeStr: string): Date | null {
  if (!timeStr || timeStr.trim() === '') return null;
  
  const cleaned = timeStr.replace(/ET|PT|CT|MT|EST|PST|CST|MST/gi, '').trim();
  const match = cleaned.match(/(\d{1,2}):(\d{2})([ap]m?)/i);
  if (!match) return null;
  
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3].toLowerCase().replace('m', '');
  
  if (ampm === 'p' && hours !== 12) {
    hours += 12;
  } else if (ampm === 'a' && hours === 12) {
    hours = 0;
  }
  
  const year = gameDate.getFullYear();
  const month = String(gameDate.getMonth() + 1).padStart(2, '0');
  const day = String(gameDate.getDate()).padStart(2, '0');
  const hoursStr = String(hours).padStart(2, '0');
  const minutesStr = String(minutes).padStart(2, '0');
  
  const dateStr = `${year}-${month}-${day}T${hoursStr}:${minutesStr}:00-05:00`;
  const date = new Date(dateStr);
  
  return isNaN(date.getTime()) ? null : date;
}

async function scrapeTodaysGames(): Promise<Array<{ date: string; homeAbbr: string; awayAbbr: string; startTime: string | null }>> {
  const today = new Date();
  const month = today.toLocaleString('en-US', { month: 'long', timeZone: 'America/New_York' }).toLowerCase();
  const season = today.getFullYear();
  
  const url = `https://www.basketball-reference.com/leagues/NBA_${season}_games-${month}.html`;
  console.log(`Fetching: ${url}`);
  
  const response = await fetch(url, { headers: BBREF_HEADERS });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  
  const html = await response.text();
  const $ = cheerio.load(html);
  
  const games: Array<{ date: string; homeAbbr: string; awayAbbr: string; startTime: string | null }> = [];
  
  const $table = $('table#schedule');
  if ($table.length === 0) {
    console.log('No schedule table found');
    return games;
  }
  
  // Get headers to find time column
  const headers: string[] = [];
  $table.find('thead tr').last().find('th').each((_, th) => {
    headers.push($(th).text().trim());
  });
  
  const dateIdx = headers.findIndex(h => h.toLowerCase().includes('date'));
  const visitorIdx = headers.findIndex(h => h.toLowerCase().includes('visitor'));
  const homeIdx = headers.findIndex(h => h.toLowerCase().includes('home'));
  const timeIdx = headers.findIndex(h => h.toLowerCase().includes('time') || h.toLowerCase().includes('start'));
  
  console.log(`Found columns - Date: ${dateIdx}, Visitor: ${visitorIdx}, Home: ${homeIdx}, Time: ${timeIdx}`);
  
  const todayStr = today.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  
  $table.find('tbody tr').each((_, row) => {
    const $row = $(row);
    if ($row.hasClass('thead')) return;
    
    const cells = $row.find('td, th').toArray();
    if (cells.length < Math.max(dateIdx, visitorIdx, homeIdx) + 1) return;
    
    const dateCell = $(cells[dateIdx]).text().trim();
    const visitorLink = $row.find('td[data-stat="visitor_team_name"] a').attr('href');
    const homeLink = $row.find('td[data-stat="home_team_name"] a').attr('href');
    
    if (!visitorLink || !homeLink) return;
    
    const visitorMatch = visitorLink.match(/\/teams\/([A-Z]{3})\//);
    const homeMatch = homeLink.match(/\/teams\/([A-Z]{3})\//);
    if (!visitorMatch || !homeMatch) return;
    
    // Parse date
    const parsedDate = new Date(dateCell);
    if (isNaN(parsedDate.getTime())) return;
    const dateStr = parsedDate.toISOString().split('T')[0];
    
    // Only get today's games
    if (dateStr !== todayStr) return;
    
    // Get start time
    let startTime: string | null = null;
    if (timeIdx !== -1 && cells[timeIdx]) {
      const timeCell = $(cells[timeIdx]).text().trim();
      if (timeCell && !timeCell.match(/^\d+$/)) {
        const parsed = parseStartTime(parsedDate, timeCell);
        startTime = parsed ? parsed.toISOString() : null;
      }
    }
    
    games.push({
      date: dateStr,
      homeAbbr: homeMatch[1],
      awayAbbr: visitorMatch[1],
      startTime,
    });
  });
  
  return games;
}

async function updateStartTimes(games: Array<{ date: string; homeAbbr: string; awayAbbr: string; startTime: string | null }>) {
  let updated = 0;
  
  for (const game of games) {
    const year = game.date.replace(/-/g, '').slice(0, 8);
    const bbrefGameId = `bbref_${year}0000_${game.awayAbbr}_${game.homeAbbr}`;
    
    if (game.startTime) {
      await pool.query(`
        UPDATE bbref_schedule
        SET start_time = $1, updated_at = now()
        WHERE bbref_game_id = $2
      `, [game.startTime, bbrefGameId]);
      
      console.log(`  ✅ Updated: ${game.awayAbbr} @ ${game.homeAbbr} - ${new Date(game.startTime).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })}`);
      updated++;
    } else {
      console.log(`  ⚠️  No time found: ${game.awayAbbr} @ ${game.homeAbbr}`);
    }
  }
  
  return updated;
}

async function main() {
  console.log('='.repeat(80));
  console.log('🏀 Update Today\'s Game Start Times');
  console.log('='.repeat(80));
  
  try {
    const games = await scrapeTodaysGames();
    console.log(`\nFound ${games.length} games for today\n`);
    
    if (games.length === 0) {
      console.log('No games found for today');
      return;
    }
    
    const updated = await updateStartTimes(games);
    console.log(`\n✅ Updated ${updated} games with start times`);
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();




