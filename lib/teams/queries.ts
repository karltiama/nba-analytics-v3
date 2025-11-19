import { query } from '@/lib/db';

export async function getTeamInfo(teamId: string) {
  const result = await query(
    `
    SELECT 
      team_id,
      abbreviation,
      full_name,
      name,
      city,
      conference,
      division
    FROM teams
    WHERE team_id = $1
    `,
    [teamId]
  );
  return result[0] || null;
}

export async function checkTeamStatsTable(): Promise<boolean> {
  try {
    const result = await query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'team_game_stats'
      )
    `);
    if (!result[0]?.exists) return false;
    const count = await query('SELECT COUNT(*) as count FROM team_game_stats LIMIT 1');
    return (count[0]?.count || 0) > 0;
  } catch {
    return false;
  }
}

export async function getTeamStats(teamId: string) {
  try {
    const useTeamStats = await checkTeamStatsTable();
    const season = null; // Can add season filter later

    // Get season stats
    const seasonStats = useTeamStats
      ? await getSeasonStatsFromTeamStats(teamId, season)
      : await getSeasonStatsFromPlayerStats(teamId, season);

    // Get rankings
    const rankings = await getTeamRankings(teamId, season, useTeamStats);

    // Get splits
    const splits = useTeamStats
      ? await getSplitsFromTeamStats(teamId, season)
      : await getSplitsFromPlayerStats(teamId, season);

    // Get recent form
    const recentForm = useTeamStats
      ? await getRecentFormFromTeamStats(teamId, season)
      : await getRecentFormFromPlayerStats(teamId, season);

    // Get quarter strengths
    const quarterStrengths = await getQuarterStrengths(teamId, season);

    return {
      team_id: teamId,
      season: season || 'all',
      season_stats: seasonStats,
      rankings,
      splits,
      recent_form: recentForm,
      quarter_strengths: quarterStrengths,
    };
  } catch (error) {
    console.error('Error fetching team stats:', error);
    return null;
  }
}

async function getSeasonStatsFromTeamStats(teamId: string, season: string | null) {
  let sql = `
    SELECT 
      COUNT(DISTINCT tgs.game_id) as games_played,
      AVG(tgs.points) as points_for,
      AVG(CASE WHEN tgs.is_home THEN g.away_score ELSE g.home_score END) as points_against,
      AVG(tgs.points) - AVG(CASE WHEN tgs.is_home THEN g.away_score ELSE g.home_score END) as scoring_differential,
      AVG(tgs.possessions * 48.0 / NULLIF(tgs.minutes, 0)) as pace,
      AVG(tgs.field_goals_made::numeric / NULLIF(tgs.field_goals_attempted, 0)) * 100 as fg_pct,
      AVG(tgs.three_pointers_made::numeric / NULLIF(tgs.three_pointers_attempted, 0)) * 100 as three_pct,
      SUM(tgs.field_goals_made) as total_fgm,
      SUM(tgs.field_goals_attempted) as total_fga,
      SUM(tgs.three_pointers_made) as total_3pm,
      SUM(tgs.three_pointers_attempted) as total_3pa
    FROM team_game_stats tgs
    JOIN games g ON tgs.game_id = g.game_id
    WHERE tgs.team_id = $1 AND g.status = 'Final'
  `;
  const params: any[] = [teamId];
  if (season) {
    sql += ` AND g.season = $2`;
    params.push(season);
  }
  const result = await query(sql, params);
  return result[0] || {};
}

async function getSeasonStatsFromPlayerStats(teamId: string, season: string | null) {
  let sql = `
    WITH team_totals AS (
      SELECT 
        pgs.game_id,
        SUM(pgs.points) as points,
        SUM(pgs.field_goals_made) as fgm,
        SUM(pgs.field_goals_attempted) as fga,
        SUM(pgs.three_pointers_made) as tpm,
        SUM(pgs.three_pointers_attempted) as tpa,
        SUM(pgs.rebounds) as rebounds,
        SUM(pgs.turnovers) as turnovers,
        SUM(pgs.minutes) as minutes,
        SUM(pgs.field_goals_attempted) + 
          0.44 * SUM(pgs.free_throws_attempted) - 
          (0.3 * SUM(pgs.rebounds)) + 
          SUM(pgs.turnovers) as possessions
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.game_id
      WHERE pgs.team_id = $1 AND g.status = 'Final' AND pgs.dnp_reason IS NULL
  `;
  const params: any[] = [teamId];
  if (season) {
    sql += ` AND g.season = $2`;
    params.push(season);
  }
  sql += `
      GROUP BY pgs.game_id
    )
    SELECT 
      COUNT(DISTINCT tt.game_id) as games_played,
      AVG(tt.points) as points_for,
      AVG(CASE WHEN g.home_team_id = $1 THEN g.away_score ELSE g.home_score END) as points_against,
      AVG(tt.points) - AVG(CASE WHEN g.home_team_id = $1 THEN g.away_score ELSE g.home_score END) as scoring_differential,
      AVG(tt.possessions * 48.0 / NULLIF(tt.minutes, 0)) as pace,
      AVG(tt.fgm::numeric / NULLIF(tt.fga, 0)) * 100 as fg_pct,
      AVG(tt.tpm::numeric / NULLIF(tt.tpa, 0)) * 100 as three_pct,
      SUM(tt.fgm) as total_fgm,
      SUM(tt.fga) as total_fga,
      SUM(tt.tpm) as total_3pm,
      SUM(tt.tpa) as total_3pa
    FROM team_totals tt
    JOIN games g ON tt.game_id = g.game_id
  `;
  const result = await query(sql, params);
  return result[0] || {};
}

async function getTeamRankings(teamId: string, season: string | null, useTeamStats: boolean) {
  // Get all teams' offensive and defensive ratings, then rank
  let sql = useTeamStats
    ? `
      WITH team_offensive AS (
        SELECT 
          tgs.team_id,
          AVG(tgs.points) as points_for
        FROM team_game_stats tgs
        JOIN games g ON tgs.game_id = g.game_id
        WHERE g.status = 'Final'
    `
    : `
      WITH team_offensive AS (
        SELECT 
          game_id,
          team_id,
          SUM(points) as points
        FROM player_game_stats
        WHERE dnp_reason IS NULL
        GROUP BY game_id, team_id
      ),
      team_offensive_avg AS (
        SELECT 
          tof.team_id,
          AVG(tof.points) as points_for
        FROM team_offensive tof
        JOIN games g ON tof.game_id = g.game_id
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
        GROUP BY ${useTeamStats ? 'tgs.team_id' : 'toa.team_id'}
      ),
      team_defensive AS (
  `;

  if (useTeamStats) {
    sql += `
        SELECT 
          tgs.team_id,
          AVG(
            CASE 
              WHEN tgs.is_home THEN g.away_score
              ELSE g.home_score
            END
          ) as points_against
        FROM team_game_stats tgs
        JOIN games g ON tgs.game_id = g.game_id
        WHERE g.status = 'Final'
    `;
  } else {
    sql += `
        SELECT 
          team_id,
          AVG(points_against) as points_against
        FROM (
          SELECT 
            g.home_team_id as team_id,
            g.away_score as points_against
          FROM games g
          WHERE g.status = 'Final'
    `;

    if (season) {
      sql += ` AND g.season = $${paramCount}`;
      params.push(season);
      paramCount++;
    }

    sql += `
          UNION ALL
          SELECT 
            g.away_team_id as team_id,
            g.home_score as points_against
          FROM games g
          WHERE g.status = 'Final'
    `;

    if (season) {
      sql += ` AND g.season = $${paramCount}`;
      params.push(season);
      paramCount++;
    }

    sql += `
        ) defensive_data
        GROUP BY team_id
    `;
  }

  if (season && useTeamStats) {
    sql += ` AND g.season = $${paramCount}`;
    params.push(season);
    paramCount++;
  } else if (!useTeamStats) {
    if (season) {
      sql += ` AND g.season = $${paramCount}`;
      params.push(season);
      paramCount++;
    }
  }

  sql += `
        GROUP BY ${useTeamStats ? 'tgs.team_id' : 'team_id'}
      ),
      rankings AS (
        SELECT 
          ${useTeamStats ? 'tof.team_id' : 'toa.team_id'} as team_id,
          ${useTeamStats ? 'tof.points_for' : 'toa.points_for'} as points_for,
          tdf.points_against,
          RANK() OVER (ORDER BY ${useTeamStats ? 'tof.points_for' : 'toa.points_for'} DESC) as offensive_rank,
          RANK() OVER (ORDER BY tdf.points_against ASC) as defensive_rank
        FROM ${useTeamStats ? 'team_offensive tof' : 'team_offensive_avg toa'}
        JOIN team_defensive tdf ON ${useTeamStats ? 'tof.team_id' : 'toa.team_id'} = tdf.team_id
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

async function getSplitsFromTeamStats(teamId: string, season: string | null) {
  let sql = `
    SELECT 
      tgs.is_home,
      COUNT(DISTINCT tgs.game_id) as games_played,
      AVG(tgs.points) as points_for,
      AVG(CASE WHEN tgs.is_home THEN g.away_score ELSE g.home_score END) as points_against,
      AVG(tgs.points) - AVG(CASE WHEN tgs.is_home THEN g.away_score ELSE g.home_score END) as scoring_differential,
      AVG(tgs.field_goals_made::numeric / NULLIF(tgs.field_goals_attempted, 0)) * 100 as fg_pct,
      AVG(tgs.three_pointers_made::numeric / NULLIF(tgs.three_pointers_attempted, 0)) * 100 as three_pct
    FROM team_game_stats tgs
    JOIN games g ON tgs.game_id = g.game_id
    WHERE tgs.team_id = $1 AND g.status = 'Final'
  `;
  const params: any[] = [teamId];
  if (season) {
    sql += ` AND g.season = $2`;
    params.push(season);
  }
  sql += ` GROUP BY tgs.is_home`;
  const result = await query(sql, params);
  const home = result.find((r: any) => r.is_home) || {};
  const away = result.find((r: any) => !r.is_home) || {};
  return { home, away };
}

async function getSplitsFromPlayerStats(teamId: string, season: string | null) {
  let sql = `
    WITH team_totals AS (
      SELECT 
        pgs.game_id,
        pgs.team_id,
        SUM(pgs.points) as points,
        SUM(pgs.field_goals_made) as fgm,
        SUM(pgs.field_goals_attempted) as fga,
        SUM(pgs.three_pointers_made) as tpm,
        SUM(pgs.three_pointers_attempted) as tpa
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.game_id
      WHERE pgs.team_id = $1 AND g.status = 'Final' AND pgs.dnp_reason IS NULL
  `;
  const params: any[] = [teamId];
  if (season) {
    sql += ` AND g.season = $2`;
    params.push(season);
  }
  sql += `
      GROUP BY pgs.game_id, pgs.team_id
    )
    SELECT 
      (tt.team_id = g.home_team_id) as is_home,
      COUNT(DISTINCT tt.game_id) as games_played,
      AVG(tt.points) as points_for,
      AVG(CASE WHEN tt.team_id = g.home_team_id THEN g.away_score ELSE g.home_score END) as points_against,
      AVG(tt.points) - AVG(CASE WHEN tt.team_id = g.home_team_id THEN g.away_score ELSE g.home_score END) as scoring_differential,
      AVG(tt.fgm::numeric / NULLIF(tt.fga, 0)) * 100 as fg_pct,
      AVG(tt.tpm::numeric / NULLIF(tt.tpa, 0)) * 100 as three_pct
    FROM team_totals tt
    JOIN games g ON tt.game_id = g.game_id
    GROUP BY tt.team_id, g.home_team_id
  `;
  const result = await query(sql, params);
  const home = result.find((r: any) => r.is_home) || {};
  const away = result.find((r: any) => !r.is_home) || {};
  return { home, away };
}

async function getRecentFormFromTeamStats(teamId: string, season: string | null) {
  let sql = `
    SELECT 
      tgs.game_id,
      g.start_time,
      tgs.points as points_for,
      CASE WHEN tgs.is_home THEN g.away_score ELSE g.home_score END as points_against,
      tgs.points - CASE WHEN tgs.is_home THEN g.away_score ELSE g.home_score END as margin,
      CASE WHEN tgs.points > CASE WHEN tgs.is_home THEN g.away_score ELSE g.home_score END THEN 'W' ELSE 'L' END as result,
      CASE WHEN tgs.is_home THEN g.away_team_id ELSE g.home_team_id END as opponent_team_id,
      CASE WHEN tgs.is_home THEN away_team.abbreviation ELSE home_team.abbreviation END as opponent_abbr,
      CASE WHEN tgs.is_home THEN away_team.full_name ELSE home_team.full_name END as opponent_name
    FROM team_game_stats tgs
    JOIN games g ON tgs.game_id = g.game_id
    JOIN teams home_team ON g.home_team_id = home_team.team_id
    JOIN teams away_team ON g.away_team_id = away_team.team_id
    WHERE tgs.team_id = $1 AND g.status = 'Final'
  `;
  const params: any[] = [teamId];
  if (season) {
    sql += ` AND g.season = $2`;
    params.push(season);
  }
  sql += ` ORDER BY g.start_time DESC LIMIT 10`;
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

async function getRecentFormFromPlayerStats(teamId: string, season: string | null) {
  let sql = `
    WITH team_totals AS (
      SELECT 
        pgs.game_id,
        SUM(pgs.points) as points
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.game_id
      WHERE pgs.team_id = $1 AND g.status = 'Final' AND pgs.dnp_reason IS NULL
  `;
  const params: any[] = [teamId];
  if (season) {
    sql += ` AND g.season = $2`;
    params.push(season);
  }
  sql += `
      GROUP BY pgs.game_id
    )
    SELECT 
      tt.game_id,
      g.start_time,
      tt.points as points_for,
      CASE WHEN g.home_team_id = $1 THEN g.away_score ELSE g.home_score END as points_against,
      tt.points - CASE WHEN g.home_team_id = $1 THEN g.away_score ELSE g.home_score END as margin,
      CASE WHEN tt.points > CASE WHEN g.home_team_id = $1 THEN g.away_score ELSE g.home_score END THEN 'W' ELSE 'L' END as result,
      CASE WHEN g.home_team_id = $1 THEN g.away_team_id ELSE g.home_team_id END as opponent_team_id,
      CASE WHEN g.home_team_id = $1 THEN away_team.abbreviation ELSE home_team.abbreviation END as opponent_abbr,
      CASE WHEN g.home_team_id = $1 THEN away_team.full_name ELSE home_team.full_name END as opponent_name
    FROM team_totals tt
    JOIN games g ON tt.game_id = g.game_id
    JOIN teams home_team ON g.home_team_id = home_team.team_id
    JOIN teams away_team ON g.away_team_id = away_team.team_id
    ORDER BY g.start_time DESC
    LIMIT 10
  `;
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

async function getQuarterStrengths(teamId: string, season: string | null) {
  try {
    // Check if team_game_stats table exists
    const tableExists = await query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'team_game_stats'
      )
    `);
    
    if (!tableExists[0]?.exists) {
      return { q1: { avg_ppg: null, rank: null }, q2: { avg_ppg: null, rank: null }, q3: { avg_ppg: null, rank: null }, q4: { avg_ppg: null, rank: null } };
    }

    // Check if quarter data exists
    const hasQuarterData = await query(`
      SELECT COUNT(*)::int as count 
      FROM team_game_stats 
      WHERE team_id = $1 
        AND (points_q1 IS NOT NULL OR points_q2 IS NOT NULL OR points_q3 IS NOT NULL OR points_q4 IS NOT NULL)
    `, [teamId]);
    
    const count = Number(hasQuarterData[0]?.count || 0);
    if (count === 0) {
      console.log(`No quarter data found for team ${teamId}`);
      return { q1: { avg_ppg: null, rank: null }, q2: { avg_ppg: null, rank: null }, q3: { avg_ppg: null, rank: null }, q4: { avg_ppg: null, rank: null } };
    }
    
    // Return simplified version for now (can add full ranking later)
    let sql = `
      SELECT 
        AVG(points_q1) as q1_ppg,
        AVG(points_q2) as q2_ppg,
        AVG(points_q3) as q3_ppg,
        AVG(points_q4) as q4_ppg
      FROM team_game_stats tgs
      JOIN games g ON tgs.game_id = g.game_id
      WHERE tgs.team_id = $1 AND g.status = 'Final' AND tgs.points_q1 IS NOT NULL
    `;
    const params: any[] = [teamId];
    if (season) {
      sql += ` AND g.season = $2`;
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

