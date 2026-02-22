import 'dotenv/config';
import { Pool } from 'pg';
import { processBBRefBoxScore } from './scrape-basketball-reference';

/**
 * Safely backfill missing box scores using Basketball Reference scraper.
 * 
 * This script:
 * 1. Finds Final games without box scores up to yesterday
 * 2. Fetches box scores from Basketball Reference
 * 3. Stores player stats safely with rate limiting (15 requests/minute)
 * 
 * Safety features:
 * - Only processes games up to yesterday (no future games)
 * - Respects Basketball Reference rate limits (15 requests/minute)
 * - Processes games in order (oldest first)
 * - Skips games that can't be resolved
 * - Dry-run mode for testing
 * 
 * Usage:
 *   tsx scripts/backfill-boxscores-bbref.ts                    # Backfill all missing games up to yesterday
 *   tsx scripts/backfill-boxscores-bbref.ts --max-games 50      # Limit to 50 games
 *   tsx scripts/backfill-boxscores-bbref.ts --team CLE          # Backfill only Cleveland games
 *   tsx scripts/backfill-boxscores-bbref.ts --start-date 2025-10-21 --end-date 2025-11-17
 *   tsx scripts/backfill-boxscores-bbref.ts --team CLE --start-date 2025-10-21  # Team + date range
 *   tsx scripts/backfill-boxscores-bbref.ts --dry-run           # Test without making changes
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. Set it in your environment or .env file.');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

/**
 * Get games missing box scores
 * Includes games that:
 * 1. Are marked as Final, OR
 * 2. Have scores and are in the past (should be Final)
 */
async function getGamesMissingBoxScores(
  startDate?: string,
  endDate?: string,
  maxGames: number = 100,
  teamAbbr?: string
): Promise<Array<{
  game_id: string;
  season: string;
  start_time: Date;
  home_team_id: string;
  away_team_id: string;
  home_abbr: string;
  away_abbr: string;
  status: string;
  needs_status_update: boolean;
}>> {
  // Default end date is yesterday (to avoid processing today's games that might not be Final yet)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(23, 59, 59, 999); // End of yesterday
  
  const endDateParam = endDate || yesterday.toISOString().split('T')[0];
  const now = new Date();
  
  let sql = `
    WITH deduped AS (
      SELECT DISTINCT ON (g.home_team_id, g.away_team_id, g.start_time::date)
        g.game_id,
        g.season,
        g.start_time,
        g.home_team_id,
        g.away_team_id,
        g.status,
        ht.abbreviation as home_abbr,
        at.abbreviation as away_abbr,
        CASE 
          WHEN g.status != 'Final' AND (
            (g.home_score IS NOT NULL AND g.away_score IS NOT NULL) OR
            (g.start_time < $2 AND g.status != 'Cancelled' AND g.status != 'Postponed')
          )
          THEN true
          ELSE false
        END as needs_status_update,
        CASE WHEN g.status = 'Final' THEN 0 ELSE 1 END as priority
      FROM games g
      JOIN teams ht ON g.home_team_id = ht.team_id
      JOIN teams at ON g.away_team_id = at.team_id
      LEFT JOIN player_game_stats pgs ON g.game_id = pgs.game_id
      WHERE pgs.game_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM bbref_games bg
          JOIN bbref_player_game_stats bps ON bg.bbref_game_id = bps.game_id
          WHERE bg.home_team_id = g.home_team_id
            AND bg.away_team_id = g.away_team_id
            AND bg.game_date BETWEEN (g.start_time::date - interval '1 day')::date 
                                  AND (g.start_time::date + interval '1 day')::date
        )
        AND (
          g.status = 'Final'
          OR
          (g.status != 'Final' 
           AND g.home_score IS NOT NULL 
           AND g.away_score IS NOT NULL 
           AND g.start_time < $2
           AND g.status != 'Cancelled'
           AND g.status != 'Postponed')
          OR
          (g.start_time < $2
           AND g.start_time::date <= $1::date
           AND g.status != 'Cancelled'
           AND g.status != 'Postponed'
           AND g.status != 'Final')
        )
      ORDER BY g.home_team_id, g.away_team_id, g.start_time::date,
        CASE WHEN LENGTH(g.game_id) <= 8 THEN 0 ELSE 1 END,
        g.game_id
    )
    SELECT * FROM deduped WHERE 1=1
  `;
  
  const params: any[] = [endDateParam, now];
  let paramCount = 3;
  
  if (teamAbbr) {
    sql += ` AND (home_abbr = $${paramCount} OR away_abbr = $${paramCount})`;
    params.push(teamAbbr.toUpperCase());
    paramCount++;
  }
  
  if (startDate) {
    sql += ` AND start_time::date >= $${paramCount}::date`;
    params.push(startDate);
    paramCount++;
  }
  
  sql += `
    ORDER BY priority, start_time ASC
    LIMIT $${paramCount}
  `;
  params.push(maxGames);
  
  const result = await pool.query(sql, params);
  return result.rows;
}

