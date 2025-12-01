import { query } from '@/lib/db';

/**
 * Get BBRef team game stats for a team
 * Uses standalone bbref_games table (completely independent from canonical games table)
 */
export async function getBBRefTeamGameStats(teamId: string, limit: number | null = null) {
  // Resolve team_id: if it's an abbreviation, look it up in teams table
  let resolvedTeamId = teamId;
  
  // If it's not numeric, assume it's an abbreviation
  if (isNaN(Number(teamId))) {
    const teamLookup = await query(`
      SELECT team_id FROM teams WHERE abbreviation = $1 LIMIT 1
    `, [teamId.toUpperCase()]);
    
    if (teamLookup.length > 0) {
      resolvedTeamId = teamLookup[0].team_id;
    }
  }
  
  const sql = `
    SELECT 
      btgs.game_id,
      bg.game_date,
      TO_CHAR(bg.game_date, 'YYYY-MM-DD') as game_date_str,
      bg.start_time,
      bg.home_team_abbr as home_team,
      bg.away_team_abbr as away_team,
      btgs.is_home,
      btgs.points,
      btgs.field_goals_made as fgm,
      btgs.field_goals_attempted as fga,
      btgs.three_pointers_made as "3pm",
      btgs.three_pointers_attempted as "3pa",
      btgs.free_throws_made as ftm,
      btgs.free_throws_attempted as fta,
      btgs.rebounds,
      btgs.offensive_rebounds as orb,
      btgs.defensive_rebounds as drb,
      btgs.assists,
      btgs.steals,
      btgs.blocks,
      btgs.turnovers,
      btgs.personal_fouls as pf,
      btgs.possessions,
      CASE 
        WHEN btgs.is_home AND bg.home_score > bg.away_score THEN 'W'
        WHEN btgs.is_home AND bg.home_score < bg.away_score THEN 'L'
        WHEN NOT btgs.is_home AND bg.away_score > bg.home_score THEN 'W'
        WHEN NOT btgs.is_home AND bg.away_score < bg.home_score THEN 'L'
        ELSE NULL
      END as result,
      CASE 
        WHEN btgs.is_home THEN bg.home_score
        ELSE bg.away_score
      END as team_score,
      CASE 
        WHEN btgs.is_home THEN bg.away_score
        ELSE bg.home_score
      END as opponent_score
    FROM bbref_team_game_stats btgs
    JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
    WHERE btgs.team_id = $1
      AND btgs.source = 'bbref'
    ORDER BY COALESCE(bg.start_time, bg.game_date) DESC
    ${limit !== null ? `LIMIT $2` : ''}
  `;
  
  const params = limit !== null ? [resolvedTeamId, limit] : [resolvedTeamId];
  const result = await query(sql, params);
  return result;
}

/**
 * Get aggregated BBRef team season stats
 * Uses materialized view if available, otherwise calculates on-the-fly
 * Uses standalone bbref_games table (completely independent from canonical games table)
 */
