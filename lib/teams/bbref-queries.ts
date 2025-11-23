import { query } from '@/lib/db';

/**
 * Get BBRef team game stats for a team
 * Uses only BBRef team IDs (from bbref_schedule, no provider_id_map lookups)
 */
export async function getBBRefTeamGameStats(teamId: string, limit: number | null = null) {
  // Resolve team_id: if it's an abbreviation, look it up in teams table
  // Otherwise use it directly (it should be the team_id from bbref_schedule)
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
      (g.start_time AT TIME ZONE 'America/New_York')::date as game_date,
      TO_CHAR((g.start_time AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') as game_date_str,
      g.start_time,
      ht.abbreviation as home_team,
      at.abbreviation as away_team,
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
        WHEN btgs.is_home AND g.home_score > g.away_score THEN 'W'
        WHEN btgs.is_home AND g.home_score < g.away_score THEN 'L'
        WHEN NOT btgs.is_home AND g.away_score > g.home_score THEN 'W'
        WHEN NOT btgs.is_home AND g.away_score < g.home_score THEN 'L'
        ELSE NULL
      END as result,
      CASE 
        WHEN btgs.is_home THEN g.home_score
        ELSE g.away_score
      END as team_score,
      CASE 
        WHEN btgs.is_home THEN g.away_score
        ELSE g.home_score
      END as opponent_score
    FROM bbref_team_game_stats btgs
    JOIN games g ON btgs.game_id = g.game_id
    JOIN teams ht ON g.home_team_id = ht.team_id
    JOIN teams at ON g.away_team_id = at.team_id
    WHERE btgs.team_id = $1
      AND btgs.source = 'bbref'
      AND EXISTS (
        SELECT 1 FROM bbref_schedule bs 
        WHERE bs.canonical_game_id = btgs.game_id
      )
    ORDER BY g.start_time DESC
    ${limit !== null ? `LIMIT $2` : ''}
  `;
  
  const params = limit !== null ? [resolvedTeamId, limit] : [resolvedTeamId];
  const result = await query(sql, params);
  return result;
}

/**
 * Get aggregated BBRef team season stats
 * Uses materialized view if available, otherwise calculates on-the-fly
 * Uses only BBRef team IDs (from bbref_schedule, no provider_id_map lookups)
 */
export async function getBBRefTeamSeasonStats(teamId: string) {
  // Resolve team_id: if it's an abbreviation, look it up in teams table
  // Otherwise use it directly (it should be the team_id from bbref_schedule)
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
      AVG(CASE WHEN btgs.is_home THEN g.away_score ELSE g.home_score END) as avg_points_against,
      SUM(CASE WHEN btgs.is_home THEN g.away_score ELSE g.home_score END) as total_points_against,
      AVG(btgs.points) - AVG(CASE WHEN btgs.is_home THEN g.away_score ELSE g.home_score END) as scoring_differential
    FROM bbref_team_game_stats btgs
    JOIN games g ON btgs.game_id = g.game_id
    WHERE btgs.team_id = $1
      AND btgs.source = 'bbref'
      AND EXISTS (
        SELECT 1 FROM bbref_schedule bs 
        WHERE bs.canonical_game_id = btgs.game_id
      )
  `;
  
  const result = await query(sql, [resolvedTeamId]);
  return result[0] || null;
}
