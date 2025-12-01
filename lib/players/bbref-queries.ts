import { query } from '@/lib/db';

/**
 * BBRef Player Statistics Queries
 * 
 * Uses standalone bbref_games, bbref_player_game_stats, and bbref_team_game_stats tables
 * These are completely independent from the canonical tables (games, player_game_stats, team_game_stats)
 */

export async function getBBRefPlayerInfo(playerId: string) {
  const result = await query(
    `SELECT player_id, full_name, first_name, last_name, position, height, weight, dob, active
     FROM players WHERE player_id = $1`,
    [playerId]
  );
  return result[0] || null;
}

export async function getBBRefPlayerSeasonStats(playerId: string, season: string | null = null) {
  let sql = `
    SELECT 
      COUNT(DISTINCT bpgs.game_id) as games_played,
      COUNT(DISTINCT CASE WHEN bpgs.dnp_reason IS NULL THEN bpgs.game_id END) as games_active,
      SUM(bpgs.points) as total_points,
      AVG(bpgs.points) as avg_points,
      SUM(bpgs.rebounds) as total_rebounds,
      AVG(bpgs.rebounds) as avg_rebounds,
      SUM(bpgs.assists) as total_assists,
      AVG(bpgs.assists) as avg_assists,
      SUM(bpgs.steals) as total_steals,
      AVG(bpgs.steals) as avg_steals,
      SUM(bpgs.blocks) as total_blocks,
      AVG(bpgs.blocks) as avg_blocks,
      SUM(bpgs.turnovers) as total_turnovers,
      AVG(bpgs.turnovers) as avg_turnovers,
      SUM(bpgs.field_goals_made) as total_fgm,
      SUM(bpgs.field_goals_attempted) as total_fga,
      AVG(bpgs.field_goals_made::numeric / NULLIF(bpgs.field_goals_attempted, 0)) * 100 as fg_pct,
      -- Effective FG%: (FGM + 0.5 * 3PM) / FGA
      (SUM(bpgs.field_goals_made) + 0.5 * SUM(bpgs.three_pointers_made)) / NULLIF(SUM(bpgs.field_goals_attempted), 0) * 100 as efg_pct,
      -- True Shooting %: Points / (2 * (FGA + 0.44 * FTA))
      SUM(bpgs.points) / NULLIF(2 * (SUM(bpgs.field_goals_attempted) + 0.44 * SUM(bpgs.free_throws_attempted)), 0) * 100 as ts_pct,
      SUM(bpgs.three_pointers_made) as total_3pm,
      SUM(bpgs.three_pointers_attempted) as total_3pa,
      AVG(bpgs.three_pointers_made::numeric / NULLIF(bpgs.three_pointers_attempted, 0)) * 100 as three_pct,
      SUM(bpgs.free_throws_made) as total_ftm,
      SUM(bpgs.free_throws_attempted) as total_fta,
      AVG(bpgs.free_throws_made::numeric / NULLIF(bpgs.free_throws_attempted, 0)) * 100 as ft_pct,
      AVG(bpgs.minutes) as avg_minutes,
      SUM(bpgs.minutes) as total_minutes,
      AVG(bpgs.plus_minus) as avg_plus_minus,
      SUM(CASE WHEN bpgs.started THEN 1 ELSE 0 END) as games_started,
      -- BBRef-specific stats
      SUM(bpgs.offensive_rebounds) as total_orb,
      AVG(bpgs.offensive_rebounds) as avg_orb,
      SUM(bpgs.defensive_rebounds) as total_drb,
      AVG(bpgs.defensive_rebounds) as avg_drb,
      SUM(bpgs.personal_fouls) as total_pf,
      AVG(bpgs.personal_fouls) as avg_pf
    FROM bbref_player_game_stats bpgs
    JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
    WHERE bpgs.player_id = $1
      AND bg.status = 'Final'
      AND bpgs.dnp_reason IS NULL
  `;
  const params: any[] = [playerId];
  let paramCount = 2;

  if (season) {
    sql += ` AND bg.season = $${paramCount}`;
    params.push(season);
    paramCount++;
  }

  const result = await query(sql, params);
  return result[0] || {};
}

