import 'dotenv/config';
import { Pool } from 'pg';
import * as cheerio from 'cheerio';

/**
 * Update BBRef Game Scores and Statuses
 * 
 * Scrapes Basketball Reference schedule pages to get scores for completed games
 * and updates the bbref_games table with scores and status = 'Final'
 * 
 * URL Format: https://www.basketball-reference.com/leagues/NBA_YYYY_games-MONTH.html
 * 
 * Usage:
 *   tsx scripts/update-bbref-game-scores.ts --month november
 *   tsx scripts/update-bbref-game-scores.ts --start-date 2025-10-22 --end-date 2025-11-26
 *   tsx scripts/update-bbref-game-scores.ts --dry-run
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const BASE_DELAY_MS = Number.parseInt(process.env.BBREF_SCRAPE_DELAY_MS || '4000', 10);

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

// BBRef team code to our abbreviation
const BBREF_TO_NBA: Record<string, string> = {
  'ATL': 'ATL', 'BOS': 'BOS', 'BRK': 'BKN', 'CHO': 'CHA', 'CHI': 'CHI',
  'CLE': 'CLE', 'DAL': 'DAL', 'DEN': 'DEN', 'DET': 'DET', 'GSW': 'GSW',
  'HOU': 'HOU', 'IND': 'IND', 'LAC': 'LAC', 'LAL': 'LAL', 'MEM': 'MEM',
  'MIA': 'MIA', 'MIL': 'MIL', 'MIN': 'MIN', 'NOP': 'NOP', 'NYK': 'NYK',
  'OKC': 'OKC', 'ORL': 'ORL', 'PHI': 'PHI', 'PHO': 'PHX', 'POR': 'POR',
  'SAC': 'SAC', 'SAS': 'SAS', 'TOR': 'TOR', 'UTA': 'UTA', 'WAS': 'WAS',
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Parse start time from BBRef format (e.g., "7:00p", "7:30p ET", "8:00p")
 * Returns time in ET timezone as ISO string
 */
function parseStartTime(dateStr: string, timeStr: string | undefined): string | null {
  if (!timeStr) return null;
  
  // Remove "ET" or other timezone indicators
  const cleaned = timeStr.replace(/ET|PT|CT|MT|EST|PST|CST|MST/gi, '').trim();
  
  // Match patterns like "7:00p", "7:30p", "8:00p", "12:30p"
  const match = cleaned.match(/(\d{1,2}):(\d{2})([ap])/i);
  if (!match) return null;
  
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3].toLowerCase();
  
  // Convert to 24-hour format
  if (ampm === 'p' && hours !== 12) {
    hours += 12;
  } else if (ampm === 'a' && hours === 12) {
    hours = 0;
  }
  
  // Create date in ET timezone
  const date = new Date(dateStr + 'T00:00:00-05:00'); // ET is UTC-5
  date.setHours(hours, minutes, 0, 0);
  
  return date.toISOString();
}

interface GameScore {
  date: string;
  homeTeamAbbr: string;
  awayTeamAbbr: string;
  homeScore: number;
  awayScore: number;
  startTime?: string; // Time in format "7:00p" or "7:30p ET"
}

