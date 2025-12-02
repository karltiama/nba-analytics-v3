import 'dotenv/config';
import { Pool } from 'pg';
import { processBBRefBoxScore } from './scrape-basketball-reference';

/**
 * Batch scrape missing BBRef games
 * 
 * Identifies games in bbref_games that don't have player stats
 * and scrapes them systematically, prioritizing Final games
 * 
 * Usage:
 *   tsx scripts/batch-scrape-missing-bbref-games.ts --limit 10 --dry-run
 *   tsx scripts/batch-scrape-missing-bbref-games.ts --limit 50 --status Final
 *   tsx scripts/batch-scrape-missing-bbref-games.ts --start-date 2025-10-22 --end-date 2025-11-01
 *   tsx scripts/batch-scrape-missing-bbref-games.ts --team CLE  # Scrape only Cleveland games
 *   tsx scripts/batch-scrape-missing-bbref-games.ts --only-final  # Only scrape games marked Final
 */

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

interface MissingGame {
  bbref_game_id: string;
  game_date: Date;
  home_team_abbr: string;
  away_team_abbr: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
}

async function getMissingGames(
  limit?: number,
  status?: string,
  startDate?: string,
  endDate?: string,
  gameIds?: string[],
  teamAbbr?: string,
  includeLikelyFinal: boolean = true
): Promise<MissingGame[]> {
  // Default end date to yesterday to avoid scraping today's games that might not be Final yet
  // Use local date, not UTC, to match user's timezone
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const defaultEndDate = endDate || `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  
  let query = `
    SELECT 
      bg.bbref_game_id,
      bg.game_date,
      bg.home_team_abbr,
      bg.away_team_abbr,
      bg.status,
      bg.home_score,
      bg.away_score
    FROM bbref_games bg
    WHERE NOT EXISTS (
      SELECT 1 FROM bbref_player_game_stats bpgs 
      WHERE bpgs.game_id = bg.bbref_game_id
    )
    -- Always filter by date up to yesterday (or specified end date)
    AND bg.game_date <= $1::date
  `;
  
  const params: any[] = [defaultEndDate];
  let paramCount = 2;
  
  // Filter by team abbreviation (home or away)
  if (teamAbbr) {
    query += ` AND (bg.home_team_abbr = $${paramCount} OR bg.away_team_abbr = $${paramCount})`;
    params.push(teamAbbr);
    paramCount++;
  }
  
  // If specific game IDs provided, filter by those
  if (gameIds && gameIds.length > 0) {
    query += ` AND bg.bbref_game_id = ANY($${paramCount}::text[])`;
    params.push(gameIds);
    paramCount++;
  }
  
  if (status) {
    query += ` AND bg.status = $${paramCount}`;
    params.push(status);
    paramCount++;
  } else {
    // By default, exclude Scheduled games UNLESS they're from yesterday or earlier
    // (games from yesterday should be Final by now, even if status hasn't been updated)
    // Only exclude Scheduled games that are today or in the future
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    query += ` AND (
      bg.status != 'Scheduled' 
      OR (bg.status = 'Scheduled' AND bg.game_date < $${paramCount}::date)
    )`;
    params.push(todayStr);
    paramCount++;
  }
  
  if (startDate) {
    query += ` AND bg.game_date >= $${paramCount}`;
    params.push(startDate);
    paramCount++;
  }
  
  // Prioritize Final games, then games with scores, then by date (oldest first)
  query += ` ORDER BY 
    CASE WHEN bg.status = 'Final' THEN 0 ELSE 1 END,
    CASE WHEN bg.home_score IS NOT NULL AND bg.away_score IS NOT NULL THEN 0 ELSE 1 END,
    bg.game_date ASC
  `;
  
  if (limit) {
    query += ` LIMIT $${paramCount}`;
    params.push(limit);
  }
  
  const result = await pool.query(query, params);
  return result.rows;
}

async function batchScrapeMissingGames(
  limit?: number,
  status?: string,
  startDate?: string,
  endDate?: string,
  gameIds?: string[],
  teamAbbr?: string,
  includeLikelyFinal: boolean = true,
  dryRun: boolean = false
) {
  console.log('\n🚀 Batch Scraping Missing BBRef Games\n');
  console.log('='.repeat(100));
  
  if (teamAbbr) {
    console.log(`🎯 Filtering for team: ${teamAbbr}\n`);
  }
  
  // Always use yesterday as the maximum date (never scrape today's games)
  // Use local date, not UTC, to match user's timezone
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  
  // Cap endDate at yesterday if provided, otherwise use yesterday
  const endDateToUse = endDate 
    ? (endDate <= yesterdayStr ? endDate : yesterdayStr)
    : yesterdayStr;
  
  console.log(`📅 Scraping all games up to: ${endDateToUse} (yesterday - never scrapes today's games)\n`);
  
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No scraping will be performed\n');
  }
  
  // Get missing games - pass the capped endDate
  const missingGames = await getMissingGames(limit, status, startDate, endDateToUse, gameIds, teamAbbr, includeLikelyFinal);
  
  if (missingGames.length === 0) {
    console.log('✅ No missing games found!');
    return;
  }
  
  console.log(`\nFound ${missingGames.length} games missing player stats\n`);
  
  // Group by status
  const byStatus = new Map<string, MissingGame[]>();
  missingGames.forEach(game => {
    const status = game.status || 'Unknown';
    if (!byStatus.has(status)) {
      byStatus.set(status, []);
    }
    byStatus.get(status)!.push(game);
  });
  
  console.log('Games by status:');
  Array.from(byStatus.entries()).forEach(([status, games]) => {
    console.log(`  ${status}: ${games.length} games`);
  });
  
  if (dryRun) {
    console.log('\n📋 Games that would be scraped:');
    missingGames.slice(0, 20).forEach((game, idx) => {
      const date = new Date(game.game_date).toISOString().split('T')[0];
      console.log(`  ${idx + 1}. ${date} - ${game.away_team_abbr} @ ${game.home_team_abbr} (${game.status})`);
    });
    if (missingGames.length > 20) {
      console.log(`  ... and ${missingGames.length - 20} more`);
    }
    console.log('\n⚠️  This was a dry run. Run without --dry-run to actually scrape.');
    return;
  }
  
  // Scrape games
  console.log('\n📥 Starting batch scrape...\n');
  
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;
  
  for (let i = 0; i < missingGames.length; i++) {
    const game = missingGames[i];
    const date = new Date(game.game_date).toISOString().split('T')[0];
    
    console.log(`\n[${i + 1}/${missingGames.length}] Processing: ${date} - ${game.away_team_abbr} @ ${game.home_team_abbr}`);
    console.log(`   Status: ${game.status || 'Unknown'}`);
    
    try {
      // Use processBBRefBoxScore which writes directly to bbref_player_game_stats
      const result = await processBBRefBoxScore(game.bbref_game_id, false);
      
      if (result) {
        successCount++;
        console.log(`   ✅ Successfully scraped`);
      } else {
        failCount++;
        console.log(`   ❌ Failed to scrape`);
      }
    } catch (error: any) {
      failCount++;
      console.error(`   ❌ Error: ${error.message}`);
    }
    
    // Progress update every 10 games
    if ((i + 1) % 10 === 0) {
      console.log(`\n📊 Progress: ${i + 1}/${missingGames.length} games processed`);
      console.log(`   ✅ Success: ${successCount} | ❌ Failed: ${failCount} | ⏭️  Skipped: ${skippedCount}`);
    }
  }
  
  console.log('\n' + '='.repeat(100));
  console.log('\n📊 BATCH SCRAPE COMPLETE\n');
  console.log('='.repeat(100));
  console.log(`Total games processed: ${missingGames.length}`);
  console.log(`✅ Successfully scraped: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`⏭️  Skipped: ${skippedCount}`);
  
  if (successCount > 0) {
    console.log(`\n💡 Next step: Populate player stats from scraped data`);
    console.log(`   Run: npx tsx scripts/populate-bbref-stats.ts --players-only`);
    console.log(`   Then: npx tsx scripts/populate-bbref-stats.ts --teams-only`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  const limitIndex = args.indexOf('--limit');
  const statusIndex = args.indexOf('--status');
  const startDateIndex = args.indexOf('--start-date');
  const endDateIndex = args.indexOf('--end-date');
  const gameIdsIndex = args.indexOf('--game-ids');
  const teamIndex = args.indexOf('--team');
  const onlyFinal = args.includes('--only-final');
  const dryRun = args.includes('--dry-run');
  
  const limit = limitIndex !== -1 && args[limitIndex + 1] 
    ? parseInt(args[limitIndex + 1], 10) 
    : undefined;
  
  const status = statusIndex !== -1 && args[statusIndex + 1]
    ? args[statusIndex + 1]
    : undefined;
  
  const startDate = startDateIndex !== -1 && args[startDateIndex + 1]
    ? args[startDateIndex + 1]
    : undefined;
  
  const endDate = endDateIndex !== -1 && args[endDateIndex + 1]
    ? args[endDateIndex + 1]
    : undefined;
  
  const gameIds = gameIdsIndex !== -1 && args[gameIdsIndex + 1]
    ? args[gameIdsIndex + 1].split(',').map(id => id.trim())
    : undefined;
  
  const teamAbbr = teamIndex !== -1 && args[teamIndex + 1]
    ? args[teamIndex + 1].toUpperCase()
    : undefined;
  
  // By default, include games that are likely Final (have scores or are in the past)
  // Use --only-final to only scrape games explicitly marked Final
  const includeLikelyFinal = !onlyFinal;
  
  try {
    await batchScrapeMissingGames(limit, status, startDate, endDate, gameIds, teamAbbr, includeLikelyFinal, dryRun);
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

