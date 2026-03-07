/**
 * Compute analytics.team_game_stats and analytics.team_season_averages
 * from analytics.player_game_logs + analytics.games.
 *
 * Idempotent (upserts). Run after transform-raw-to-analytics.ts.
 *
 * Env: SUPABASE_DB_URL
 *
 * Usage: npx tsx scripts/compute-team-stats.ts
 */

import 'dotenv/config';
import { Pool } from 'pg';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
if (!SUPABASE_DB_URL) {
  console.error('Set SUPABASE_DB_URL in .env');
  process.exit(1);
}

const pool = new Pool({ connectionString: SUPABASE_DB_URL });

const aggregateTeamGameStats = `
  select
    pgl.team_id,
    pgl.game_id,
    g.season,
    g.start_time::date as game_date,
    case
      when pgl.team_id = g.home_team_id then g.away_team_id
      else g.home_team_id
    end as opponent_team_id,
    (pgl.team_id = g.home_team_id) as is_home,
    coalesce(sum(pgl.points), 0)::int                   as team_points,
    coalesce(sum(pgl.rebounds), 0)::int                  as team_rebounds,
    coalesce(sum(pgl.assists), 0)::int                   as team_assists,
    coalesce(sum(pgl.steals), 0)::int                    as team_steals,
    coalesce(sum(pgl.blocks), 0)::int                    as team_blocks,
    coalesce(sum(pgl.turnovers), 0)::int                 as team_turnovers,
    coalesce(sum(pgl.field_goals_made), 0)::int          as team_fgm,
    coalesce(sum(pgl.field_goals_attempted), 0)::int     as team_fga,
    coalesce(sum(pgl.three_pointers_made), 0)::int       as team_3pm,
    coalesce(sum(pgl.three_pointers_attempted), 0)::int  as team_3pa,
    coalesce(sum(pgl.free_throws_made), 0)::int          as team_ftm,
    coalesce(sum(pgl.free_throws_attempted), 0)::int     as team_fta,
    case
      when pgl.team_id = g.home_team_id then g.away_score
      else g.home_score
    end as points_allowed,
    case
      when g.home_score is null or g.away_score is null then null
      when pgl.team_id = g.home_team_id and g.home_score > g.away_score then 'W'
      when pgl.team_id = g.away_team_id and g.away_score > g.home_score then 'W'
      when g.home_score = g.away_score then null
      else 'L'
    end as result
  from analytics.player_game_logs pgl
  join analytics.games g on g.game_id = pgl.game_id
  where g.season is not null and g.season <> ''
  group by pgl.team_id, pgl.game_id, g.season, g.start_time,
           g.home_team_id, g.away_team_id, g.home_score, g.away_score
`;

const upsertTeamGameStats = `
  insert into analytics.team_game_stats (
    team_id, game_id, season, game_date, opponent_team_id, is_home,
    team_points, team_rebounds, team_assists, team_steals, team_blocks, team_turnovers,
    team_fgm, team_fga, team_3pm, team_3pa, team_ftm, team_fta,
    points_allowed, result
  ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
  on conflict (team_id, game_id) do update set
    season           = excluded.season,
    game_date        = excluded.game_date,
    opponent_team_id = excluded.opponent_team_id,
    is_home          = excluded.is_home,
    team_points      = excluded.team_points,
    team_rebounds     = excluded.team_rebounds,
    team_assists      = excluded.team_assists,
    team_steals       = excluded.team_steals,
    team_blocks       = excluded.team_blocks,
    team_turnovers    = excluded.team_turnovers,
    team_fgm          = excluded.team_fgm,
    team_fga          = excluded.team_fga,
    team_3pm          = excluded.team_3pm,
    team_3pa          = excluded.team_3pa,
    team_ftm          = excluded.team_ftm,
    team_fta          = excluded.team_fta,
    points_allowed    = excluded.points_allowed,
    result            = excluded.result,
    updated_at        = now();
`;

