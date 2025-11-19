import { query } from '@/lib/db';

/**
 * Get defensive rankings for all teams
 * Returns teams ranked by defensive metrics
 */
export async function getAllTeamsDefensiveRankings(season: string | null = null) {
  let sql = `
    WITH team_defensive_stats AS (
      SELECT 
        tgs.team_id,
        t.abbreviation,
        t.full_name,
        t.conference,
        t.division,
        AVG(
          CASE 
            WHEN tgs.is_home THEN g.away_score
            ELSE g.home_score
          END
        ) as points_allowed_per_game,
        AVG(opp_tgs.rebounds) as rebounds_allowed_per_game,
        AVG(opp_tgs.assists) as assists_allowed_per_game,
        AVG(opp_tgs.field_goals_made::numeric / NULLIF(opp_tgs.field_goals_attempted, 0)) * 100 as fg_pct_allowed,
        AVG(opp_tgs.three_pointers_made::numeric / NULLIF(opp_tgs.three_pointers_attempted, 0)) * 100 as three_pct_allowed,
        COUNT(DISTINCT tgs.game_id) as games_played
      FROM team_game_stats tgs
      JOIN games g ON tgs.game_id = g.game_id
      JOIN team_game_stats opp_tgs ON g.game_id = opp_tgs.game_id 
        AND opp_tgs.team_id != tgs.team_id
      JOIN teams t ON tgs.team_id = t.team_id
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
      GROUP BY tgs.team_id, t.abbreviation, t.full_name, t.conference, t.division
    ),
    rankings AS (
      SELECT 
        team_id,
        abbreviation,
        full_name,
        conference,
        division,
        points_allowed_per_game,
        rebounds_allowed_per_game,
        assists_allowed_per_game,
        fg_pct_allowed,
        three_pct_allowed,
        games_played,
        RANK() OVER (ORDER BY points_allowed_per_game ASC) as points_allowed_rank,
        RANK() OVER (ORDER BY rebounds_allowed_per_game ASC) as rebounds_allowed_rank,
        RANK() OVER (ORDER BY assists_allowed_per_game ASC) as assists_allowed_rank,
        RANK() OVER (ORDER BY fg_pct_allowed ASC) as fg_pct_allowed_rank,
        RANK() OVER (ORDER BY three_pct_allowed ASC) as three_pct_allowed_rank
      FROM team_defensive_stats
      WHERE games_played >= 5  -- Only include teams with at least 5 games
    )
    SELECT 
      team_id,
      abbreviation,
      full_name,
      conference,
      division,
      points_allowed_rank,
      rebounds_allowed_rank,
      assists_allowed_rank,
      fg_pct_allowed_rank,
      three_pct_allowed_rank,
      points_allowed_per_game,
      rebounds_allowed_per_game,
      assists_allowed_per_game,
      fg_pct_allowed,
      three_pct_allowed,
      games_played
    FROM rankings
    ORDER BY points_allowed_rank ASC, full_name ASC
  `;

  const result = await query(sql, params);
  return result;
}

