import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

(async () => {
  const nullScores = await pool.query(
    "select count(*) as count from games where game_id like '184%' and (home_score is null or away_score is null)",
  );
  console.log('Games with null scores:', nullScores.rows[0]);

  const examples = await pool.query(
    "select game_id, status, home_score, away_score from games where game_id like '184%' and (home_score is null or away_score is null) limit 10",
  );
  console.log('\nExamples with null scores:');
  console.log(JSON.stringify(examples.rows, null, 2));

  const byStatus = await pool.query(
    "select status, count(*) as total, count(home_score) as with_scores from games where game_id like '184%' group by status",
  );
  console.log('\nGames by status:');
  console.log(JSON.stringify(byStatus.rows, null, 2));

  await pool.end();
})();



