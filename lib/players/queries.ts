import { query } from '@/lib/db';

/**
 * Player Statistics Queries
 * 
 * Reusable query functions for player statistics
 * Matches the pattern from lib/teams/queries.ts
 */

export async function getPlayerInfo(playerId: string) {
  const result = await query(
    `SELECT player_id, full_name, first_name, last_name, position, height, weight, dob, active
     FROM players WHERE player_id = $1`,
    [playerId]
  );
  return result[0] || null;
}

export async function getPlayerSeasonStats(playerId: string, season: string | null = null) {
  let sql = `
    SELECT 
      COUNT(DISTINCT pgs.game_id) as games_played,
      COUNT(DISTINCT CASE WHEN pgs.dnp_reason IS NULL THEN pgs.game_id END) as games_active,
      SUM(pgs.points) as total_points,
      AVG(pgs.points) as avg_points,
      SUM(pgs.rebounds) as total_rebounds,
      AVG(pgs.rebounds) as avg_rebounds,
      SUM(pgs.assists) as total_assists,
      AVG(pgs.assists) as avg_assists,
      SUM(pgs.steals) as total_steals,
      AVG(pgs.steals) as avg_steals,
      SUM(pgs.blocks) as total_blocks,
      AVG(pgs.blocks) as avg_blocks,
      SUM(pgs.turnovers) as total_turnovers,
      AVG(pgs.turnovers) as avg_turnovers,
      SUM(pgs.field_goals_made) as total_fgm,
      SUM(pgs.field_goals_attempted) as total_fga,
      AVG(pgs.field_goals_made::numeric / NULLIF(pgs.field_goals_attempted, 0)) * 100 as fg_pct,
      -- Effective FG%: (FGM + 0.5 * 3PM) / FGA
      (SUM(pgs.field_goals_made) + 0.5 * SUM(pgs.three_pointers_made)) / NULLIF(SUM(pgs.field_goals_attempted), 0) * 100 as efg_pct,
      -- True Shooting %: Points / (2 * (FGA + 0.44 * FTA))
      SUM(pgs.points) / NULLIF(2 * (SUM(pgs.field_goals_attempted) + 0.44 * SUM(pgs.free_throws_attempted)), 0) * 100 as ts_pct,
      SUM(pgs.three_pointers_made) as total_3pm,
      SUM(pgs.three_pointers_attempted) as total_3pa,
      AVG(pgs.three_pointers_made::numeric / NULLIF(pgs.three_pointers_attempted, 0)) * 100 as three_pct,
      SUM(pgs.free_throws_made) as total_ftm,
      SUM(pgs.free_throws_attempted) as total_fta,
      AVG(pgs.free_throws_made::numeric / NULLIF(pgs.free_throws_attempted, 0)) * 100 as ft_pct,
      AVG(pgs.minutes) as avg_minutes,
      SUM(pgs.minutes) as total_minutes,
      AVG(pgs.plus_minus) as avg_plus_minus,
      SUM(CASE WHEN pgs.started THEN 1 ELSE 0 END) as games_started
    FROM player_game_stats pgs
    JOIN games g ON pgs.game_id = g.game_id
    WHERE pgs.player_id = $1
      AND g.status = 'Final'
      AND pgs.dnp_reason IS NULL
  `;
  const params: any[] = [playerId];
  let paramCount = 2;

  if (season) {
    sql += ` AND g.season = $${paramCount}`;
    params.push(season);
    paramCount++;
  }

  const result = await query(sql, params);
  return result[0] || {};
}