export async function getBBRefPlayerPaceAdjustedStats(playerId: string, season: string | null = null) {
  // Get pace-adjusted stats (per 100 possessions)
  // Using BBRef data which has offensive rebounds
  let sql = `
    WITH player_possessions AS (
      SELECT 
        bpgs.game_id,
        bpgs.player_id,
        bpgs.points,
        bpgs.rebounds,
        bpgs.assists,
        bpgs.steals,
        bpgs.blocks,
        bpgs.turnovers,
        bpgs.field_goals_made,
        bpgs.field_goals_attempted,
        bpgs.minutes,
        bpgs.offensive_rebounds,
        btgs.possessions as team_possessions,
        btgs.minutes as team_minutes,
        -- Estimate player possessions using actual ORB from BBRef
        bpgs.field_goals_attempted + 
        0.44 * bpgs.free_throws_attempted - 
        COALESCE(bpgs.offensive_rebounds, 0) + 
        COALESCE(bpgs.turnovers, 0) as estimated_player_possessions
      FROM bbref_player_game_stats bpgs
      JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
      JOIN bbref_team_game_stats btgs ON bpgs.game_id = btgs.game_id AND bpgs.team_id = btgs.team_id
      WHERE bpgs.player_id = $1
        AND bg.status = 'Final'
        AND bpgs.dnp_reason IS NULL
  `;
  const params: any[] = [playerId];
  let paramCount = 2;

  if (season) {
    sql += ` AND bg.season = $${paramCount}`;
    params.push(season);
    paramCount++;
  }

  sql += `
    )
    SELECT 
      AVG(points) as avg_points,
      AVG(rebounds) as avg_rebounds,
      AVG(assists) as avg_assists,
      AVG(steals) as avg_steals,
      AVG(blocks) as avg_blocks,
      AVG(turnovers) as avg_turnovers,
      AVG(estimated_player_possessions) as avg_player_possessions,
      -- Per 100 possessions
      AVG(points) / NULLIF(AVG(estimated_player_possessions), 0) * 100 as points_per_100,
      AVG(rebounds) / NULLIF(AVG(estimated_player_possessions), 0) * 100 as rebounds_per_100,
      AVG(assists) / NULLIF(AVG(estimated_player_possessions), 0) * 100 as assists_per_100,
      AVG(steals) / NULLIF(AVG(estimated_player_possessions), 0) * 100 as steals_per_100,
      AVG(blocks) / NULLIF(AVG(estimated_player_possessions), 0) * 100 as blocks_per_100,
      AVG(turnovers) / NULLIF(AVG(estimated_player_possessions), 0) * 100 as turnovers_per_100,
      -- Per 36 minutes (alternative normalization)
      AVG(points) / NULLIF(AVG(minutes), 0) * 36 as points_per_36,
      AVG(rebounds) / NULLIF(AVG(minutes), 0) * 36 as rebounds_per_36,
      AVG(assists) / NULLIF(AVG(minutes), 0) * 36 as assists_per_36
    FROM player_possessions
  `;

  const result = await query(sql, params);
  return result[0] || {};
}

