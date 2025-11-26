import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

async function checkCompletedGamesCoverage() {
  const result = await pool.query(`
    SELECT 
      COUNT(*) as total_completed,
      COUNT(CASE WHEN EXISTS (
        SELECT 1 FROM bbref_team_game_stats btgs 
        WHERE btgs.game_id = bg.bbref_game_id
      ) THEN 1 END) as with_stats
    FROM bbref_games bg
    WHERE bg.game_date <= CURRENT_DATE
      AND bg.status = 'Final'
  `);
  
  const total = parseInt(result.rows[0].total_completed);
  const withStats = parseInt(result.rows[0].with_stats);
  const coverage = total > 0 ? Math.round((withStats / total) * 100) : 0;
  
  console.log('\n📊 Completed Games Coverage:');
  console.log(`   Total completed games: ${total}`);
  console.log(`   Games with team stats: ${withStats}`);
  console.log(`   Coverage: ${coverage}%`);
  console.log(`   Missing: ${total - withStats} games\n`);
  
  await pool.end();
}

checkCompletedGamesCoverage();


