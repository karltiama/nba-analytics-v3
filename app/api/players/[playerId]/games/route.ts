import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * Player Game Logs API
 * 
 * Returns list of games with player stats
 * 
 * Query params:
 *   - season: Filter by season (e.g., "2025")
 *   - limit: Number of games to return (default: 50)
 *   - offset: Pagination offset (default: 0)
 *   - opponent: Filter by opponent team_id
 * 
 * Usage:
 *   GET /api/players/[playerId]/games?season=2025&limit=20
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ playerId: string }> }
) {
  try {
    const { playerId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const season = searchParams.get('season') || null;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const opponentId = searchParams.get('opponent') || null;

    let sql = `
      SELECT 
        g.game_id,
        g.start_time,
        g.status,
        g.season,
        -- Player's team
        pgs.team_id as team_id,
        t_team.abbreviation as team_abbr,
        t_team.full_name as team_name,
        -- Opponent team
        CASE 
          WHEN g.home_team_id = pgs.team_id THEN g.away_team_id
          ELSE g.home_team_id
        END as opponent_id,
        CASE 
          WHEN g.home_team_id = pgs.team_id THEN t_away.abbreviation
          ELSE t_home.abbreviation
        END as opponent_abbr,
        CASE 
          WHEN g.home_team_id = pgs.team_id THEN t_away.full_name
          ELSE t_home.full_name
        END as opponent_name,
        CASE 
          WHEN g.home_team_id = pgs.team_id THEN 'home'
          ELSE 'away'
        END as location,
        -- Game result
        CASE 
          WHEN g.home_team_id = pgs.team_id THEN g.home_score
          ELSE g.away_score
        END as team_score,
        CASE 
          WHEN g.home_team_id = pgs.team_id THEN g.away_score
          ELSE g.home_score
        END as opponent_score,
        CASE 
          WHEN g.status != 'Final' THEN NULL
          WHEN g.home_team_id = pgs.team_id AND g.home_score > g.away_score THEN 'W'
          WHEN g.home_team_id = pgs.team_id AND g.home_score < g.away_score THEN 'L'
          WHEN g.away_team_id = pgs.team_id AND g.away_score > g.home_score THEN 'W'
          WHEN g.away_team_id = pgs.team_id AND g.away_score < g.home_score THEN 'L'
          ELSE NULL
        END as result,
        -- Player stats
        pgs.minutes,
        pgs.points,
        pgs.rebounds,
        pgs.assists,
        pgs.steals,
        pgs.blocks,
        pgs.turnovers,
        pgs.field_goals_made,
        pgs.field_goals_attempted,
        pgs.three_pointers_made,
        pgs.three_pointers_attempted,
        pgs.free_throws_made,
        pgs.free_throws_attempted,
        pgs.plus_minus,
        pgs.started,
        pgs.dnp_reason
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.game_id
      JOIN teams t_team ON pgs.team_id = t_team.team_id
      JOIN teams t_home ON g.home_team_id = t_home.team_id
      JOIN teams t_away ON g.away_team_id = t_away.team_id
      WHERE pgs.player_id = $1
    `;

  const params: any[] = [playerId];
  let paramCount = 2;

  if (season) {
    sql += ` AND g.season = $${paramCount}`;
    params.push(season);
    paramCount++;
  }

  if (opponentId) {
    sql += ` AND (
      (g.home_team_id = $${paramCount} AND g.away_team_id = pgs.team_id) OR
      (g.away_team_id = $${paramCount} AND g.home_team_id = pgs.team_id)
    )`;
    params.push(opponentId);
    paramCount++;
  }

  sql += ` ORDER BY g.start_time DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
  params.push(limit, offset);

  const games = await query(sql, params);

  // Get total count for pagination
  let countSql = `
    SELECT COUNT(*) as total
    FROM player_game_stats pgs
    JOIN games g ON pgs.game_id = g.game_id
    WHERE pgs.player_id = $1
  `;
  const countParams: any[] = [playerId];
  let countParamCount = 2;

  if (season) {
    countSql += ` AND g.season = $${countParamCount}`;
    countParams.push(season);
    countParamCount++;
  }

  if (opponentId) {
    countSql += ` AND (
      (g.home_team_id = $${countParamCount} AND g.away_team_id = pgs.team_id) OR
      (g.away_team_id = $${countParamCount} AND g.home_team_id = pgs.team_id)
    )`;
    countParams.push(opponentId);
    countParamCount++;
  }

  const countResult = await query(countSql, countParams);
  const total = parseInt(countResult[0]?.total || '0', 10);

  return NextResponse.json({
    games,
    pagination: {
      total,
      limit,
      offset,
      has_more: offset + limit < total,
    },
  });
} catch (error: any) {
    console.error('Error fetching player games:', error);
    return NextResponse.json(
      { error: 'Failed to fetch player games', message: error.message },
      { status: 500 }
    );
  }
}

