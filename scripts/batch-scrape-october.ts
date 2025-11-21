import 'dotenv/config';
import { Pool } from 'pg';
import { processCSVBoxScore } from './scrape-bbref-csv-boxscores';

/**
 * Batch Scrape October Box Scores
 * 
 * Scrapes all box scores for October 2025
 * 
 * Usage:
 *   tsx scripts/batch-scrape-october.ts
 *   tsx scripts/batch-scrape-october.ts --dry-run
 *   tsx scripts/batch-scrape-october.ts --year 2024 --month 10
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getGamesForMonth(year: number, month: number): Promise<Array<{ game_id: string; game_date: string; home_abbr: string; away_abbr: string }>> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  
  console.log(`\n📅 Finding games for ${year}-${String(month).padStart(2, '0')} (${startDate} to ${endDate})...\n`);
  
  // Try bbref_schedule first (primary source)
  const bbrefResult = await pool.query(`
    SELECT 
      bs.canonical_game_id as game_id,
      bs.game_date::text as game_date,
      bs.home_team_abbr as home_abbr,
      bs.away_team_abbr as away_abbr
    FROM bbref_schedule bs
    WHERE bs.game_date >= $1::date
      AND bs.game_date <= $2::date
      AND bs.canonical_game_id IS NOT NULL
    ORDER BY bs.game_date, bs.home_team_abbr
  `, [startDate, endDate]);
  
  if (bbrefResult.rows.length > 0) {
    console.log(`✅ Found ${bbrefResult.rows.length} games in bbref_schedule`);
    return bbrefResult.rows;
  }
  
  // Fallback to games table
  console.log('   ⚠️  No games in bbref_schedule, checking games table...');
  const gamesResult = await pool.query(`
    SELECT 
      g.game_id,
      DATE(g.start_time AT TIME ZONE 'America/New_York')::text as game_date,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE DATE(g.start_time AT TIME ZONE 'America/New_York') >= $1::date
      AND DATE(g.start_time AT TIME ZONE 'America/New_York') <= $2::date
    ORDER BY g.start_time
  `, [startDate, endDate]);
  
  if (gamesResult.rows.length > 0) {
    console.log(`✅ Found ${gamesResult.rows.length} games in games table`);
    return gamesResult.rows;
  }
  
  console.log('   ⚠️  No games found for this month');
  return [];
}

async function checkAlreadyScraped(gameId: string): Promise<boolean> {
  const result = await pool.query(`
    SELECT COUNT(*) as count
    FROM scraped_boxscores
    WHERE game_id = $1
  `, [gameId]);
  
  return parseInt(result.rows[0].count, 10) > 0;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const yearIndex = args.indexOf('--year');
  const monthIndex = args.indexOf('--month');
  
  const year = yearIndex !== -1 && args[yearIndex + 1] 
    ? parseInt(args[yearIndex + 1], 10) 
    : 2025;
  const month = monthIndex !== -1 && args[monthIndex + 1]
    ? parseInt(args[monthIndex + 1], 10)
    : 10;
  
  if (dryRun) {
    console.log('🔍 [DRY RUN MODE] - No data will be scraped\n');
  }
  
  const games = await getGamesForMonth(year, month);
  
  if (games.length === 0) {
    console.log('\n❌ No games found for this month. Exiting.');
    await pool.end();
    return;
  }
  
  console.log(`\n📊 Processing ${games.length} games...\n`);
  
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  const errors: Array<{ game_id: string; error: string }> = [];
  
  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    const progress = `[${i + 1}/${games.length}]`;
    
    console.log(`\n${progress} Processing: ${game.away_abbr} @ ${game.home_abbr} (${game.game_date})`);
    console.log(`   Game ID: ${game.game_id}`);
    
    // Check if already scraped
    const alreadyScraped = await checkAlreadyScraped(game.game_id);
    if (alreadyScraped) {
      console.log(`   ⏭️  Already scraped, skipping...`);
      skipCount++;
      continue;
    }
    
    if (dryRun) {
      console.log(`   [DRY RUN] Would scrape box score for this game`);
      successCount++;
      continue;
    }
    
    try {
      const success = await processCSVBoxScore(game.game_id, false);
      
      if (success) {
        console.log(`   ✅ Successfully scraped`);
        successCount++;
      } else {
        console.log(`   ⚠️  Scraping returned false (may have partial data)`);
        errorCount++;
        errors.push({ game_id: game.game_id, error: 'Scraping returned false' });
      }
      
      // Rate limiting between games (4 seconds + jitter)
      if (i < games.length - 1) {
        const delay = 4000 + Math.random() * 800; // 4-4.8 seconds
        console.log(`   ⏳ Waiting ${Math.ceil(delay / 1000)}s before next game...`);
        await sleep(delay);
      }
    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message}`);
      errorCount++;
      errors.push({ game_id: game.game_id, error: error.message });
      
      // Continue with next game even if this one failed
      console.log(`   ⏭️  Continuing with next game...`);
      
      // Shorter delay on error (don't waste time)
      if (i < games.length - 1) {
        await sleep(2000);
      }
    }
  }
  
  // Final summary
  console.log(`\n\n${'='.repeat(60)}`);
  console.log(`📊 BATCH SCRAPING SUMMARY`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Total games: ${games.length}`);
  console.log(`✅ Successfully scraped: ${successCount}`);
  console.log(`⏭️  Skipped (already scraped): ${skipCount}`);
  console.log(`❌ Errors: ${errorCount}`);
  
  if (errors.length > 0) {
    console.log(`\n❌ Failed games:`);
    errors.forEach((e, idx) => {
      console.log(`   ${idx + 1}. ${e.game_id}: ${e.error}`);
    });
    console.log(`\n💡 Tip: Re-run the script to retry failed games`);
  }
  
  if (successCount > 0) {
    console.log(`\n💡 Tip: Run 'tsx scripts/resolve-missing-player-ids.ts --auto' to resolve player IDs`);
  }
  
  await pool.end();
}

if (require.main === module || import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
}