export async function getBBRefTeamSeasonStats(teamId: string) {
  // Resolve team_id: if it's an abbreviation, look it up in teams table
  let resolvedTeamId = teamId;
  
  // If it's not numeric, assume it's an abbreviation
  if (isNaN(Number(teamId))) {
    const teamLookup = await query(`
      SELECT team_id FROM teams WHERE abbreviation = $1 LIMIT 1
    `, [teamId.toUpperCase()]);
    
    if (teamLookup.length > 0) {
      resolvedTeamId = teamLookup[0].team_id;
    }
  }
  
  // First check if materialized view exists
  const viewCheck = await query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_matviews 
      WHERE schemaname = 'public' 
      AND matviewname = 'bbref_team_season_stats'
    ) as view_exists
  `);
  
  const hasMaterializedView = viewCheck[0]?.view_exists;
  
  if (hasMaterializedView) {
    // Use materialized view for faster queries
    const sql = `
      SELECT * FROM bbref_team_season_stats WHERE team_id = $1
    `;
    const result = await query(sql, [resolvedTeamId]);
    return result[0] || null;
  }
  
  // Fallback: calculate on-the-fly
  const sql = `
    SELECT 
      COUNT(DISTINCT btgs.game_id) as games_played,
      AVG(btgs.points) as avg_points,
      SUM(btgs.points) as total_points,
      AVG(btgs.field_goals_made::numeric / NULLIF(btgs.field_goals_attempted, 0)) * 100 as fg_pct,
      AVG(btgs.field_goals_made) as avg_fgm,
      SUM(btgs.field_goals_made) as total_fgm,
      AVG(btgs.field_goals_attempted) as avg_fga,
      SUM(btgs.field_goals_attempted) as total_fga,
      AVG(btgs.three_pointers_made::numeric / NULLIF(btgs.three_pointers_attempted, 0)) * 100 as three_pct,
      AVG(btgs.three_pointers_made) as avg_3pm,
      SUM(btgs.three_pointers_made) as total_3pm,
      AVG(btgs.three_pointers_attempted) as avg_3pa,
      SUM(btgs.three_pointers_attempted) as total_3pa,
      AVG(btgs.free_throws_made::numeric / NULLIF(btgs.free_throws_attempted, 0)) * 100 as ft_pct,
      AVG(btgs.free_throws_made) as avg_ftm,
      SUM(btgs.free_throws_made) as total_ftm,
      AVG(btgs.free_throws_attempted) as avg_fta,
      SUM(btgs.free_throws_attempted) as total_fta,
      AVG(btgs.rebounds) as avg_rebounds,
      SUM(btgs.rebounds) as total_rebounds,
      AVG(btgs.offensive_rebounds) as avg_orb,
      SUM(btgs.offensive_rebounds) as total_orb,
      AVG(btgs.defensive_rebounds) as avg_drb,
      SUM(btgs.defensive_rebounds) as total_drb,
      AVG(btgs.assists) as avg_assists,
      SUM(btgs.assists) as total_assists,
      AVG(btgs.steals) as avg_steals,
      SUM(btgs.steals) as total_steals,
      AVG(btgs.blocks) as avg_blocks,
      SUM(btgs.blocks) as total_blocks,
      AVG(btgs.turnovers) as avg_turnovers,
      SUM(btgs.turnovers) as total_turnovers,
      AVG(btgs.personal_fouls) as avg_pf,
      SUM(btgs.personal_fouls) as total_pf,
      AVG(btgs.possessions) as avg_possessions,
      SUM(btgs.possessions) as total_possessions,
      AVG(CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END) as avg_points_against,
      SUM(CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END) as total_points_against,
      AVG(btgs.points) - AVG(CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END) as scoring_differential
    FROM bbref_team_game_stats btgs
    JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
    WHERE btgs.team_id = $1
      AND btgs.source = 'bbref'
      AND bg.status = 'Final'
  `;
  
  const result = await query(sql, [resolvedTeamId]);
  return result[0] || null;
}

/**
 * Get BBRef team season stats (points for/against, pace)
 */
export async function getBBRefSeasonStats(teamId: string, season: string | null) {
  let sql = `
    SELECT 
      COUNT(DISTINCT btgs.game_id) as games_played,
      AVG(btgs.points) as points_for,
      AVG(CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END) as points_against,
      AVG(btgs.points) - AVG(CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END) as scoring_differential,
      AVG(btgs.possessions * 48.0 / NULLIF(btgs.minutes, 0)) as pace,
      AVG(btgs.field_goals_made::numeric / NULLIF(btgs.field_goals_attempted, 0)) * 100 as fg_pct,
      AVG(btgs.three_pointers_made::numeric / NULLIF(btgs.three_pointers_attempted, 0)) * 100 as three_pct,
      SUM(btgs.field_goals_made) as total_fgm,
      SUM(btgs.field_goals_attempted) as total_fga,
      SUM(btgs.three_pointers_made) as total_3pm,
      SUM(btgs.three_pointers_attempted) as total_3pa
    FROM bbref_team_game_stats btgs
    JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
    WHERE btgs.team_id = $1 AND bg.status = 'Final' AND btgs.source = 'bbref'
  `;
  const params: any[] = [teamId];
  if (season) {
    sql += ` AND bg.season = $2`;
    params.push(season);
  }
  const result = await query(sql, params);
  return result[0] || {};
}

/**
 * Get BBRef team rankings (offensive and defensive)
 */
export async function getBBRefTeamRankings(teamId: string, season: string | null) {
  let sql = `
    WITH team_offensive AS (
      SELECT 
        btgs.team_id,
        AVG(btgs.points) as points_for
      FROM bbref_team_game_stats btgs
      JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
      WHERE bg.status = 'Final' AND btgs.source = 'bbref'
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
    team_defensive AS (
      SELECT 
        btgs.team_id,
        AVG(CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END) as points_against
      FROM bbref_team_game_stats btgs
      JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
      WHERE bg.status = 'Final' AND btgs.source = 'bbref'
  `;
  
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
        tof.team_id,
        tof.points_for,
        tdf.points_against,
        RANK() OVER (ORDER BY tof.points_for DESC) as offensive_rank,
        RANK() OVER (ORDER BY tdf.points_against ASC) as defensive_rank
      FROM team_offensive tof
      JOIN team_defensive tdf ON tof.team_id = tdf.team_id
    )
    SELECT 
      offensive_rank,
      defensive_rank
    FROM rankings
    WHERE team_id = $${paramCount}
  `;
  params.push(teamId);
  
  const result = await query(sql, params);
  return result[0] || { offensive_rank: null, defensive_rank: null };
}

/**
 * Get BBRef team home/away splits
 */
export async function getBBRefSplits(teamId: string, season: string | null) {
  let sql = `
    SELECT 
      btgs.is_home,
      COUNT(DISTINCT btgs.game_id) as games_played,
      AVG(btgs.points) as points_for,
      AVG(CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END) as points_against,
      AVG(btgs.points) - AVG(CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END) as scoring_differential,
      AVG(btgs.field_goals_made::numeric / NULLIF(btgs.field_goals_attempted, 0)) * 100 as fg_pct,
      AVG(btgs.three_pointers_made::numeric / NULLIF(btgs.three_pointers_attempted, 0)) * 100 as three_pct
    FROM bbref_team_game_stats btgs
    JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
    WHERE btgs.team_id = $1 AND bg.status = 'Final' AND btgs.source = 'bbref'
  `;
  const params: any[] = [teamId];
  if (season) {
    sql += ` AND bg.season = $2`;
    params.push(season);
  }
  sql += ` GROUP BY btgs.is_home`;
  const result = await query(sql, params);
  const home = result.find((r: any) => r.is_home) || {};
  const away = result.find((r: any) => !r.is_home) || {};
  return { home, away };
}

/**
 * Get BBRef team recent form (last 5, last 10)
 */
export async function getBBRefRecentForm(teamId: string, season: string | null) {
  let sql = `
    SELECT 
      btgs.game_id,
      COALESCE(bg.start_time, bg.game_date::timestamptz) as start_time,
      btgs.points as points_for,
      CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END as points_against,
      btgs.points - CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END as margin,
      CASE WHEN btgs.points > CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END THEN 'W' ELSE 'L' END as result,
      btgs.is_home,
      CASE WHEN btgs.is_home THEN bg.away_team_id ELSE bg.home_team_id END as opponent_team_id,
      CASE WHEN btgs.is_home THEN away_team.abbreviation ELSE home_team.abbreviation END as opponent_abbr,
      CASE WHEN btgs.is_home THEN away_team.full_name ELSE home_team.full_name END as opponent_name
    FROM bbref_team_game_stats btgs
    JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
    JOIN teams home_team ON bg.home_team_id = home_team.team_id
    JOIN teams away_team ON bg.away_team_id = away_team.team_id
    WHERE btgs.team_id = $1 AND bg.status = 'Final' AND btgs.source = 'bbref'
  `;
  const params: any[] = [teamId];
  if (season) {
    sql += ` AND bg.season = $2`;
    params.push(season);
  }
  sql += ` ORDER BY COALESCE(bg.start_time, bg.game_date) DESC LIMIT 10`;
  const result = await query(sql, params);
  const last10 = result.slice(0, 10);
  const last5 = result.slice(0, 5);
  return {
    last_5: {
      games: last5,
      wins: last5.filter((g: any) => g.result === 'W').length,
      losses: last5.filter((g: any) => g.result === 'L').length,
      avg_points_for: last5.length > 0 ? last5.reduce((sum: number, g: any) => sum + (g.points_for || 0), 0) / last5.length : 0,
      avg_points_against: last5.length > 0 ? last5.reduce((sum: number, g: any) => sum + (g.points_against || 0), 0) / last5.length : 0,
    },
    last_10: {
      games: last10,
      wins: last10.filter((g: any) => g.result === 'W').length,
      losses: last10.filter((g: any) => g.result === 'L').length,
      avg_points_for: last10.length > 0 ? last10.reduce((sum: number, g: any) => sum + (g.points_for || 0), 0) / last10.length : 0,
      avg_points_against: last10.length > 0 ? last10.reduce((sum: number, g: any) => sum + (g.points_against || 0), 0) / last10.length : 0,
    },
  };
}

/**
 * Get BBRef team upcoming games (next 5)
 */
export async function getBBRefUpcomingGames(teamId: string, limit: number = 5) {
  const now = new Date();
  
  // First try bbref_schedule for scheduled games
  const scheduleGames = await query(`
    SELECT 
      bs.bbref_game_id as game_id,
      COALESCE(bs.start_time, bs.game_date::timestamptz) as start_time,
      bs.game_date,
      'Scheduled' as status,
      CASE WHEN bs.home_team_id = $1 THEN bs.away_team_id ELSE bs.home_team_id END as opponent_team_id,
      CASE WHEN bs.home_team_id = $1 THEN bs.away_team_abbr ELSE bs.home_team_abbr END as opponent_abbr,
      CASE WHEN bs.home_team_id = $1 THEN away_team.full_name ELSE home_team.full_name END as opponent_name,
      (bs.home_team_id = $1)::boolean as is_home,
      NULL as venue
    FROM bbref_schedule bs
    LEFT JOIN teams home_team ON bs.home_team_id = home_team.team_id
    LEFT JOIN teams away_team ON bs.away_team_id = away_team.team_id
    WHERE (bs.home_team_id = $1 OR bs.away_team_id = $1)
      AND COALESCE(bs.start_time, bs.game_date::timestamptz) > $2
    ORDER BY COALESCE(bs.start_time, bs.game_date::timestamptz) ASC
    LIMIT $3
  `, [teamId, now, limit]);

  if (scheduleGames.length > 0) {
    return scheduleGames;
  }

  // Fallback to bbref_games for games that haven't been played yet
  const upcomingGames = await query(`
    SELECT 
      bg.bbref_game_id as game_id,
      COALESCE(bg.start_time, bg.game_date::timestamptz) as start_time,
      bg.game_date,
      bg.status,
      CASE WHEN bg.home_team_id = $1 THEN bg.away_team_id ELSE bg.home_team_id END as opponent_team_id,
      CASE WHEN bg.home_team_id = $1 THEN away_team.abbreviation ELSE home_team.abbreviation END as opponent_abbr,
      CASE WHEN bg.home_team_id = $1 THEN away_team.full_name ELSE home_team.full_name END as opponent_name,
      (bg.home_team_id = $1)::boolean as is_home,
      bg.venue
    FROM bbref_games bg
    JOIN teams home_team ON bg.home_team_id = home_team.team_id
    JOIN teams away_team ON bg.away_team_id = away_team.team_id
    WHERE (bg.home_team_id = $1 OR bg.away_team_id = $1)
      AND bg.status != 'Final'
      AND COALESCE(bg.start_time, bg.game_date::timestamptz) > $2
    ORDER BY COALESCE(bg.start_time, bg.game_date::timestamptz) ASC
    LIMIT $3
  `, [teamId, now, limit]);

  return upcomingGames;
}

/**
 * Get BBRef team quarter strengths
 */
export async function getBBRefQuarterStrengths(teamId: string, season: string | null) {
  try {
    // Check if quarter data exists in bbref_team_game_stats
    const hasQuarterData = await query(`
      SELECT COUNT(*)::int as count 
      FROM bbref_team_game_stats btgs
      JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
      WHERE btgs.team_id = $1 
        AND bg.status = 'Final'
        AND btgs.source = 'bbref'
        AND (btgs.points_q1 IS NOT NULL OR btgs.points_q2 IS NOT NULL OR btgs.points_q3 IS NOT NULL OR btgs.points_q4 IS NOT NULL)
    `, [teamId]);
    
    const count = Number(hasQuarterData[0]?.count || 0);
    if (count === 0) {
      return { q1: { avg_ppg: null, rank: null }, q2: { avg_ppg: null, rank: null }, q3: { avg_ppg: null, rank: null }, q4: { avg_ppg: null, rank: null } };
    }
    
    let sql = `
      SELECT 
        AVG(btgs.points_q1) as q1_ppg,
        AVG(btgs.points_q2) as q2_ppg,
        AVG(btgs.points_q3) as q3_ppg,
        AVG(btgs.points_q4) as q4_ppg
      FROM bbref_team_game_stats btgs
      JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
      WHERE btgs.team_id = $1 AND bg.status = 'Final' AND btgs.source = 'bbref' AND btgs.points_q1 IS NOT NULL
    `;
    const params: any[] = [teamId];
    if (season) {
      sql += ` AND bg.season = $2`;
      params.push(season);
    }
    const result = await query(sql, params);
    const data = result[0] || {};
    return {
      q1: { avg_ppg: data.q1_ppg != null ? Number(data.q1_ppg) : null, rank: null },
      q2: { avg_ppg: data.q2_ppg != null ? Number(data.q2_ppg) : null, rank: null },
      q3: { avg_ppg: data.q3_ppg != null ? Number(data.q3_ppg) : null, rank: null },
      q4: { avg_ppg: data.q4_ppg != null ? Number(data.q4_ppg) : null, rank: null },
    };
  } catch (error) {
    console.error('Error fetching quarter strengths:', error);
    return { q1: { avg_ppg: null, rank: null }, q2: { avg_ppg: null, rank: null }, q3: { avg_ppg: null, rank: null }, q4: { avg_ppg: null, rank: null } };
  }
}
