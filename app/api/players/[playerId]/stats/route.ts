import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * Player Detail Stats API
 * 
 * Returns:
 * - Player info
 * - Season totals and averages
 * - Recent form (L5, L10)
 * - Home/Away splits
 * 
 * Usage:
 *   GET /api/players/[playerId]/stats?season=2025
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ playerId: string }> }
) {
  try {
    const { playerId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const season = searchParams.get('season') || null;

    // Get player info
    const playerResult = await query(
      `SELECT player_id, full_name, first_name, last_name, position, height, weight, dob, active
       FROM players WHERE player_id = $1`,
      [playerId]
    );

    if (playerResult.length === 0) {
      return NextResponse.json(
        { error: 'Player not found' },
        { status: 404 }
      );
    }

    const player = playerResult[0];

    // Get season stats
    const seasonStats = await getSeasonStats(playerId, season);

    // Get recent form (L5, L10)
    const recentForm = await getRecentForm(playerId, season);

    // Get home/away splits
    const splits = await getSplits(playerId, season);

    return NextResponse.json({
      player,
      season: season || 'all',
      season_stats: seasonStats,
      recent_form: recentForm,
      splits,
    });
  } catch (error: any) {
    console.error('Error fetching player stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch player stats', message: error.message },
      { status: 500 }
    );
  }
}

async function getSeasonStats(playerId: string, season: string | null) {
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

async function getRecentForm(playerId: string, season: string | null) {
  // Last 5 games
  let sqlL5 = `
    SELECT 
      AVG(pgs.points) as avg_points,
      AVG(pgs.rebounds) as avg_rebounds,
      AVG(pgs.assists) as avg_assists,
      AVG(pgs.field_goals_made::numeric / NULLIF(pgs.field_goals_attempted, 0)) * 100 as fg_pct,
      AVG(pgs.minutes) as avg_minutes
    FROM player_game_stats pgs
    JOIN games g ON pgs.game_id = g.game_id
    WHERE pgs.player_id = $1
      AND g.status = 'Final'
      AND pgs.dnp_reason IS NULL
  `;

  const params: any[] = [playerId];
  let paramCount = 2;

  if (season) {
    sqlL5 += ` AND g.season = $${paramCount}`;
    params.push(season);
    paramCount++;
  }

  sqlL5 += ` ORDER BY g.start_time DESC LIMIT 5`;

  const l5Result = await query(sqlL5, params);

  // Last 10 games
  let sqlL10 = sqlL5.replace('LIMIT 5', 'LIMIT 10');
  const l10Result = await query(sqlL10, params);

  return {
    last_5: l5Result[0] || {},
    last_10: l10Result[0] || {},
  };
}

async function getSplits(playerId: string, season: string | null) {
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