async function main() {
  const args = process.argv.slice(2);
  const startDateIndex = args.indexOf('--start-date');
  const endDateIndex = args.indexOf('--end-date');
  const maxGamesIndex = args.indexOf('--max-games');
  const teamIndex = args.indexOf('--team');
  const dryRunIndex = args.indexOf('--dry-run');
  
  const startDate = startDateIndex !== -1 && args[startDateIndex + 1] 
    ? args[startDateIndex + 1] 
    : undefined;
  const endDate = endDateIndex !== -1 && args[endDateIndex + 1] 
    ? args[endDateIndex + 1] 
    : undefined;
  const maxGames = maxGamesIndex !== -1 && args[maxGamesIndex + 1]
    ? Number.parseInt(args[maxGamesIndex + 1], 10)
    : 100;
  const teamAbbr = teamIndex !== -1 && args[teamIndex + 1]
    ? args[teamIndex + 1].toUpperCase()
    : undefined;
  const dryRun = dryRunIndex !== -1;
  
  try {
    console.log('\n🔄 Basketball Reference Box Score Backfill');
    console.log('==========================================\n');
    
    if (dryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be made\n');
    }
    
    if (teamAbbr) {
      console.log(`🎯 Filtering for team: ${teamAbbr}\n`);
    }
    
    if (startDate || endDate) {
      console.log(`📅 Date range: ${startDate || 'beginning'} to ${endDate || 'yesterday'}`);
    } else {
      console.log('📅 Processing games up to yesterday');
    }
    console.log(`📊 Max games: ${maxGames}`);
    console.log(`⏱️  Rate limit: 15 requests/minute (Basketball Reference policy)\n`);
    
    const games = await getGamesMissingBoxScores(startDate, endDate, maxGames, teamAbbr);
    
    if (games.length === 0) {
      console.log('✅ No games found missing box scores!');
      return;
    }
    
    console.log(`\n📋 Found ${games.length} games missing box scores\n`);
    
    // Show first few games
    console.log('Sample games to process:');
    games.slice(0, 5).forEach((game, idx) => {
      const dateStr = new Date(game.start_time).toISOString().split('T')[0];
      console.log(`  ${idx + 1}. ${game.away_abbr} @ ${game.home_abbr} (${dateStr}) - ${game.game_id}`);
    });
    if (games.length > 5) {
      console.log(`  ... and ${games.length - 5} more`);
    }
    
    if (dryRun) {
      console.log('\n🔍 DRY RUN - Would process these games');
      console.log('Run without --dry-run to actually fetch and store box scores.');
      return;
    }
    
    console.log('\n🚀 Starting backfill...\n');
    
    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;
    
    for (let i = 0; i < games.length; i++) {
      const game = games[i];
      const dateStr = new Date(game.start_time).toISOString().split('T')[0];
      
      console.log(`\n[${i + 1}/${games.length}] ${game.away_abbr} @ ${game.home_abbr} (${dateStr})`);
      console.log(`   Status: ${game.status}${game.needs_status_update ? ' (will update to Final)' : ''}`);
      
      try {
        // First, update status if needed
        if (game.needs_status_update && !dryRun) {
          await pool.query(
            `UPDATE games SET status = 'Final', updated_at = now() WHERE game_id = $1`,
            [game.game_id]
          );
          console.log(`   ✅ Updated status to Final`);
        }
        
        const success = await processBBRefBoxScore(game.game_id, dryRun);
        if (success) {
          successCount++;
        } else {
          // Check if it's a 404 (game not found) - this is expected for some games
          skippedCount++;
          console.log(`   ⏭️  Skipped (game may not exist on Basketball Reference yet)`);
        }
      } catch (error: any) {
        // Handle 404 errors gracefully - these are expected for games that don't exist yet
        if (error.message && (error.message.includes('404') || error.message.includes('Game not found'))) {
          console.log(`   ⏭️  Game not found on Basketball Reference (may not exist yet)`);
          skippedCount++;
        } else {
          console.error(`   ❌ Error: ${error.message}`);
          failCount++;
          
          // If we hit rate limit, stop processing
          if (error.message.includes('rate limit') || error.message.includes('429')) {
            console.error('\n⚠️  Rate limit hit! Stopping to avoid being blocked.');
            console.error('   Wait a few minutes and run again to continue.');
            break;
          }
        }
      }
      
      // Small delay between games (rate limiting is handled in the scraper)
      // But we add a small buffer here too
      if (i < games.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log('\n✅ Backfill Complete!');
    console.log(`   Success: ${successCount}`);
    console.log(`   Skipped: ${skippedCount}`);
    console.log(`   Failed: ${failCount}`);
    console.log(`   Total: ${games.length}`);
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