async function scrapeMonthScores(season: number, month: string): Promise<GameScore[]> {
  const url = `https://www.basketball-reference.com/leagues/NBA_${season}_games-${month.toLowerCase()}.html`;
  console.log(`\nFetching: ${url}`);
  
  const response = await fetch(url, { headers: BBREF_HEADERS });
  if (!response.ok) {
    if (response.status === 404) {
      console.log(`  Month ${month} not available yet (404)`);
      return [];
    }
    throw new Error(`HTTP ${response.status}`);
  }
  
  const html = await response.text();
  const $ = cheerio.load(html);
  
  const games: GameScore[] = [];
  
  // Find schedule table
  const $table = $('table#schedule');
  if ($table.length === 0) {
    console.log('  No schedule table found');
    return [];
  }
  
  $table.find('tbody tr').each((_, row) => {
    const $row = $(row);
    
    // Skip header rows
    if ($row.hasClass('thead')) return;
    
    // Get date
    const dateCell = $row.find('th[data-stat="date_game"]').text().trim();
    if (!dateCell || dateCell.toLowerCase() === 'date') return;
    
    // Get team abbreviations from links
    const visitorLink = $row.find('td[data-stat="visitor_team_name"] a').attr('href');
    const homeLink = $row.find('td[data-stat="home_team_name"] a').attr('href');
    
    if (!visitorLink || !homeLink) return;
    
    const visitorMatch = visitorLink.match(/\/teams\/([A-Z]{3})\//);
    const homeMatch = homeLink.match(/\/teams\/([A-Z]{3})\//);
    
    if (!visitorMatch || !homeMatch) return;
    
    const visitorAbbr = visitorMatch[1];
    const homeAbbr = homeMatch[1];
    
    // Get scores
    const visitorScore = parseInt($row.find('td[data-stat="visitor_pts"]').text().trim(), 10);
    const homeScore = parseInt($row.find('td[data-stat="home_pts"]').text().trim(), 10);
    
    // Only include games with scores (completed games)
    if (isNaN(visitorScore) || isNaN(homeScore)) return;
    
    // Get start time if available (data-stat="game_start_time" or similar)
    let startTime: string | undefined;
    const timeCell = $row.find('td[data-stat="game_start_time"]').text().trim() || 
                     $row.find('td[data-stat="start_time"]').text().trim() ||
                     $row.find('td').eq(2).text().trim(); // Try 3rd column as fallback
    
    if (timeCell && timeCell.length > 0 && !timeCell.match(/^\d+$/)) {
      // If it looks like a time (not just a number), use it
      startTime = timeCell;
    }
    
    // Parse date
    const parsedDate = new Date(dateCell);
    if (isNaN(parsedDate.getTime())) return;
    
    const dateStr = parsedDate.toISOString().split('T')[0];
    
    games.push({
      date: dateStr,
      homeTeamAbbr: homeAbbr,
      awayTeamAbbr: visitorAbbr,
      homeScore: homeScore,
      awayScore: visitorScore,
      startTime: startTime,
    });
  });
  
  console.log(`  Found ${games.length} completed games`);
  return games;
}

async function updateGameScores(games: GameScore[], dryRun: boolean = false): Promise<{ updated: number; notFound: number }> {
  let updated = 0;
  let notFound = 0;
  
  for (const game of games) {
    // Generate bbref_game_id to match
    const year = game.date.replace(/-/g, '').slice(0, 8);
    const bbrefGameId = `bbref_${year}0000_${game.awayTeamAbbr}_${game.homeTeamAbbr}`;
    
    // Check if game exists in bbref_games
    const existing = await pool.query(`
      SELECT bbref_game_id, status, home_score, away_score
      FROM bbref_games
      WHERE bbref_game_id = $1
    `, [bbrefGameId]);
    
    if (existing.rows.length === 0) {
      // Try matching by date and teams
      const nbaHomeAbbr = BBREF_TO_NBA[game.homeTeamAbbr] || game.homeTeamAbbr;
      const nbaAwayAbbr = BBREF_TO_NBA[game.awayTeamAbbr] || game.awayTeamAbbr;
      
      const matchByDate = await pool.query(`
        SELECT bg.bbref_game_id, bg.status, bg.home_score, bg.away_score
        FROM bbref_games bg
        JOIN teams ht ON bg.home_team_id = ht.team_id
        JOIN teams at ON bg.away_team_id = at.team_id
        WHERE bg.game_date = $1
          AND ht.abbreviation = $2
          AND at.abbreviation = $3
      `, [game.date, nbaHomeAbbr, nbaAwayAbbr]);
      
      if (matchByDate.rows.length === 0) {
        console.log(`  ⚠️  Not found: ${game.date} ${game.awayTeamAbbr} @ ${game.homeTeamAbbr}`);
        notFound++;
        continue;
      }
      
      // Found by date/teams
      const foundGame = matchByDate.rows[0];
      
      // Parse start time if available
      const startTimeISO = game.startTime ? parseStartTime(game.date, game.startTime) : null;
      
      if (!dryRun) {
        await pool.query(`
          UPDATE bbref_games
          SET 
            home_score = $1, 
            away_score = $2, 
            status = 'Final',
            start_time = COALESCE(start_time, $4),
            updated_at = now()
          WHERE bbref_game_id = $3
        `, [game.homeScore, game.awayScore, foundGame.bbref_game_id, startTimeISO]);
      }
      
      const timeInfo = startTimeISO ? ` (${game.startTime})` : '';
      console.log(`  ✅ Updated (by date): ${game.date} ${game.awayTeamAbbr} @ ${game.homeTeamAbbr}: ${game.awayScore}-${game.homeScore}${timeInfo}`);
      updated++;
    } else {
      const existingGame = existing.rows[0];
      
      // Only update if scores are different or status isn't Final
      if (existingGame.status === 'Final' && 
          existingGame.home_score === game.homeScore && 
          existingGame.away_score === game.awayScore) {
        continue; // Already up to date
      }
      
      // Parse start time if available
      const startTimeISO = game.startTime ? parseStartTime(game.date, game.startTime) : null;
      
      if (!dryRun) {
        await pool.query(`
          UPDATE bbref_games
          SET 
            home_score = $1, 
            away_score = $2, 
            status = 'Final',
            start_time = COALESCE(start_time, $4),
            updated_at = now()
          WHERE bbref_game_id = $3
        `, [game.homeScore, game.awayScore, bbrefGameId, startTimeISO]);
      }
      
      const timeInfo = startTimeISO ? ` (${game.startTime})` : '';
      console.log(`  ✅ Updated: ${game.date} ${game.awayTeamAbbr} @ ${game.homeTeamAbbr}: ${game.awayScore}-${game.homeScore}${timeInfo}`);
      updated++;
    }
  }
  
  return { updated, notFound };
}

async function main() {
  const args = process.argv.slice(2);
  const monthIndex = args.indexOf('--month');
  const allMonths = args.includes('--all-months');
  const dryRun = args.includes('--dry-run');
  const seasonIndex = args.indexOf('--season');
  
  const season = seasonIndex !== -1 && args[seasonIndex + 1] 
    ? parseInt(args[seasonIndex + 1], 10) 
    : 2026; // Default to 2025-26 season
  
  console.log('='.repeat(80));
  console.log('🏀 Update BBRef Game Scores');
  console.log('='.repeat(80));
  
  if (dryRun) {
    console.log('\n🔍 DRY RUN MODE - No changes will be made\n');
  }
  
  let totalUpdated = 0;
  let totalNotFound = 0;
  
  try {
    if (allMonths) {
      // Scrape all months of the season
      const months = ['october', 'november', 'december', 'january', 'february', 'march', 'april'];
      
      for (const month of months) {
        const games = await scrapeMonthScores(season, month);
        if (games.length > 0) {
          const { updated, notFound } = await updateGameScores(games, dryRun);
          totalUpdated += updated;
          totalNotFound += notFound;
        }
        await sleep(BASE_DELAY_MS);
      }
    } else if (monthIndex !== -1 && args[monthIndex + 1]) {
      const month = args[monthIndex + 1];
      const games = await scrapeMonthScores(season, month);
      const { updated, notFound } = await updateGameScores(games, dryRun);
      totalUpdated = updated;
      totalNotFound = notFound;
    } else {
      // Default: scrape october and november (current season months played)
      for (const month of ['october', 'november']) {
        const games = await scrapeMonthScores(season, month);
        if (games.length > 0) {
          const { updated, notFound } = await updateGameScores(games, dryRun);
          totalUpdated += updated;
          totalNotFound += notFound;
        }
        await sleep(BASE_DELAY_MS);
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log(`\n✅ Complete: Updated ${totalUpdated} games, ${totalNotFound} not found`);
    
    // Show current Detroit record
    const detRecord = await pool.query(`
      WITH det_games AS (
        SELECT 
          bg.bbref_game_id,
          CASE 
            WHEN bg.home_team_id = (SELECT team_id FROM teams WHERE abbreviation = 'DET') 
            THEN bg.home_score > bg.away_score
            ELSE bg.away_score > bg.home_score
          END as won
        FROM bbref_games bg
        WHERE bg.status = 'Final'
          AND (bg.home_team_id = (SELECT team_id FROM teams WHERE abbreviation = 'DET')
               OR bg.away_team_id = (SELECT team_id FROM teams WHERE abbreviation = 'DET'))
      )
      SELECT 
        SUM(CASE WHEN won THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN NOT won THEN 1 ELSE 0 END) as losses
      FROM det_games
    `);
    
    if (detRecord.rows[0]) {
      console.log(`\n🏀 Detroit record: ${detRecord.rows[0].wins}-${detRecord.rows[0].losses}`);
    }
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();


