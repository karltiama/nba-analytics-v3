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
    // Always use bbref_team_game_stats (Basketball Reference source)
    const result = await query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'bbref_team_game_stats'
      )
    `);
    if (!result[0]?.exists) return false;
    const count = await query('SELECT COUNT(*) as count FROM bbref_team_game_stats WHERE source = \'bbref\' LIMIT 1');
    return (count[0]?.count || 0) > 0;
  } catch {
    return false;
  }
}

export async function getTeamStats(teamId: string) {
  try {
    const useTeamStats = await checkTeamStatsTable();
    const season = null; // Can add season filter later

    // Get season stats (always use BBRef if available)
    const seasonStats = useTeamStats
      ? await getSeasonStatsFromTeamStats(teamId, season)
      : await getSeasonStatsFromPlayerStats(teamId, season);

    // Get full season record from bbref_games
    const seasonRecord = await getSeasonRecordFromBBRef(teamId, season);

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
      season_record: seasonRecord, // Full season wins/losses from bbref_games
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

/**
 * Get full season record from bbref_games (Basketball Reference source)
 */
async function getSeasonRecordFromBBRef(teamId: string, season: string | null) {
  let sql = `
    SELECT 
      COUNT(DISTINCT game_id) as games_played,
      SUM(CASE WHEN won THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN NOT won THEN 1 ELSE 0 END) as losses,
      SUM(CASE WHEN is_home AND won THEN 1 ELSE 0 END) as home_wins,
      SUM(CASE WHEN is_home AND NOT won THEN 1 ELSE 0 END) as home_losses,
      SUM(CASE WHEN NOT is_home AND won THEN 1 ELSE 0 END) as away_wins,
      SUM(CASE WHEN NOT is_home AND NOT won THEN 1 ELSE 0 END) as away_losses
    FROM (
      SELECT 
        bg.bbref_game_id as game_id,
        bg.home_team_id = $1 as is_home,
        bg.home_score > bg.away_score as won
      FROM bbref_games bg
      WHERE bg.status = 'Final'
        AND bg.home_score IS NOT NULL 
        AND bg.away_score IS NOT NULL
        AND bg.home_team_id = $1
  `;
  const params: any[] = [teamId];
  let paramCount = 2;
  
  if (season) {
    sql += ` AND bg.season = $${paramCount}`;
    params.push(season);
    paramCount++;
  }
  
  sql += `
      UNION ALL
      SELECT 
        bg.bbref_game_id as game_id,
        false as is_home,
        bg.away_score > bg.home_score as won
      FROM bbref_games bg
      WHERE bg.status = 'Final'
        AND bg.home_score IS NOT NULL 
        AND bg.away_score IS NOT NULL
        AND bg.away_team_id = $1
  `;
  
  if (season) {
    sql += ` AND bg.season = $${paramCount}`;
    params.push(season);
    paramCount++;
  }
  
  sql += `) game_results`;
  
  const result = await query(sql, params);
  return result[0] || { games_played: 0, wins: 0, losses: 0, home_wins: 0, home_losses: 0, away_wins: 0, away_losses: 0 };
}

async function getSeasonStatsFromTeamStats(teamId: string, season: string | null) {
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
    WHERE btgs.team_id = $1 
      AND bg.status = 'Final'
      AND btgs.source = 'bbref'
  `;
  const params: any[] = [teamId];
  if (season) {
    sql += ` AND bg.season = $2`;
    params.push(season);
  }
  const result = await query(sql, params);
  return result[0] || {};
}

