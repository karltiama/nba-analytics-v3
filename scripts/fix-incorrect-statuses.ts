import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Fix games with incorrect statuses based on existing data
 * 
 * Handles:
 * 1. Games with scores but not Final - updates to Final
 * 2. Past games marked as Scheduled that have box scores - updates to Final
 * 3. Future games marked as Final without scores - updates to Scheduled
 * 
 * Usage:
 *   tsx scripts/fix-incorrect-statuses.ts --dry-run  # Preview changes
 *   tsx scripts/fix-incorrect-statuses.ts             # Actually update
 */

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  
  console.log('\n🔧 Fix Incorrect Game Statuses');
  console.log('='.repeat(60));
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }
  
  const now = new Date();
  // Only consider games that are at least 3 hours old to avoid timezone issues
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  
  // Find games with incorrect statuses
  const incorrectGames = await pool.query(`
    SELECT 
      g.game_id,
      g.start_time,
      g.status,
      g.home_score,
      g.away_score,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr,
      EXISTS(SELECT 1 FROM player_game_stats pgs WHERE pgs.game_id = g.game_id) as has_boxscore
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE (
      -- Games with scores but not Final
      (g.home_score IS NOT NULL AND g.away_score IS NOT NULL AND g.status != 'Final' AND g.status != 'Cancelled' AND g.status != 'Postponed')
      OR
      -- Past games marked as Scheduled that have box scores (were played)
      -- Only consider games that are at least 3 hours old to avoid timezone issues
      (g.start_time < $2 AND g.status = 'Scheduled' AND EXISTS(SELECT 1 FROM player_game_stats pgs WHERE pgs.game_id = g.game_id))
      OR
      -- Future games marked as Final without scores
      (g.start_time > $1 AND g.status = 'Final' AND (g.home_score IS NULL OR g.away_score IS NULL))
    )
    ORDER BY g.start_time DESC
  `, [now, threeHoursAgo]);
  
  if (incorrectGames.rows.length === 0) {
    console.log('✅ No games with incorrect statuses found!');
    await pool.end();
    return;
  }
  
  console.log(`\n📋 Found ${incorrectGames.rows.length} games with incorrect statuses\n`);
  
  const updates: Array<{
    game_id: string;
    old_status: string;
    new_status: string;
    reason: string;
    fetch_boxscore?: boolean;
  }> = [];
  
  for (const game of incorrectGames.rows) {
    const isPast = new Date(game.start_time) < now;
    const hasScores = game.home_score !== null && game.away_score !== null;
    const hasBoxscore = game.has_boxscore;
    
    let newStatus: string;
    let reason: string;
    
    if (hasScores && game.status !== 'Final') {
      // Has scores but not Final -> should be Final
      newStatus = 'Final';
      reason = 'has scores';
    } else if (isPast && game.status === 'Scheduled' && hasBoxscore) {
      // Past game (at least 3 hours old) marked as Scheduled but has box score -> was played, should be Final
      const hoursAgo = (now.getTime() - new Date(game.start_time).getTime()) / (1000 * 60 * 60);
      if (hoursAgo >= 3) {
        newStatus = 'Final';
        reason = `past game with box score (${Math.floor(hoursAgo)}h ago)`;
      } else {
        continue; // Too recent, might still be in progress
      }
    } else if (!isPast && game.status === 'Final' && !hasScores) {
      // Future game marked as Final without scores -> should be Scheduled
      newStatus = 'Scheduled';
      reason = 'future game marked as Final without scores';
    } else {
      continue; // Skip if we can't determine what to do
    }
    
    updates.push({
      game_id: game.game_id,
      old_status: game.status,
      new_status: newStatus,
      reason,
    });
  }
  
  // Group by new status
  const byNewStatus = updates.reduce((acc, u) => {
    acc[u.new_status] = (acc[u.new_status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log('Summary of changes:');
  Object.entries(byNewStatus).forEach(([status, count]) => {
    console.log(`  → ${status}: ${count} games`);
  });
  
  console.log('\nSample changes (first 10):');
  updates.slice(0, 10).forEach((u, idx) => {
    const game = incorrectGames.rows.find(g => g.game_id === u.game_id);
    const dateStr = new Date(game!.start_time).toISOString().split('T')[0];
    console.log(`  ${idx + 1}. ${dateStr} ${game!.away_abbr} @ ${game!.home_abbr}: "${u.old_status}" → "${u.new_status}" (${u.reason})`);
  });
  
  if (updates.length > 10) {
    console.log(`  ... and ${updates.length - 10} more`);
  }
  
  if (dryRun) {
    console.log('\n🔍 DRY RUN - No changes made');
    console.log('Run without --dry-run to actually apply changes.');
    await pool.end();
    return;
  }
  
  // Actually update
  console.log('\n🔄 Updating statuses...\n');
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    let updated = 0;
    
    for (const update of updates) {
      await client.query(
        `UPDATE games SET status = $1, updated_at = now() WHERE game_id = $2`,
        [update.new_status, update.game_id]
      );
      updated++;
    }
    
    await client.query('COMMIT');
    console.log(`\n✅ Successfully updated ${updated} game statuses!`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ Error updating statuses:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main();

