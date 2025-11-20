import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function checkDates() {
  const today = new Date('2025-11-20');
  today.setHours(0, 0, 0, 0);
  
  const result = await pool.query(`
    SELECT 
      g.game_id,
      DATE(g.start_time AT TIME ZONE 'America/New_York') as game_date,
      g.start_time,
      ht.abbreviation as home_abbr,
      at.abbreviation as away_abbr,
      CASE 
        WHEN DATE(g.start_time AT TIME ZONE 'America/New_York') < $1::date THEN 'Past'
        WHEN DATE(g.start_time AT TIME ZONE 'America/New_York') = $1::date THEN 'Today'
        ELSE 'Future'
      END as date_status
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE g.game_id LIKE 'bbref_%'
      AND NOT EXISTS(SELECT 1 FROM player_game_stats pgs WHERE pgs.game_id = g.game_id)
    ORDER BY g.start_time ASC
  `, [today]);
  
  const past = result.rows.filter(r => r.date_status === 'Past');
  const todayGames = result.rows.filter(r => r.date_status === 'Today');
  const future = result.rows.filter(r => r.date_status === 'Future');
  
  console.log(`\nGames without box scores (total: ${result.rows.length}):\n`);
  console.log(`Past today (${today.toISOString().split('T')[0]}): ${past.length}`);
  console.log(`Today: ${todayGames.length}`);
  console.log(`Future: ${future.length}\n`);
  
  if (past.length > 0) {
    console.log('Past games (can be deleted):\n');
    past.slice(0, 20).forEach((game, idx) => {
      console.log(`  ${idx + 1}. ${game.game_id}`);
      console.log(`     ${game.game_date} | ${game.away_abbr} @ ${game.home_abbr}`);
    });
    if (past.length > 20) {
      console.log(`  ... and ${past.length - 20} more`);
    }
  }
  
  if (future.length > 0) {
    console.log('\nFuture games (should keep):\n');
    future.slice(0, 10).forEach((game, idx) => {
      console.log(`  ${idx + 1}. ${game.game_id}`);
      console.log(`     ${game.game_date} | ${game.away_abbr} @ ${game.home_abbr}`);
    });
    if (future.length > 10) {
      console.log(`  ... and ${future.length - 10} more`);
    }
  }
  
  await pool.end();
  
  return { past, todayGames, future };
}

checkDates().catch(console.error);