export async function getPlayerPaceAdjustedStats(playerId: string, season: string | null = null) {
  // Get pace-adjusted stats (per 100 possessions)
  // Estimate player possessions: FGA + 0.44 * FTA - ORB + TOV
  // Since we don't have ORB, estimate as 30% of total rebounds
  let sql = `
    WITH player_possessions AS (
      SELECT 
        pgs.game_id,
        pgs.player_id,
        pgs.points,
        pgs.rebounds,
        pgs.assists,
        pgs.steals,
        pgs.blocks,
        pgs.turnovers,
        pgs.field_goals_made,
        pgs.field_goals_attempted,
        pgs.minutes,
        tgs.possessions as team_possessions,
        tgs.minutes as team_minutes,
        -- Estimate player possessions
        pgs.field_goals_attempted + 
        0.44 * pgs.free_throws_attempted - 
        (0.3 * COALESCE(pgs.rebounds, 0)) + 
        COALESCE(pgs.turnovers, 0) as estimated_player_possessions
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.game_id
      JOIN team_game_stats tgs ON pgs.game_id = tgs.game_id AND pgs.team_id = tgs.team_id
      WHERE pgs.player_id = $1
        AND g.status = 'Final'
        AND pgs.dnp_reason IS NULL
  `;
  const params: any[] = [playerId];
  let paramCount = 2;

  if (season) {
    sql += ` AND g.season = $${paramCount}`;
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

export async function getPlayerUsageRate(playerId: string, season: string | null = null) {
  // Usage Rate: ((FGA + 0.44 * FTA + TOV) * (Team Minutes / 5)) / (Player Minutes * (Team FGA + 0.44 * Team FTA + Team TOV)) * 100
  let sql = `
    WITH player_totals AS (
      SELECT 
        pgs.game_id,
        pgs.player_id,
        pgs.minutes as player_minutes,
        pgs.field_goals_attempted,
        pgs.free_throws_attempted,
        pgs.turnovers,
        tgs.minutes as team_minutes,
        tgs.field_goals_attempted as team_fga,
        tgs.free_throws_attempted as team_fta,
        tgs.turnovers as team_tov
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.game_id
      JOIN team_game_stats tgs ON pgs.game_id = tgs.game_id AND pgs.team_id = tgs.team_id
      WHERE pgs.player_id = $1
        AND g.status = 'Final'
        AND pgs.dnp_reason IS NULL
  `;
  const params: any[] = [playerId];
  let paramCount = 2;

  if (season) {
    sql += ` AND g.season = $${paramCount}`;
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

export async function getPlayerRecentForm(playerId: string, season: string | null = null) {
  // Last 5 games
  let sqlL5 = `
    WITH recent_games AS (
      SELECT pgs.points, pgs.rebounds, pgs.assists, pgs.field_goals_made, 
             pgs.field_goals_attempted, pgs.minutes
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.game_id
      WHERE pgs.player_id = $1
        AND g.status = 'Final'
        AND pgs.dnp_reason IS NULL
  `;
  const l5Params: any[] = [playerId];
  let l5ParamCount = 2;
  if (season) {
    sqlL5 += ` AND g.season = $${l5ParamCount}`;
    l5Params.push(season);
    l5ParamCount++;
  }
  sqlL5 += `
      ORDER BY g.start_time DESC
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

export async function getPlayerSplits(playerId: string, season: string | null = null) {
  let sql = `
    SELECT 
      CASE WHEN tgs.is_home THEN 'home' ELSE 'away' END as location,
      COUNT(DISTINCT pgs.game_id) as games_played,
      AVG(pgs.points) as avg_points,
      AVG(pgs.rebounds) as avg_rebounds,
      AVG(pgs.assists) as avg_assists,
      AVG(pgs.field_goals_made::numeric / NULLIF(pgs.field_goals_attempted, 0)) * 100 as fg_pct,
      AVG(pgs.minutes) as avg_minutes
    FROM player_game_stats pgs
    JOIN games g ON pgs.game_id = g.game_id
    JOIN team_game_stats tgs ON g.game_id = tgs.game_id AND pgs.team_id = tgs.team_id
    WHERE pgs.player_id = $1
      AND g.status = 'Final'
      AND pgs.dnp_reason IS NULL
  `;
  const params: any[] = [playerId];
  let paramCount = 2;

  if (season) {
    sql += ` AND g.season = $${paramCount}`;
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

export async function getOpponentDefensiveRankings(teamId: string, season: string | null = null) {
  // Use the batch function for consistency
  const rankingsMap = await getMultipleOpponentDefensiveRankings([teamId], season);
  return rankingsMap[teamId] || {};
}

/**
 * Get defensive rankings for multiple teams at once (more efficient - single query)
 * Returns a map of team_id -> rankings object
 */
export async function getMultipleOpponentDefensiveRankings(
  teamIds: string[],
  season: string | null = null
): Promise<Record<string, any>> {
  if (teamIds.length === 0) {
    return {};
  }

  let sql = `
    WITH team_defensive_stats AS (
      SELECT 
        tgs.team_id,
        AVG(
          CASE 
            WHEN tgs.is_home THEN g.away_score
            ELSE g.home_score
          END
        ) as points_allowed_per_game,
        AVG(opp_tgs.rebounds) as rebounds_allowed_per_game,
        AVG(opp_tgs.assists) as assists_allowed_per_game,
        AVG(opp_tgs.field_goals_made::numeric / NULLIF(opp_tgs.field_goals_attempted, 0)) * 100 as fg_pct_allowed,
        AVG(opp_tgs.three_pointers_made::numeric / NULLIF(opp_tgs.three_pointers_attempted, 0)) * 100 as three_pct_allowed
      FROM team_game_stats tgs
      JOIN games g ON tgs.game_id = g.game_id
      JOIN team_game_stats opp_tgs ON g.game_id = opp_tgs.game_id 
        AND opp_tgs.team_id != tgs.team_id
      WHERE g.status = 'Final'
  `;
  const params: any[] = [];
  let paramCount = 1;

  if (season) {
    sql += ` AND g.season = $${paramCount}`;
    params.push(season);
    paramCount++;
  }

  sql += `
      GROUP BY tgs.team_id
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

