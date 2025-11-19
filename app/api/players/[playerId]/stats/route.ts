import { NextRequest, NextResponse } from 'next/server';
import {
  getPlayerSeasonStats,
  getPlayerPaceAdjustedStats,
  getPlayerUsageRate,
  getPlayerRecentForm,
  getPlayerSplits,
} from '@/lib/players/queries';
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

    // Get all stats in parallel
    const [seasonStats, paceAdjusted, usageRate, recentForm, splits] = await Promise.all([
      getPlayerSeasonStats(playerId, season),
      getPlayerPaceAdjustedStats(playerId, season),
      getPlayerUsageRate(playerId, season),
      getPlayerRecentForm(playerId, season),
      getPlayerSplits(playerId, season),
    ]);

    return NextResponse.json({
      player,
      season: season || 'all',
      season_stats: seasonStats,
      pace_adjusted: paceAdjusted,
      usage_rate: usageRate,
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


