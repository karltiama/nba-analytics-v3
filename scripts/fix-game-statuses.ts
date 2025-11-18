import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Fix game statuses that are incorrectly formatted (timestamps instead of status values).
 * 
 * Rules:
 * - Games with scores -> 'Final'
 * - Games without scores, in the past -> 'Final' (assume completed)
 * - Games without scores, in the future -> 'Scheduled'
 * 
 * Usage:
 *   tsx scripts/fix-game-statuses.ts --dry-run  # Preview changes
 *   tsx scripts/fix-game-statuses.ts             # Actually update
 */

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

const VALID_STATUSES = ['Final', 'Scheduled', 'InProgress', 'Postponed', 'Cancelled'];

function isValidStatus(status: string | null): boolean {
  if (!status) return false;
  return VALID_STATUSES.includes(status);
}

function shouldBeFinal(game: any): boolean {
  // Has scores
  if (game.home_score !== null && game.away_score !== null) {
    return true;
  }
  
  // Past game without scores (assume it's finished)
  const gameTime = new Date(game.start_time);
  const now = new Date();
  if (gameTime < now) {
    return true;
  }
  
  return false;
}

async function fixStatuses(dryRun: boolean = false) {
  console.log(`\n${dryRun ? '🔍 DRY RUN - Previewing changes' : '🔧 UPDATING STATUSES'}\n`);

  // Find games with invalid statuses
  const invalidStatusGames = await pool.query(`
    SELECT 
      game_id,
      status,
      start_time,
      home_score,
      away_score,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE status IS NULL 
       OR status NOT IN ('Final', 'Scheduled', 'InProgress', 'Postponed', 'Cancelled')
    ORDER BY start_time DESC
  `);

  console.log(`Found ${invalidStatusGames.rows.length} games with invalid statuses\n`);

  if (invalidStatusGames.rows.length === 0) {
    console.log('✅ All game statuses are valid!');
    await pool.end();
    return;
  }

  const updates: Array<{ game_id: string; old_status: string | null; new_status: string; reason: string }> = [];

  for (const game of invalidStatusGames.rows) {
    let newStatus: string;
    let reason: string;

    if (shouldBeFinal(game)) {
      newStatus = 'Final';
      reason = game.home_score !== null && game.away_score !== null 
        ? 'has scores' 
        : 'past game without scores';
    } else {
      newStatus = 'Scheduled';
      reason = 'future game';
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
  updates.slice(0, 10).forEach((u) => {
    const game = invalidStatusGames.rows.find((g) => g.game_id === u.game_id);
    console.log(`  ${game?.away_abbr} @ ${game?.home_abbr}: "${u.old_status || '(null)'}" → "${u.new_status}" (${u.reason})`);
  });

  if (updates.length > 10) {
    console.log(`  ... and ${updates.length - 10} more`);
  }

  if (dryRun) {
    console.log('\n✅ Dry run complete. Run without --dry-run to apply changes.');
    await pool.end();
    return;
  }

  // Actually update
  console.log('\n🔄 Updating statuses...');
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

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

fixStatuses(dryRun).catch(console.error);

