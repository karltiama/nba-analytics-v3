import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const season = searchParams.get('season') || null;

    // Check if team_game_stats table exists and has data, otherwise aggregate from player_game_stats
    const useTeamStats = await checkTeamStatsTable();

    // Get season stats (Points For/Against, Pace, FG%, 3P%, Scoring Differential)
    const seasonStats = useTeamStats
      ? await getSeasonStatsFromTeamStats(teamId, season)
      : await getSeasonStatsFromPlayerStats(teamId, season);

    // Get offensive/defensive rankings
    const rankings = await getTeamRankings(teamId, season, useTeamStats);

    // Get home/away splits
    const splits = useTeamStats
      ? await getSplitsFromTeamStats(teamId, season)
      : await getSplitsFromPlayerStats(teamId, season);

    // Get recent form (Last 5, Last 10)
    const recentForm = useTeamStats
      ? await getRecentFormFromTeamStats(teamId, season)
      : await getRecentFormFromPlayerStats(teamId, season);

    // Get quarter strengths (Q1-Q4 PPG ranks)
    const quarterStrengths = await getQuarterStrengths(teamId, season);

    return NextResponse.json({
      team_id: teamId,
      season: season || 'all',
      season_stats: seasonStats,
      rankings,
      splits,
      recent_form: recentForm,
      quarter_strengths: quarterStrengths,
    });
  } catch (error: any) {
    console.error('Error fetching team stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch team stats', message: error.message },
      { status: 500 }
    );
  }
}

// Helper: Check if team_game_stats table exists and has data
async function checkTeamStatsTable(): Promise<boolean> {
  try {
    const result = await query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'team_game_stats'
      )
    `);
    if (!result[0]?.exists) return false;

    // Check if it has any data
    const count = await query('SELECT COUNT(*) as count FROM team_game_stats LIMIT 1');
    return (count[0]?.count || 0) > 0;
  } catch {
    return false;
  }
}

// Get season stats from team_game_stats table
async function getSeasonStatsFromTeamStats(teamId: string, season: string | null) {
  let sql = `
    SELECT 
      COUNT(DISTINCT tgs.game_id) as games_played,
      AVG(tgs.points) as points_for,
      AVG(
        CASE 
          WHEN tgs.is_home THEN g.away_score
          ELSE g.home_score
        END
      ) as points_against,
      AVG(tgs.points) - AVG(
        CASE 
          WHEN tgs.is_home THEN g.away_score
          ELSE g.home_score
        END
      ) as scoring_differential,
      -- Pace: possessions per 48 minutes
      AVG(tgs.possessions * 48.0 / NULLIF(tgs.minutes, 0)) as pace,
      -- FG%
      AVG(tgs.field_goals_made::numeric / NULLIF(tgs.field_goals_attempted, 0)) * 100 as fg_pct,
      -- 3P%
      AVG(tgs.three_pointers_made::numeric / NULLIF(tgs.three_pointers_attempted, 0)) * 100 as three_pct,
      SUM(tgs.field_goals_made) as total_fgm,
      SUM(tgs.field_goals_attempted) as total_fga,
      SUM(tgs.three_pointers_made) as total_3pm,
      SUM(tgs.three_pointers_attempted) as total_3pa
    FROM team_game_stats tgs
    JOIN games g ON tgs.game_id = g.game_id
    WHERE tgs.team_id = $1
      AND g.status = 'Final'
  `;
  const params: any[] = [teamId];
  let paramCount = 2;

  if (season) {
    sql += ` AND g.season = $${paramCount}`;
    params.push(season);
    paramCount++;
  }

  const result = await query(sql, params);
  return result[0] || {};
}

// Get season stats by aggregating from player_game_stats
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
      WHERE pgs.team_id = $1
        AND g.status = 'Final'
        AND pgs.dnp_reason IS NULL
  `;
  const params: any[] = [teamId];
  let paramCount = 2;

  if (season) {
    sql += ` AND g.season = $${paramCount}`;
    params.push(season);
    paramCount++;
  }

  sql += `
      GROUP BY pgs.game_id
    ),
    opponent_scores AS (
      SELECT 
        g.game_id,
        CASE 
          WHEN g.home_team_id = $1 THEN g.away_score
          ELSE g.home_score
        END as opponent_points
      FROM games g
      WHERE (g.home_team_id = $1 OR g.away_team_id = $1)
        AND g.status = 'Final'
  `;

  if (season) {
    sql += ` AND g.season = $${paramCount}`;
    params.push(season);
    paramCount++;
  }

  sql += `
    )
    SELECT 
      COUNT(DISTINCT tt.game_id) as games_played,
      AVG(tt.points) as points_for,
      AVG(os.opponent_points) as points_against,
      AVG(tt.points) - AVG(os.opponent_points) as scoring_differential,
      AVG(tt.possessions * 48.0 / NULLIF(tt.minutes, 0)) as pace,
      AVG(tt.fgm::numeric / NULLIF(tt.fga, 0)) * 100 as fg_pct,
      AVG(tt.tpm::numeric / NULLIF(tt.tpa, 0)) * 100 as three_pct,
      SUM(tt.fgm) as total_fgm,
      SUM(tt.fga) as total_fga,
      SUM(tt.tpm) as total_3pm,
      SUM(tt.tpa) as total_3pa
    FROM team_totals tt
    JOIN opponent_scores os ON tt.game_id = os.game_id
  `;

  const result = await query(sql, params);
  return result[0] || {};
}