export async function getBBRefPlayerUsageRate(playerId: string, season: string | null = null) {
  // Usage Rate: ((FGA + 0.44 * FTA + TOV) * (Team Minutes / 5)) / (Player Minutes * (Team FGA + 0.44 * Team FTA + Team TOV)) * 100
  let sql = `
    WITH player_totals AS (
      SELECT 
        bpgs.game_id,
        bpgs.player_id,
        bpgs.minutes as player_minutes,
        bpgs.field_goals_attempted,
        bpgs.free_throws_attempted,
        bpgs.turnovers,
        btgs.minutes as team_minutes,
        btgs.field_goals_attempted as team_fga,
        btgs.free_throws_attempted as team_fta,
        btgs.turnovers as team_tov
      FROM bbref_player_game_stats bpgs
      JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
      JOIN bbref_team_game_stats btgs ON bpgs.game_id = btgs.game_id AND bpgs.team_id = btgs.team_id
      WHERE bpgs.player_id = $1
        AND bg.status = 'Final'
        AND bpgs.dnp_reason IS NULL
  `;
  const params: any[] = [playerId];
  let paramCount = 2;

  if (season) {
    sql += ` AND bg.season = $${paramCount}`;
    params.push(season);
    paramCount++;
  }

  sql += `
    )
    SELECT 
      AVG(
        ((field_goals_attempted + 0.44 * free_throws_attempted + turnovers) * (team_minutes / 5.0)) /
        NULLIF(player_minutes * (team_fga + 0.44 * team_fta + team_tov), 0)
      ) * 100 as usage_rate
    FROM player_totals
  `;

  const result = await query(sql, params);
  return result[0] || {};
}

export async function getBBRefPlayerRecentForm(playerId: string, season: string | null = null) {
  // Last 5 games
  let sqlL5 = `
    WITH recent_games AS (
      SELECT bpgs.points, bpgs.rebounds, bpgs.assists, bpgs.field_goals_made, 
             bpgs.field_goals_attempted, bpgs.minutes
      FROM bbref_player_game_stats bpgs
      JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
      WHERE bpgs.player_id = $1
        AND bg.status = 'Final'
        AND bpgs.dnp_reason IS NULL
  `;
  const l5Params: any[] = [playerId];
  let l5ParamCount = 2;
  if (season) {
    sqlL5 += ` AND bg.season = $${l5ParamCount}`;
    l5Params.push(season);
    l5ParamCount++;
  }
  sqlL5 += `
      ORDER BY COALESCE(bg.start_time, bg.game_date) DESC
      LIMIT 5
    )
    SELECT 
      AVG(points) as avg_points,
      AVG(rebounds) as avg_rebounds,
      AVG(assists) as avg_assists,
      AVG(field_goals_made::numeric / NULLIF(field_goals_attempted, 0)) * 100 as fg_pct,
      AVG(minutes) as avg_minutes
    FROM recent_games
  `;
  const l5 = await query(sqlL5, l5Params);

  // Last 10 games
  let sqlL10 = sqlL5.replace('LIMIT 5', 'LIMIT 10');
  const l10 = await query(sqlL10, l5Params);

  return {
    last_5: l5[0] || {},
    last_10: l10[0] || {},
  };
}

export async function getBBRefPlayerSplits(playerId: string, season: string | null = null) {
  let sql = `
    SELECT 
      CASE WHEN btgs.is_home THEN 'home' ELSE 'away' END as location,
      COUNT(DISTINCT bpgs.game_id) as games_played,
      AVG(bpgs.points) as avg_points,
      AVG(bpgs.rebounds) as avg_rebounds,
      AVG(bpgs.assists) as avg_assists,
      AVG(bpgs.field_goals_made::numeric / NULLIF(bpgs.field_goals_attempted, 0)) * 100 as fg_pct,
      AVG(bpgs.minutes) as avg_minutes
    FROM bbref_player_game_stats bpgs
    JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
    JOIN bbref_team_game_stats btgs ON bg.bbref_game_id = btgs.game_id AND bpgs.team_id = btgs.team_id
    WHERE bpgs.player_id = $1
      AND bg.status = 'Final'
      AND bpgs.dnp_reason IS NULL
  `;
  const params: any[] = [playerId];
  let paramCount = 2;

  if (season) {
    sql += ` AND bg.season = $${paramCount}`;
    params.push(season);
    paramCount++;
  }

  sql += ` GROUP BY location`;

  const result = await query(sql, params);

  const splits: { home: any; away: any } = { home: {}, away: {} };
  result.forEach((row: any) => {
    if (row.location === 'home') {
      splits.home = row;
    } else {
      splits.away = row;
    }
  });

  return splits;
}