async function getSeasonStatsFromPlayerStats(teamId: string, season: string | null) {
  let sql = `
    WITH team_totals AS (
      SELECT 
        bpgs.game_id,
        SUM(bpgs.points) as points,
        SUM(bpgs.field_goals_made) as fgm,
        SUM(bpgs.field_goals_attempted) as fga,
        SUM(bpgs.three_pointers_made) as tpm,
        SUM(bpgs.three_pointers_attempted) as tpa,
        SUM(bpgs.rebounds) as rebounds,
        SUM(bpgs.turnovers) as turnovers,
        SUM(bpgs.minutes) as minutes,
        SUM(bpgs.field_goals_attempted) + 
          0.44 * SUM(bpgs.free_throws_attempted) - 
          COALESCE(SUM(bpgs.offensive_rebounds), 0) + 
          SUM(bpgs.turnovers) as possessions
      FROM bbref_player_game_stats bpgs
      JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
      WHERE bpgs.team_id = $1 
        AND bg.status = 'Final' 
        AND bpgs.dnp_reason IS NULL
  `;
  const params: any[] = [teamId];
  if (season) {
    sql += ` AND bg.season = $2`;
    params.push(season);
  }
  sql += `
      GROUP BY bpgs.game_id
    )
    SELECT 
      COUNT(DISTINCT tt.game_id) as games_played,
      AVG(tt.points) as points_for,
      AVG(CASE WHEN bg.home_team_id = $1 THEN bg.away_score ELSE bg.home_score END) as points_against,
      AVG(tt.points) - AVG(CASE WHEN bg.home_team_id = $1 THEN bg.away_score ELSE bg.home_score END) as scoring_differential,
      AVG(tt.possessions * 48.0 / NULLIF(tt.minutes, 0)) as pace,
      AVG(tt.fgm::numeric / NULLIF(tt.fga, 0)) * 100 as fg_pct,
      AVG(tt.tpm::numeric / NULLIF(tt.tpa, 0)) * 100 as three_pct,
      SUM(tt.fgm) as total_fgm,
      SUM(tt.fga) as total_fga,
      SUM(tt.tpm) as total_3pm,
      SUM(tt.tpa) as total_3pa
    FROM team_totals tt
    JOIN bbref_games bg ON tt.game_id = bg.bbref_game_id
  `;
  const result = await query(sql, params);
  return result[0] || {};
}

