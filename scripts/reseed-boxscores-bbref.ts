import 'dotenv/config';
import { Pool } from 'pg';
import { processBBRefBoxScore } from './scrape-basketball-reference';

/**
 * Reseed box scores from Basketball Reference to ensure accuracy
 * 
 * This script:
 * 1. Finds Final games (with or without existing box scores)
 * 2. Re-fetches box scores from Basketball Reference
 * 3. Updates/replaces existing player_game_stats data
 * 
 * Usage:
 *   tsx scripts/reseed-boxscores-bbref.ts --dry-run  # Preview
 *   tsx scripts/reseed-boxscores-bbref.ts --date 2025-11-20  # Specific date
 *   tsx scripts/reseed-boxscores-bbref.ts --days-back 7  # Last 7 days
 *   tsx scripts/reseed-boxscores-bbref.ts --month 2025-10  # All games in October 2025
 *   tsx scripts/reseed-boxscores-bbref.ts --all  # All Final games (careful!)
 */

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function getGamesToReseed(
  targetDate?: string,
  daysBack?: number,
  monthYear?: string,
  allGames: boolean = false
): Promise<Array<{
  game_id: string;
  home_abbr: string;
  away_abbr: string;
  game_date: string; // YYYY-MM-DD format from bbref_schedule
  has_existing_boxscore: boolean;
}>> {
  // Use bbref_schedule as the source of truth for dates and teams
  // Link to games table via canonical_game_id
  // Process games that are Final OR have a date in the past (likely Final but status not updated)
  let query = `
    SELECT 
      bs.canonical_game_id as game_id,
      bs.home_team_abbr as home_abbr,
      bs.away_team_abbr as away_abbr,
      bs.game_date::text as game_date,
      EXISTS(SELECT 1 FROM player_game_stats pgs WHERE pgs.game_id = bs.canonical_game_id) as has_existing_boxscore
    FROM bbref_schedule bs
    JOIN games g ON bs.canonical_game_id = g.game_id
    WHERE bs.home_team_id IS NOT NULL 
      AND bs.away_team_id IS NOT NULL
      AND bs.canonical_game_id IS NOT NULL
      AND (
        g.status = 'Final'
        OR (bs.game_date < CURRENT_DATE AND g.status IN ('Scheduled', 'InProgress', NULL))
      )
  `;
  
  const params: any[] = [];
  let paramCount = 1;
  
  if (allGames) {
    // Get all games from schedule
    query += ` ORDER BY bs.game_date DESC`;
  } else if (targetDate) {
    query += ` AND bs.game_date = $${paramCount}::date`;
    params.push(targetDate);
    paramCount++;
    query += ` ORDER BY bs.game_date DESC`;
  } else if (monthYear) {
    // Format: YYYY-MM (e.g., "2025-10")
    const [year, month] = monthYear.split('-');
    const startDate = `${year}-${month}-01`;
    // Get last day of month
    const monthNum = parseInt(month, 10);
    const lastDay = new Date(parseInt(year, 10), monthNum, 0).getDate();
    const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
    
    console.log(`   Date range: ${startDate} to ${endDate}`);
    
    query += ` AND bs.game_date >= $${paramCount}::date`;
    params.push(startDate);
    paramCount++;
    query += ` AND bs.game_date <= $${paramCount}::date`;
    params.push(endDate);
    paramCount++;
    query += ` ORDER BY bs.game_date DESC`;
  } else if (daysBack) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    
    query += ` AND bs.game_date >= $${paramCount}::date`;
    params.push(startDate.toISOString().split('T')[0]);
    paramCount++;
    query += ` AND bs.game_date <= $${paramCount}::date`;
    params.push(endDate.toISOString().split('T')[0]);
    paramCount++;
    query += ` ORDER BY bs.game_date DESC`;
  } else {
    // Default: today
    const today = new Date().toISOString().split('T')[0];
    query += ` AND bs.game_date = $${paramCount}::date`;
    params.push(today);
    paramCount++;
    query += ` ORDER BY bs.game_date DESC`;
  }
  
  const result = await pool.query(query, params);
  
  return result.rows.map(row => ({
    game_id: row.game_id,
    home_abbr: row.home_abbr,
    away_abbr: row.away_abbr,
    game_date: row.game_date, // Already in YYYY-MM-DD format
    has_existing_boxscore: row.has_existing_boxscore,
  }));
}

