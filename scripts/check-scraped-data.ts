import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function checkData(gameId: string) {
  console.log(`\nChecking scraped data for game: ${gameId}\n`);
  
  const result = await pool.query(`
    SELECT 
      team_code,
      COUNT(*) as count,
      COUNT(DISTINCT player_name) as players
    FROM scraped_boxscores
    WHERE game_id = $1
    GROUP BY team_code
    ORDER BY team_code
  `, [gameId]);
  
  console.log('Summary by team:');
  result.rows.forEach(r => {
    console.log(`  ${r.team_code}: ${r.count} rows, ${r.players} unique players`);
  });
  
  const sample = await pool.query(`
    SELECT 
      player_name,
      team_code,
      points,
      rebounds,
      assists,
      minutes,
      started
    FROM scraped_boxscores
    WHERE game_id = $1
    ORDER BY team_code, started DESC, points DESC
    LIMIT 10
  `, [gameId]);
  
  console.log('\nSample records:');
  sample.rows.forEach(r => {
    const starter = r.started ? '⭐' : '';
    const minutes = r.minutes ? Number(r.minutes).toFixed(1) : 'N/A';
    console.log(`  ${starter} ${r.player_name} (${r.team_code}): ${r.points} pts, ${r.rebounds} reb, ${r.assists} ast, ${minutes} min`);
  });
  
  await pool.end();
}

const gameId = process.argv[2] || '1842025102198';
checkData(gameId).catch(console.error);