async function getTeamRankings(teamId: string, season: string | null, useTeamStats: boolean) {
  // Get all teams' offensive and defensive ratings, then rank
  // Always use Basketball Reference data
  let sql = useTeamStats
    ? `
      WITH team_offensive AS (
        SELECT 
          btgs.team_id,
          AVG(btgs.points) as points_for
        FROM bbref_team_game_stats btgs
        JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
        WHERE bg.status = 'Final'
          AND btgs.source = 'bbref'
    `
    : `
      WITH team_offensive AS (
        SELECT 
          game_id,
          team_id,
          SUM(points) as points
        FROM bbref_player_game_stats
        WHERE dnp_reason IS NULL
        GROUP BY game_id, team_id
      ),
      team_offensive_avg AS (
        SELECT 
          tof.team_id,
          AVG(tof.points) as points_for
        FROM team_offensive tof
        JOIN bbref_games bg ON tof.game_id = bg.bbref_game_id
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
        GROUP BY ${useTeamStats ? 'btgs.team_id' : 'toa.team_id'}
      ),
      team_defensive AS (
  `;

  if (useTeamStats) {
    sql += `
        SELECT 
          btgs.team_id,
          AVG(
            CASE 
              WHEN btgs.is_home THEN bg.away_score
              ELSE bg.home_score
            END
          ) as points_against
        FROM bbref_team_game_stats btgs
        JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
        WHERE bg.status = 'Final'
          AND btgs.source = 'bbref'
    `;
  } else {
    sql += `
        SELECT 
          team_id,
          AVG(points_against) as points_against
        FROM (
          SELECT 
            bg.home_team_id as team_id,
            bg.away_score as points_against
          FROM bbref_games bg
          WHERE bg.status = 'Final'
    `;

    if (season) {
      sql += ` AND bg.season = $${paramCount}`;
      params.push(season);
      paramCount++;
    }

    sql += `
          UNION ALL
          SELECT 
            bg.away_team_id as team_id,
            bg.home_score as points_against
          FROM bbref_games bg
          WHERE bg.status = 'Final'
    `;

    if (season) {
      sql += ` AND bg.season = $${paramCount}`;
      params.push(season);
      paramCount++;
    }

    sql += `
        ) defensive_data
        GROUP BY team_id
    `;
  }

  if (season && useTeamStats) {
    sql += ` AND bg.season = $${paramCount}`;
    params.push(season);
    paramCount++;
  } else if (!useTeamStats) {
    if (season) {
      sql += ` AND bg.season = $${paramCount}`;
      params.push(season);
      paramCount++;
    }
  }

  sql += `
        GROUP BY ${useTeamStats ? 'btgs.team_id' : 'team_id'}
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
      btgs.is_home,
      COUNT(DISTINCT btgs.game_id) as games_played,
      AVG(btgs.points) as points_for,
      AVG(CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END) as points_against,
      AVG(btgs.points) - AVG(CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END) as scoring_differential,
      AVG(btgs.field_goals_made::numeric / NULLIF(btgs.field_goals_attempted, 0)) * 100 as fg_pct,
      AVG(btgs.three_pointers_made::numeric / NULLIF(btgs.three_pointers_attempted, 0)) * 100 as three_pct
    FROM bbref_team_game_stats btgs
    JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
    WHERE btgs.team_id = $1 
      AND bg.status = 'Final'
      AND btgs.source = 'bbref'
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

async function getSplitsFromPlayerStats(teamId: string, season: string | null) {
  let sql = `
    WITH team_totals AS (
      SELECT 
        bpgs.game_id,
        bpgs.team_id,
        SUM(bpgs.points) as points,
        SUM(bpgs.field_goals_made) as fgm,
        SUM(bpgs.field_goals_attempted) as fga,
        SUM(bpgs.three_pointers_made) as tpm,
        SUM(bpgs.three_pointers_attempted) as tpa
      FROM bbref_player_game_stats bpgs
      JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
      WHERE bpgs.team_id = $1 
        AND bg.status = 'Final' 
        AND bpgs.dnp_reason IS NULL
  `;
  const params: any[] = [teamId];
  if (season) {
    sql += ` AND bg.season = $2`;
    params.push(season);
  }
  sql += `
      GROUP BY bpgs.game_id, bpgs.team_id
    )
    SELECT 
      (tt.team_id = bg.home_team_id) as is_home,
      COUNT(DISTINCT tt.game_id) as games_played,
      AVG(tt.points) as points_for,
      AVG(CASE WHEN tt.team_id = bg.home_team_id THEN bg.away_score ELSE bg.home_score END) as points_against,
      AVG(tt.points) - AVG(CASE WHEN tt.team_id = bg.home_team_id THEN bg.away_score ELSE bg.home_score END) as scoring_differential,
      AVG(tt.fgm::numeric / NULLIF(tt.fga, 0)) * 100 as fg_pct,
      AVG(tt.tpm::numeric / NULLIF(tt.tpa, 0)) * 100 as three_pct
    FROM team_totals tt
    JOIN bbref_games bg ON tt.game_id = bg.bbref_game_id
    GROUP BY tt.team_id, bg.home_team_id
  `;
  const result = await query(sql, params);
  const home = result.find((r: any) => r.is_home) || {};
  const away = result.find((r: any) => !r.is_home) || {};
  return { home, away };
}

async function getRecentFormFromTeamStats(teamId: string, season: string | null) {
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
    WHERE btgs.team_id = $1 
      AND bg.status = 'Final'
      AND btgs.source = 'bbref'
  `;
  const params: any[] = [teamId];
  if (season) {
    sql += ` AND bg.season = $2`;
    params.push(season);
  }
  sql += ` ORDER BY COALESCE(bg.start_time, bg.game_date::timestamptz) DESC LIMIT 10`;
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
        bpgs.game_id,
        SUM(bpgs.points) as points
      FROM bbref_player_game_stats bpgs
      JOIN bbref_games bg ON bpgs.game_id = bg.bbref_game_id
      WHERE bpgs.team_id = $1 
        AND bg.status = 'Final' 
        AND bpgs.dnp_reason IS NULL
  `;
  const params: any[] = [teamId];
  if (season) {
    sql += ` AND bg.season = $2`;
    params.push(season);
  }
  sql += `
      GROUP BY bpgs.game_id
    )
    SELECT 
      tt.game_id,
      COALESCE(bg.start_time, bg.game_date::timestamptz) as start_time,
      tt.points as points_for,
      CASE WHEN bg.home_team_id = $1 THEN bg.away_score ELSE bg.home_score END as points_against,
      tt.points - CASE WHEN bg.home_team_id = $1 THEN bg.away_score ELSE bg.home_score END as margin,
      CASE WHEN tt.points > CASE WHEN bg.home_team_id = $1 THEN bg.away_score ELSE bg.home_score END THEN 'W' ELSE 'L' END as result,
      (bg.home_team_id = $1) as is_home,
      CASE WHEN bg.home_team_id = $1 THEN bg.away_team_id ELSE bg.home_team_id END as opponent_team_id,
      CASE WHEN bg.home_team_id = $1 THEN away_team.abbreviation ELSE home_team.abbreviation END as opponent_abbr,
      CASE WHEN bg.home_team_id = $1 THEN away_team.full_name ELSE home_team.full_name END as opponent_name
    FROM team_totals tt
    JOIN bbref_games bg ON tt.game_id = bg.bbref_game_id
    JOIN teams home_team ON bg.home_team_id = home_team.team_id
    JOIN teams away_team ON bg.away_team_id = away_team.team_id
    ORDER BY COALESCE(bg.start_time, bg.game_date::timestamptz) DESC
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
  // Quarter columns (points_q1, points_q2, etc.) don't exist in bbref_team_game_stats
  // Return null values until quarter data is added to the schema
  return { 
    q1: { avg_ppg: null, rank: null }, 
    q2: { avg_ppg: null, rank: null }, 
    q3: { avg_ppg: null, rank: null }, 
    q4: { avg_ppg: null, rank: null } 
  };
}

