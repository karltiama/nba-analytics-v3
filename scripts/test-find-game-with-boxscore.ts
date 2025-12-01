import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function main() {
  const result = await pool.query(`
    SELECT 
      g.game_id, 
      g.start_time, 
      ht.abbreviation as home, 
      at.abbreviation as away, 
      (SELECT COUNT(*) FROM player_game_stats WHERE game_id = g.game_id) as boxscore_count
    FROM games g
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE g.status = 'Final'
      AND g.start_time < NOW() - INTERVAL '1 day'
      AND g.start_time > NOW() - INTERVAL '30 days'
    ORDER BY g.start_time DESC
    LIMIT 5
  `);
  
  console.log('Recent Final games:');
  result.rows.forEach(row => {
    console.log(`  ${row.game_id}: ${row.away} @ ${row.home} (${row.start_time.toISOString().split('T')[0]}) - Box scores: ${row.boxscore_count}`);
  });
  
  await pool.end();
}

main();

