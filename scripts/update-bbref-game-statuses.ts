import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Update bbref_games statuses based on date
 * 
 * Rules:
 * - Games from yesterday or earlier that are still "Scheduled" -> "Final"
 * - Games with scores -> "Final"
 * 
 * Usage:
 *   tsx scripts/update-bbref-game-statuses.ts --dry-run  # Preview changes
 *   tsx scripts/update-bbref-game-statuses.ts             # Actually update
 *   tsx scripts/update-bbref-game-statuses.ts --date 2025-12-01  # Update specific date
 */

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function updateStatuses(dryRun: boolean = false, targetDate?: string) {
  console.log(`\n${dryRun ? '🔍 DRY RUN - Previewing changes' : '🔧 UPDATING BBREF_GAMES STATUSES'}\n`);

  // Calculate yesterday (local date)
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  
  // Use target date if provided, otherwise use yesterday
  const cutoffDate = targetDate || yesterdayStr;
  
  console.log(`📅 Updating games up to: ${cutoffDate}\n`);

  // Find games that should be Final but aren't
  const query = `
    SELECT 
      bg.bbref_game_id,
      bg.game_date,
      bg.status,
      bg.home_team_abbr,
      bg.away_team_abbr,
      bg.home_score,
      bg.away_score
    FROM bbref_games bg
    WHERE bg.status = 'Scheduled'
      AND (
        -- Has scores
        (bg.home_score IS NOT NULL AND bg.away_score IS NOT NULL)
        OR
        -- Game date is yesterday or earlier
        bg.game_date <= $1::date
      )
    ORDER BY bg.game_date DESC, bg.home_team_abbr, bg.away_team_abbr
  `;

  const result = await pool.query(query, [cutoffDate]);
  const games = result.rows;

  console.log(`Found ${games.length} games that should be marked as Final:\n`);

  if (games.length === 0) {
    console.log('✅ All games are up to date!');
    await pool.end();
    return;
  }

  // Group by reason
  const byReason = {
    hasScores: games.filter(g => g.home_score !== null && g.away_score !== null),
    pastDate: games.filter(g => g.home_score === null || g.away_score === null),
  };

  console.log(`  📊 Games with scores: ${byReason.hasScores.length}`);
  console.log(`  📅 Games from past dates: ${byReason.pastDate.length}\n`);

  // Show sample
  console.log('Sample games to update (first 10):');
  games.slice(0, 10).forEach((game, idx) => {
    const hasScores = game.home_score !== null && game.away_score !== null;
    const reason = hasScores 
      ? 'has scores' 
      : `past date (${typeof game.game_date === 'string' ? game.game_date : game.game_date.toISOString().split('T')[0]})`;
    const score = hasScores
      ? `${game.away_score}-${game.home_score}` 
      : 'no score';
    const gameDateStr = typeof game.game_date === 'string' ? game.game_date : game.game_date.toISOString().split('T')[0];
    console.log(`  ${idx + 1}. ${gameDateStr} ${game.away_team_abbr} @ ${game.home_team_abbr} (${score}) - ${reason}`);
  });

  if (games.length > 10) {
    console.log(`  ... and ${games.length - 10} more`);
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

    const updateQuery = `
      UPDATE bbref_games
      SET status = 'Final', updated_at = now()
      WHERE bbref_game_id = ANY($1::text[])
        AND status = 'Scheduled'
    `;

    const gameIds = games.map(g => g.bbref_game_id);
    const updateResult = await client.query(updateQuery, [gameIds]);

    await client.query('COMMIT');
    console.log(`\n✅ Successfully updated ${updateResult.rowCount} game statuses to 'Final'!`);
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
const dateIndex = args.indexOf('--date');
const targetDate = dateIndex >= 0 && args[dateIndex + 1] ? args[dateIndex + 1] : undefined;

updateStatuses(dryRun, targetDate).catch(console.error);