export async function getBBRefPlayerGames(playerId: string, season: string | null = null, limit: number = 20) {
  let sql = `
    SELECT 
      bg.bbref_game_id as game_id,
      bg.game_date,
      COALESCE(bg.start_time, bg.game_date::timestamptz) as start_time,
      bg.status,
      bg.season,
      bpgs.team_id as team_id,
      t_team.abbreviation as team_abbr,
      t_team.full_name as team_name,
      CASE 
        WHEN bg.home_team_id = bpgs.team_id THEN bg.away_team_id
        ELSE bg.home_team_id
      END as opponent_id,
      CASE 
        WHEN bg.home_team_id = bpgs.team_id THEN t_away.abbreviation
        ELSE t_home.abbreviation
      END as opponent_abbr,
      CASE 
        WHEN bg.home_team_id = bpgs.team_id THEN t_away.full_name
        ELSE t_home.full_name
      END as opponent_name,
      CASE 
        WHEN bg.home_team_id = bpgs.team_id THEN 'home'
        ELSE 'away'
      END as location,
      CASE 
        WHEN bg.home_team_id = bpgs.team_id THEN bg.home_score
        ELSE bg.away_score
      END as team_score,
      CASE 
        WHEN bg.home_team_id = bpgs.team_id THEN bg.away_score
        ELSE bg.home_score
      END as opponent_score,
      CASE 
        WHEN bg.status != 'Final' THEN NULL
        WHEN bg.home_team_id = bpgs.team_id AND bg.home_score > bg.away_score THEN 'W'
        WHEN bg.home_team_id = bpgs.team_id AND bg.home_score < bg.away_score THEN 'L'
        WHEN bg.away_team_id = bpgs.team_id AND bg.away_score > bg.home_score THEN 'W'
        WHEN bg.away_team_id = bpgs.team_id AND bg.away_score < bg.home_score THEN 'L'
        ELSE NULL
      END as result,
      bpgs.minutes,
      bpgs.points,
      bpgs.rebounds,
      bpgs.assists,
      bpgs.steals,
      bpgs.blocks,
      bpgs.turnovers,
      bpgs.field_goals_made,
      bpgs.field_goals_attempted,
      bpgs.three_pointers_made,
      bpgs.three_pointers_attempted,
      bpgs.free_throws_made,
      bpgs.free_throws_attempted,
      bpgs.plus_minus,
      bpgs.started,
      bpgs.dnp_reason,
      -- BBRef-specific stats
      bpgs.offensive_rebounds,
      bpgs.defensive_rebounds,
      bpgs.personal_fouls
    FROM bbref_player_game_stats bpgs
    JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
    JOIN teams t_team ON bpgs.team_id = t_team.team_id
    JOIN teams t_home ON bg.home_team_id = t_home.team_id
    JOIN teams t_away ON bg.away_team_id = t_away.team_id
    WHERE bpgs.player_id = $1
  `;
  const params: any[] = [playerId];
  let paramCount = 2;
  if (season) {
    sql += ` AND bg.season = $${paramCount}`;
    params.push(season);
    paramCount++;
  }
  sql += ` ORDER BY COALESCE(bg.start_time, bg.game_date) DESC LIMIT $${paramCount}`;
  params.push(limit);
  const games = await query(sql, params);
  
  // Get opponent defensive rankings for all unique opponents in a single query
  const uniqueOpponentIds = [...new Set(games.map((g: any) => g.opponent_id))];
  const opponentRankings = await getBBRefMultipleOpponentDefensiveRankings(uniqueOpponentIds, season);
  
  // Add rankings to each game
  const gamesWithRankings = games.map((game: any) => ({
    ...game,
    opponent_defensive_rankings: opponentRankings[game.opponent_id] || {},
  }));
  
  return { games: gamesWithRankings };
}

