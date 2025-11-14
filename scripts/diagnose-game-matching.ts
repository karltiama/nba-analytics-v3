import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

(async () => {
  // Check games that have null scores
  const nullScoreGames = await pool.query(
    `
    select game_id, status, home_team_id, away_team_id, start_time::date as game_date
    from games
    where (home_score is null or away_score is null)
      and game_id like '002%'
      and start_time::date >= '2025-10-21'
      and start_time::date <= '2025-11-11'
    order by start_time
    limit 20
    `,
  );

  console.log(`Games with null scores (NBA Stats): ${nullScoreGames.rows.length}`);
  console.log(JSON.stringify(nullScoreGames.rows, null, 2));

  // Check if we have BallDontLie games for the same dates (regardless of team match)
  if (nullScoreGames.rows.length > 0) {
    const sample = nullScoreGames.rows[0];
    const bdlGamesSameDate = await pool.query(
      `
      select game_id, status, home_team_id, away_team_id, home_score, away_score, start_time::date as game_date
      from games
      where start_time::date = $1
        and game_id like '184%'
      `,
      [sample.game_date],
    );

    console.log(`\nBallDontLie games for date ${sample.game_date}:`);
    console.log(JSON.stringify(bdlGamesSameDate.rows, null, 2));
    
    console.log(`\nNBA Stats game ${sample.game_id} needs: home_team_id=${sample.home_team_id}, away_team_id=${sample.away_team_id}`);
  }

  // Check status distribution
  const statusDist = await pool.query(
    `
    select status, count(*) as count
    from games
    where game_id like '002%'
      and start_time::date >= '2025-10-21'
      and start_time::date <= '2025-11-11'
    group by status
    order by count desc
    `,
  );

  console.log('\nStatus distribution for NBA Stats games:');
  console.log(JSON.stringify(statusDist.rows, null, 2));

  await pool.end();
})();

