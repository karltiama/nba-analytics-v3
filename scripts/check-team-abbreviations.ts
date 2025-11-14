import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

(async () => {
  // Check a specific NBA Stats game and its team abbreviations
  const nbaGame = await pool.query(
    `
    select g.game_id, g.status, g.home_score, g.away_score,
           home_team.abbreviation as home_abbr, away_team.abbreviation as away_abbr
    from games g
    join teams home_team on g.home_team_id = home_team.team_id
    join teams away_team on g.away_team_id = away_team.team_id
    where g.game_id = '0022500002'
    `,
  );

  console.log('NBA Stats game 0022500002:');
  console.log(JSON.stringify(nbaGame.rows[0], null, 2));

  // Check BallDontLie games for same date
  const bdlGames = await pool.query(
    `
    select g.game_id, g.status, g.home_score, g.away_score,
           home_team.abbreviation as home_abbr, away_team.abbreviation as away_abbr
    from games g
    join teams home_team on g.home_team_id = home_team.team_id
    join teams away_team on g.away_team_id = away_team.team_id
    where g.start_time::date = '2025-10-22'
      and g.game_id like '184%'
    `,
  );

  console.log('\nBallDontLie games for 2025-10-22:');
  console.log(JSON.stringify(bdlGames.rows, null, 2));

  await pool.end();
})();