const aggregateTeamSeasonAverages = `
  select
    team_id,
    season,
    count(*)::int as games_played,
    avg(team_points)     as avg_points,
    avg(team_rebounds)   as avg_rebounds,
    avg(team_assists)    as avg_assists,
    avg(team_steals)     as avg_steals,
    avg(team_blocks)     as avg_blocks,
    avg(team_turnovers)  as avg_turnovers,
    avg(team_fgm)        as avg_fgm,
    avg(team_fga)        as avg_fga,
    avg(team_3pm)        as avg_3pm,
    avg(team_3pa)        as avg_3pa,
    avg(team_ftm)        as avg_ftm,
    avg(team_fta)        as avg_fta,
    avg(points_allowed)  as avg_points_allowed,
    count(*) filter (where result = 'W')::int as wins,
    count(*) filter (where result = 'L')::int as losses,
    case
      when count(*) filter (where result in ('W','L')) > 0
      then count(*) filter (where result = 'W')::numeric
           / count(*) filter (where result in ('W','L'))
      else null
    end as win_pct
  from analytics.team_game_stats
  group by team_id, season
`;

const upsertTeamSeasonAverages = `
  insert into analytics.team_season_averages (
    team_id, season, games_played,
    avg_points, avg_rebounds, avg_assists, avg_steals, avg_blocks, avg_turnovers,
    avg_fgm, avg_fga, avg_3pm, avg_3pa, avg_ftm, avg_fta,
    avg_points_allowed, wins, losses, win_pct
  ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
  on conflict (team_id, season) do update set
    games_played       = excluded.games_played,
    avg_points         = excluded.avg_points,
    avg_rebounds        = excluded.avg_rebounds,
    avg_assists         = excluded.avg_assists,
    avg_steals          = excluded.avg_steals,
    avg_blocks          = excluded.avg_blocks,
    avg_turnovers       = excluded.avg_turnovers,
    avg_fgm             = excluded.avg_fgm,
    avg_fga             = excluded.avg_fga,
    avg_3pm             = excluded.avg_3pm,
    avg_3pa             = excluded.avg_3pa,
    avg_ftm             = excluded.avg_ftm,
    avg_fta             = excluded.avg_fta,
    avg_points_allowed  = excluded.avg_points_allowed,
    wins                = excluded.wins,
    losses              = excluded.losses,
    win_pct             = excluded.win_pct,
    updated_at          = now();
`;

async function main() {
  const client = await pool.connect();
  try {
    // Step 1: aggregate player_game_logs → team_game_stats
    console.log('Aggregating player game logs into team game stats...');
    const tgs = await client.query(aggregateTeamGameStats);
    console.log(`Upserting ${tgs.rows.length} team game stat rows...`);

    await client.query('begin');
    for (const r of tgs.rows) {
      await client.query(upsertTeamGameStats, [
        r.team_id, r.game_id, r.season, r.game_date,
        r.opponent_team_id, r.is_home,
        r.team_points, r.team_rebounds, r.team_assists,
        r.team_steals, r.team_blocks, r.team_turnovers,
        r.team_fgm, r.team_fga, r.team_3pm, r.team_3pa,
        r.team_ftm, r.team_fta,
        r.points_allowed, r.result,
      ]);
    }
    await client.query('commit');
    console.log('team_game_stats done.');

    // Step 2: aggregate team_game_stats → team_season_averages
    console.log('Computing team season averages...');
    const tsa = await client.query(aggregateTeamSeasonAverages);
    console.log(`Upserting ${tsa.rows.length} team season average rows...`);

    await client.query('begin');
    for (const r of tsa.rows) {
      await client.query(upsertTeamSeasonAverages, [
        r.team_id, r.season, r.games_played,
        r.avg_points, r.avg_rebounds, r.avg_assists,
        r.avg_steals, r.avg_blocks, r.avg_turnovers,
        r.avg_fgm, r.avg_fga, r.avg_3pm, r.avg_3pa,
        r.avg_ftm, r.avg_fta,
        r.avg_points_allowed, r.wins, r.losses, r.win_pct,
      ]);
    }
    await client.query('commit');
    console.log('team_season_averages done.');

    console.log('All team stats computed successfully.');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    console.error(e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
