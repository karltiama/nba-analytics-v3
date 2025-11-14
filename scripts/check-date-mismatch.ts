import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

(async () => {
  // Check NBA Stats games for Oct 22 with null scores
  const nbaGames = await pool.query(
    `
    select g.game_id, g.status, g.home_score, g.away_score, g.start_time,
           g.start_time::date as start_date_utc,
           (g.start_time at time zone 'America/New_York')::date as start_date_et,
           home_team.abbreviation as home_abbr, away_team.abbreviation as away_abbr
    from games g
    join teams home_team on g.home_team_id = home_team.team_id
    join teams away_team on g.away_team_id = away_team.team_id
    where g.start_time::date = '2025-10-22'
      and (g.home_score is null or g.away_score is null)
      and g.game_id like '002%'
    order by g.start_time
    `,
  );

  console.log('NBA Stats games for Oct 22 (UTC) with null scores:');
  console.log(JSON.stringify(nbaGames.rows, null, 2));

  // Check BallDontLie games for Oct 21 and Oct 22
  const bdlGames21 = await pool.query(
    `
    select g.game_id, g.status, g.home_score, g.away_score, g.start_time,
           g.start_time::date as start_date_utc,
           (g.start_time at time zone 'America/New_York')::date as start_date_et,
           home_team.abbreviation as home_abbr, away_team.abbreviation as away_abbr
    from games g
    join teams home_team on g.home_team_id = home_team.team_id
    join teams away_team on g.away_team_id = away_team.team_id
    where g.start_time::date = '2025-10-21'
      and g.game_id like '184%'
    order by g.start_time
    `,
  );

  console.log('\nBallDontLie games for Oct 21 (UTC):');
  console.log(JSON.stringify(bdlGames21.rows, null, 2));

  const bdlGames22 = await pool.query(
    `
    select g.game_id, g.status, g.home_score, g.away_score, g.start_time,
           g.start_time::date as start_date_utc,
           (g.start_time at time zone 'America/New_York')::date as start_date_et,
           home_team.abbreviation as home_abbr, away_team.abbreviation as away_abbr
    from games g
    join teams home_team on g.home_team_id = home_team.team_id
    join teams away_team on g.away_team_id = away_team.team_id
    where g.start_time::date = '2025-10-22'
      and g.game_id like '184%'
    order by g.start_time
    `,
  );

  console.log('\nBallDontLie games for Oct 22 (UTC):');
  console.log(JSON.stringify(bdlGames22.rows, null, 2));

  await pool.end();
})();


