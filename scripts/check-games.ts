import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

(async () => {
  const args = process.argv.slice(2);
  const dateArg = args.find((arg, i) => arg === '--date' && args[i + 1]) 
    ? args[args.indexOf('--date') + 1] 
    : null;

  if (dateArg) {
    const result = await pool.query(
      'select game_id, status, home_score, away_score from games where start_time::date = $1 order by start_time',
      [dateArg],
    );
    console.log(`Games for ${dateArg}:`);
    console.log(JSON.stringify(result.rows, null, 2));
  } else {
    const summaryResult = await pool.query(
      "select count(*) as total, count(home_score) as with_scores from games where game_id like '184%'",
    );
    console.log('BallDontLie games summary:');
    console.log(JSON.stringify(summaryResult.rows[0], null, 2));
    
    const sampleResult = await pool.query(
      "select game_id, status, home_score, away_score from games where game_id like '184%' order by start_time limit 10",
    );
    console.log('\nSample games (first 10):');
    console.log(JSON.stringify(sampleResult.rows, null, 2));
  }

  await pool.end();
})();