async function main() {
  const args = process.argv.slice(2);
  const dateIndex = args.indexOf('--date');
  const daysBackIndex = args.indexOf('--days-back');
  const monthIndex = args.indexOf('--month');
  const allIndex = args.indexOf('--all');
  const dryRunIndex = args.indexOf('--dry-run');
  const maxGamesIndex = args.indexOf('--max-games');
  
  const targetDate = dateIndex !== -1 ? args[dateIndex + 1] : undefined;
  const daysBack = daysBackIndex !== -1 ? parseInt(args[daysBackIndex + 1], 10) : undefined;
  const monthYear = monthIndex !== -1 ? args[monthIndex + 1] : undefined;
  const allGames = allIndex !== -1;
  const dryRun = dryRunIndex !== -1;
  const maxGames = maxGamesIndex !== -1 ? parseInt(args[maxGamesIndex + 1], 10) : undefined;
  
  console.log('\nReseed Box Scores from Basketball Reference');
  console.log('='.repeat(60));
  if (dryRun) {
    console.log('DRY RUN MODE - No changes will be made\n');
  }
  
  if (allGames) {
    console.log('WARNING: Processing ALL Final games - this may take a long time!');
    console.log('Consider using --days-back, --date, or --month instead.\n');
  }
  
  if (monthYear) {
    console.log(`Processing games for month: ${monthYear}\n`);
  }
  
  const games = await getGamesToReseed(targetDate, daysBack, monthYear, allGames);
  
  if (games.length === 0) {
    console.log('No Final games found to reseed');
    await pool.end();
    return;
  }
  
  const gamesToProcess = maxGames ? games.slice(0, maxGames) : games;
  const withBoxscores = gamesToProcess.filter(g => g.has_existing_boxscore).length;
  const withoutBoxscores = gamesToProcess.filter(g => !g.has_existing_boxscore).length;
  
  console.log(`Found ${games.length} Final games`);
  if (maxGames) {
    console.log(`Processing first ${maxGames} games\n`);
  }
  console.log(`Games with existing box scores: ${withBoxscores}`);
  console.log(`Games without box scores: ${withoutBoxscores}\n`);
  
  if (dryRun) {
    console.log('Sample games to reseed (first 10):\n');
    gamesToProcess.slice(0, 10).forEach((game, idx) => {
      const dateStr = typeof game.game_date === 'string' ? game.game_date : game.game_date.toISOString().split('T')[0];
      const existing = game.has_existing_boxscore ? 'has boxscore' : 'no boxscore';
      console.log(`  ${idx + 1}. ${game.away_abbr} @ ${game.home_abbr} (${dateStr}) - ${existing}`);
    });
    if (gamesToProcess.length > 10) {
      console.log(`  ... and ${gamesToProcess.length - 10} more`);
    }
    console.log('\nRun without --dry-run to actually reseed box scores.');
    await pool.end();
    return;
  }
  
  console.log('Starting reseed...\n');
  console.log('Note: Basketball Reference rate limit is 15 requests/minute');
  console.log('This script will automatically rate limit requests.\n');
  
  let success = 0;
  let failed = 0;
  let skipped = 0;
  
  for (let i = 0; i < gamesToProcess.length; i++) {
    const game = gamesToProcess[i];
    const dateStr = typeof game.game_date === 'string' ? game.game_date : game.game_date.toISOString().split('T')[0];
    
    console.log(`\n[${i + 1}/${gamesToProcess.length}] ${game.away_abbr} @ ${game.home_abbr} (${dateStr})`);
    
    if (game.has_existing_boxscore) {
      console.log('  Replacing existing box score...');
    } else {
      console.log('  Fetching new box score...');
    }
    
    try {
      const result = await processBBRefBoxScore(game.game_id, false);
      
      if (result) {
        success++;
        console.log('  Successfully fetched/updated box score');
      } else {
        skipped++;
        console.log('  No box score data available (game may not be Final yet or data not available)');
      }
    } catch (error: any) {
      failed++;
      console.error(`  Error: ${error.message}`);
      
      // Check for rate limit
      if (error.message.includes('rate limit') || error.message.includes('429')) {
        console.error('\nRate limit hit! Stopping to avoid being blocked.');
        console.error('Wait a few minutes and run again to continue.');
        break;
      }
    }
    
    // Rate limiting: wait between requests (Basketball Reference allows 15/min)
    if (i < gamesToProcess.length - 1) {
      // Wait 4 seconds between requests (15 requests/minute)
      await new Promise(resolve => setTimeout(resolve, 4000));
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('Reseed Complete!');
  console.log(`  Success: ${success}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total: ${gamesToProcess.length}`);
  
  await pool.end();
}

main().catch(console.error);

