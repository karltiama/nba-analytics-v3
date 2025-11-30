import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  console.log('=== Checking Start Times in bbref_schedule ===\n');

  // Check today's games
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const todayGames = await pool.query(`
    SELECT 
      bbref_game_id,
      game_date,
      start_time,
      home_team_abbr,
      away_team_abbr
    FROM bbref_schedule
    WHERE game_date = $1::date
    ORDER BY COALESCE(start_time, game_date::timestamptz) ASC
    LIMIT 10
  `, [today]);

  console.log(`Today's games (${today}):`);
  todayGames.rows.forEach(r => {
    const timeStr = r.start_time 
      ? new Date(r.start_time).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
      : 'NO TIME';
    console.log(`  ${r.away_team_abbr} @ ${r.home_team_abbr}: ${timeStr}`);
  });

  // Check how many games have start_time populated
  const stats = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(start_time) as with_time,
      COUNT(*) - COUNT(start_time) as without_time
    FROM bbref_schedule
    WHERE game_date >= CURRENT_DATE
  `);

  console.log('\nUpcoming games:');
  console.log(`  Total: ${stats.rows[0].total}`);
  console.log(`  With start_time: ${stats.rows[0].with_time}`);
  console.log(`  Without start_time: ${stats.rows[0].without_time}`);

  await pool.end();
}

main().catch(console.error);