// Get offensive/defensive rankings
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
          pgs.team_id,
          AVG(team_points.points) as points_for
        FROM player_game_stats pgs
        JOIN games g ON pgs.game_id = g.game_id
        JOIN (
          SELECT 
            game_id,
            team_id,
            SUM(points) as points
          FROM player_game_stats
          WHERE dnp_reason IS NULL
          GROUP BY game_id, team_id
        ) team_points ON pgs.game_id = team_points.game_id AND pgs.team_id = team_points.team_id
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
        GROUP BY ${useTeamStats ? 'tgs.team_id' : 'pgs.team_id'}
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
          g.home_team_id as team_id,
          AVG(g.away_score) as points_against
        FROM games g
        WHERE g.status = 'Final'
    `;

    if (season) {
      sql += ` AND g.season = $${paramCount}`;
      params.push(season);
      paramCount++;
    }

    sql += `
        GROUP BY g.home_team_id
        UNION ALL
        SELECT 
          g.away_team_id as team_id,
          AVG(g.home_score) as points_against
        FROM games g
        WHERE g.status = 'Final'
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

// Get home/away splits
async function getSplitsFromTeamStats(teamId: string, season: string | null) {
  let sql = `
    SELECT 
      tgs.is_home,
      COUNT(DISTINCT tgs.game_id) as games_played,
      AVG(tgs.points) as points_for,
      AVG(
        CASE 
          WHEN tgs.is_home THEN g.away_score
          ELSE g.home_score
        END
      ) as points_against,
      AVG(tgs.points) - AVG(
        CASE 
          WHEN tgs.is_home THEN g.away_score
          ELSE g.home_score
        END
      ) as scoring_differential,
      AVG(tgs.field_goals_made::numeric / NULLIF(tgs.field_goals_attempted, 0)) * 100 as fg_pct,
      AVG(tgs.three_pointers_made::numeric / NULLIF(tgs.three_pointers_attempted, 0)) * 100 as three_pct
    FROM team_game_stats tgs
    JOIN games g ON tgs.game_id = g.game_id
    WHERE tgs.team_id = $1
      AND g.status = 'Final'
  `;
  const params: any[] = [teamId];
  let paramCount = 2;

  if (season) {
    sql += ` AND g.season = $${paramCount}`;
    params.push(season);
    paramCount++;
  }

  sql += ` GROUP BY tgs.is_home`;

  const result = await query(sql, params);
  
  const home = result.find((r: any) => r.is_home) || {};
  const away = result.find((r: any) => !r.is_home) || {};

  return {
    home: {
      games_played: home.games_played || 0,
      points_for: home.points_for || 0,
      points_against: home.points_against || 0,
      scoring_differential: home.scoring_differential || 0,
      fg_pct: home.fg_pct || 0,
      three_pct: home.three_pct || 0,
    },
    away: {
      games_played: away.games_played || 0,
      points_for: away.points_for || 0,
      points_against: away.points_against || 0,
      scoring_differential: away.scoring_differential || 0,
      fg_pct: away.fg_pct || 0,
      three_pct: away.three_pct || 0,
    },
  };
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
      WHERE pgs.team_id = $1
        AND g.status = 'Final'
        AND pgs.dnp_reason IS NULL
  `;
  const params: any[] = [teamId];
  let paramCount = 2;

  if (season) {
    sql += ` AND g.season = $${paramCount}`;
    params.push(season);
    paramCount++;
  }

  sql += `
      GROUP BY pgs.game_id, pgs.team_id
    )
    SELECT 
      (tt.team_id = g.home_team_id) as is_home,
      COUNT(DISTINCT tt.game_id) as games_played,
      AVG(tt.points) as points_for,
      AVG(
        CASE 
          WHEN tt.team_id = g.home_team_id THEN g.away_score
          ELSE g.home_score
        END
      ) as points_against,
      AVG(tt.points) - AVG(
        CASE 
          WHEN tt.team_id = g.home_team_id THEN g.away_score
          ELSE g.home_score
        END
      ) as scoring_differential,
      AVG(tt.fgm::numeric / NULLIF(tt.fga, 0)) * 100 as fg_pct,
      AVG(tt.tpm::numeric / NULLIF(tt.tpa, 0)) * 100 as three_pct
    FROM team_totals tt
    JOIN games g ON tt.game_id = g.game_id
    GROUP BY tt.team_id, g.home_team_id
  `;

  const result = await query(sql, params);
  
  const home = result.find((r: any) => r.is_home) || {};
  const away = result.find((r: any) => !r.is_home) || {};

  return {
    home: {
      games_played: home.games_played || 0,
      points_for: home.points_for || 0,
      points_against: home.points_against || 0,
      scoring_differential: home.scoring_differential || 0,
      fg_pct: home.fg_pct || 0,
      three_pct: home.three_pct || 0,
    },
    away: {
      games_played: away.games_played || 0,
      points_for: away.points_for || 0,
      points_against: away.points_against || 0,
      scoring_differential: away.scoring_differential || 0,
      fg_pct: away.fg_pct || 0,
      three_pct: away.three_pct || 0,
    },
  };
}

// Get recent form (Last 5, Last 10)
async function getRecentFormFromTeamStats(teamId: string, season: string | null) {
  let sql = `
    SELECT 
      tgs.game_id,
      g.start_time,
      tgs.points as points_for,
      CASE 
        WHEN tgs.is_home THEN g.away_score
        ELSE g.home_score
      END as points_against,
      tgs.points - CASE 
        WHEN tgs.is_home THEN g.away_score
        ELSE g.home_score
      END as margin,
      CASE 
        WHEN tgs.points > CASE WHEN tgs.is_home THEN g.away_score ELSE g.home_score END THEN 'W'
        ELSE 'L'
      END as result
    FROM team_game_stats tgs
    JOIN games g ON tgs.game_id = g.game_id
    WHERE tgs.team_id = $1
      AND g.status = 'Final'
  `;
  const params: any[] = [teamId];
  let paramCount = 2;

  if (season) {
    sql += ` AND g.season = $${paramCount}`;
    params.push(season);
    paramCount++;
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
      avg_points_for: last5.length > 0 
        ? last5.reduce((sum: number, g: any) => sum + (g.points_for || 0), 0) / last5.length 
        : 0,
      avg_points_against: last5.length > 0
        ? last5.reduce((sum: number, g: any) => sum + (g.points_against || 0), 0) / last5.length
        : 0,
    },
    last_10: {
      games: last10,
      wins: last10.filter((g: any) => g.result === 'W').length,
      losses: last10.filter((g: any) => g.result === 'L').length,
      avg_points_for: last10.length > 0
        ? last10.reduce((sum: number, g: any) => sum + (g.points_for || 0), 0) / last10.length
        : 0,
      avg_points_against: last10.length > 0
        ? last10.reduce((sum: number, g: any) => sum + (g.points_against || 0), 0) / last10.length
        : 0,
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
      WHERE pgs.team_id = $1
        AND g.status = 'Final'
        AND pgs.dnp_reason IS NULL
  `;
  const params: any[] = [teamId];
  let paramCount = 2;

  if (season) {
    sql += ` AND g.season = $${paramCount}`;
    params.push(season);
    paramCount++;
  }

  sql += `
      GROUP BY pgs.game_id
    )
    SELECT 
      tt.game_id,
      g.start_time,
      tt.points as points_for,
      CASE 
        WHEN g.home_team_id = $1 THEN g.away_score
        ELSE g.home_score
      END as points_against,
      tt.points - CASE 
        WHEN g.home_team_id = $1 THEN g.away_score
        ELSE g.home_score
      END as margin,
      CASE 
        WHEN tt.points > CASE WHEN g.home_team_id = $1 THEN g.away_score ELSE g.home_score END THEN 'W'
        ELSE 'L'
      END as result
    FROM team_totals tt
    JOIN games g ON tt.game_id = g.game_id
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
      avg_points_for: last5.length > 0 
        ? last5.reduce((sum: number, g: any) => sum + (g.points_for || 0), 0) / last5.length 
        : 0,
      avg_points_against: last5.length > 0
        ? last5.reduce((sum: number, g: any) => sum + (g.points_against || 0), 0) / last5.length
        : 0,
    },
    last_10: {
      games: last10,
      wins: last10.filter((g: any) => g.result === 'W').length,
      losses: last10.filter((g: any) => g.result === 'L').length,
      avg_points_for: last10.length > 0
        ? last10.reduce((sum: number, g: any) => sum + (g.points_for || 0), 0) / last10.length
        : 0,
      avg_points_against: last10.length > 0
        ? last10.reduce((sum: number, g: any) => sum + (g.points_against || 0), 0) / last10.length
        : 0,
    },
  };
}

// Get quarter strengths (Q1-Q4 PPG ranks)
async function getQuarterStrengths(teamId: string, season: string | null) {
  // Check if team_game_stats has quarter data
  const hasQuarterData = await query(`
    SELECT COUNT(*) as count 
    FROM team_game_stats 
    WHERE team_id = $1 
      AND (points_q1 IS NOT NULL OR points_q2 IS NOT NULL OR points_q3 IS NOT NULL OR points_q4 IS NOT NULL)
    LIMIT 1
  `, [teamId]);

  if ((hasQuarterData[0]?.count || 0) === 0) {
    // No quarter data available yet
    return {
      q1: { avg_ppg: null, rank: null },
      q2: { avg_ppg: null, rank: null },
      q3: { avg_ppg: null, rank: null },
      q4: { avg_ppg: null, rank: null },
    };
  }

  // Get all teams' quarter averages and rank them
  let sql = `
    WITH team_quarters AS (
      SELECT 
        tgs.team_id,
        AVG(tgs.points_q1) as q1_ppg,
        AVG(tgs.points_q2) as q2_ppg,
        AVG(tgs.points_q3) as q3_ppg,
        AVG(tgs.points_q4) as q4_ppg
      FROM team_game_stats tgs
      JOIN games g ON tgs.game_id = g.game_id
      WHERE g.status = 'Final'
        AND tgs.points_q1 IS NOT NULL
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
        q1_ppg,
        q2_ppg,
        q3_ppg,
        q4_ppg,
        RANK() OVER (ORDER BY q1_ppg DESC) as q1_rank,
        RANK() OVER (ORDER BY q2_ppg DESC) as q2_rank,
        RANK() OVER (ORDER BY q3_ppg DESC) as q3_rank,
        RANK() OVER (ORDER BY q4_ppg DESC) as q4_rank
      FROM team_quarters
    )
    SELECT 
      q1_ppg,
      q2_ppg,
      q3_ppg,
      q4_ppg,
      q1_rank,
      q2_rank,
      q3_rank,
      q4_rank
    FROM rankings
    WHERE team_id = $${paramCount}
  `;
  params.push(teamId);

  const result = await query(sql, params);
  const data = result[0] || {};

  return {
    q1: { avg_ppg: data.q1_ppg || null, rank: data.q1_rank || null },
    q2: { avg_ppg: data.q2_ppg || null, rank: data.q2_rank || null },
    q3: { avg_ppg: data.q3_ppg || null, rank: data.q3_rank || null },
    q4: { avg_ppg: data.q4_ppg || null, rank: data.q4_rank || null },
  };
}