/**
 * Get defensive rankings for multiple teams at once using BBRef data
 * Returns a map of team_id -> rankings object
 */
export async function getBBRefMultipleOpponentDefensiveRankings(
  teamIds: string[],
  season: string | null = null
): Promise<Record<string, any>> {
  if (teamIds.length === 0) {
    return {};
  }

  let sql = `
    WITH team_defensive_stats AS (
      SELECT 
        btgs.team_id,
        AVG(
          CASE 
            WHEN btgs.is_home THEN bg.away_score
            ELSE bg.home_score
          END
        ) as points_allowed_per_game,
        AVG(opp_btgs.rebounds) as rebounds_allowed_per_game,
        AVG(opp_btgs.assists) as assists_allowed_per_game,
        AVG(opp_btgs.field_goals_made::numeric / NULLIF(opp_btgs.field_goals_attempted, 0)) * 100 as fg_pct_allowed,
        AVG(opp_btgs.three_pointers_made::numeric / NULLIF(opp_btgs.three_pointers_attempted, 0)) * 100 as three_pct_allowed
      FROM bbref_team_game_stats btgs
      JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
      JOIN bbref_team_game_stats opp_btgs ON bg.bbref_game_id = opp_btgs.game_id 
        AND opp_btgs.team_id != btgs.team_id
      WHERE bg.status = 'Final'
  `;
  const params: any[] = [];
  let paramCount = 1;

  if (season) {
    sql += ` AND bg.season = $${paramCount}`;
    params.push(season);
    paramCount++;
  }

  sql += `
      GROUP BY btgs.team_id
    ),
    rankings AS (
      SELECT 
        team_id,
        points_allowed_per_game,
        rebounds_allowed_per_game,
        assists_allowed_per_game,
        fg_pct_allowed,
        three_pct_allowed,
        RANK() OVER (ORDER BY points_allowed_per_game ASC) as points_allowed_rank,
        RANK() OVER (ORDER BY rebounds_allowed_per_game ASC) as rebounds_allowed_rank,
        RANK() OVER (ORDER BY assists_allowed_per_game ASC) as assists_allowed_rank,
        RANK() OVER (ORDER BY fg_pct_allowed ASC) as fg_pct_allowed_rank,
        RANK() OVER (ORDER BY three_pct_allowed ASC) as three_pct_allowed_rank
      FROM team_defensive_stats
    )
    SELECT 
      team_id,
      points_allowed_rank,
      rebounds_allowed_rank,
      assists_allowed_rank,
      fg_pct_allowed_rank,
      three_pct_allowed_rank,
      points_allowed_per_game,
      rebounds_allowed_per_game,
      assists_allowed_per_game,
      fg_pct_allowed,
      three_pct_allowed
    FROM rankings
    WHERE team_id = ANY($${paramCount})
  `;
  params.push(teamIds);

  const result = await query(sql, params);
  
  // Convert array to object keyed by team_id
  const rankingsMap: Record<string, any> = {};
  result.forEach((row: any) => {
    rankingsMap[row.team_id] = {
      points_allowed_rank: row.points_allowed_rank,
      rebounds_allowed_rank: row.rebounds_allowed_rank,
      assists_allowed_rank: row.assists_allowed_rank,
      fg_pct_allowed_rank: row.fg_pct_allowed_rank,
      three_pct_allowed_rank: row.three_pct_allowed_rank,
      points_allowed_per_game: row.points_allowed_per_game,
      rebounds_allowed_per_game: row.rebounds_allowed_per_game,
      assists_allowed_per_game: row.assists_allowed_per_game,
      fg_pct_allowed: row.fg_pct_allowed,
      three_pct_allowed: row.three_pct_allowed,
    };
  });

  return rankingsMap;
}

export async function getBBRefOpponentDefensiveRankings(teamId: string, season: string | null = null) {
  // Use the batch function for consistency
  const rankingsMap = await getBBRefMultipleOpponentDefensiveRankings([teamId], season);
  return rankingsMap[teamId] || {};
}












