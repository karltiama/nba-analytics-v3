import { NextRequest, NextResponse } from 'next/server';
import { getTrendingPlayers } from '@/lib/betting/queries';

/**
 * GET /api/betting/players/trending
 * 
 * Fetches trending players for the betting dashboard
 * Players performing significantly above/below their season average
 * 
 * Query params:
 *   - limit: number (optional, defaults to 10)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '10');

    const trendingPlayers = await getTrendingPlayers(limit);

    // Transform to match the PlayerCard component format
    const players = trendingPlayers.map((player) => {
      // Generate prop suggestions based on trends
      const props = [];
      
      // Points prop
      if (Math.abs(player.points_trend_pct) >= 5) {
        props.push({
          type: 'points',
          line: Math.round(player.season_avg_points * 2) / 2, // Round to nearest 0.5
          trend: player.l5_avg_points > player.season_avg_points ? 'over' : 'under',
          confidence: Math.min(85, 50 + Math.abs(player.points_trend_pct)),
          recentAvg: player.l5_avg_points,
          seasonAvg: player.season_avg_points,
        });
      }

      // Rebounds prop for players averaging 5+ rebounds
      if (player.season_avg_rebounds >= 5) {
        const rebTrend = ((player.l5_avg_rebounds - player.season_avg_rebounds) / player.season_avg_rebounds) * 100;
        if (Math.abs(rebTrend) >= 5) {
          props.push({
            type: 'rebounds',
            line: Math.round(player.season_avg_rebounds * 2) / 2,
            trend: player.l5_avg_rebounds > player.season_avg_rebounds ? 'over' : 'under',
            confidence: Math.min(80, 50 + Math.abs(rebTrend)),
            recentAvg: player.l5_avg_rebounds,
            seasonAvg: player.season_avg_rebounds,
          });
        }
      }

      // Assists prop for players averaging 4+ assists
      if (player.season_avg_assists >= 4) {
        const astTrend = ((player.l5_avg_assists - player.season_avg_assists) / player.season_avg_assists) * 100;
        if (Math.abs(astTrend) >= 5) {
          props.push({
            type: 'assists',
            line: Math.round(player.season_avg_assists * 2) / 2,
            trend: player.l5_avg_assists > player.season_avg_assists ? 'over' : 'under',
            confidence: Math.min(80, 50 + Math.abs(astTrend)),
            recentAvg: player.l5_avg_assists,
            seasonAvg: player.season_avg_assists,
          });
        }
      }

      // Ensure at least one prop
      if (props.length === 0) {
        props.push({
          type: 'points',
          line: Math.round(player.season_avg_points * 2) / 2,
          trend: player.l5_avg_points >= player.season_avg_points ? 'over' : 'under',
          confidence: 55,
          recentAvg: player.l5_avg_points,
          seasonAvg: player.season_avg_points,
        });
      }

      // Generate "why this player" text
      const trendDir = player.trend_direction === 'up' ? 'above' : 'below';
      const whyText = `${player.full_name} is trending ${Math.abs(player.points_trend_pct).toFixed(0)}% ${trendDir} their season average in the last 5 games. Season avg: ${player.season_avg_points.toFixed(1)} PPG, L5 avg: ${player.l5_avg_points.toFixed(1)} PPG.`;

      return {
        id: player.player_id,
        name: player.full_name,
        team: player.team_abbr,
        teamAbbreviation: player.team_abbr,
        position: player.position,
        opponent: 'TBD', // Will be populated when we have scheduled games
        opponentAbbreviation: 'TBD',
        props,
        recentPoints: player.recent_points,
        recentRebounds: player.recent_rebounds,
        recentAssists: player.recent_assists,
        whyText,
        trendPercentage: Math.abs(player.points_trend_pct),
        trendDirection: player.trend_direction,
        // Additional stats for display
        seasonStats: {
          points: player.season_avg_points,
          rebounds: player.season_avg_rebounds,
          assists: player.season_avg_assists,
          gamesPlayed: player.games_played,
        },
        l5Stats: {
          points: player.l5_avg_points,
          rebounds: player.l5_avg_rebounds,
          assists: player.l5_avg_assists,
        },
      };
    });

    return NextResponse.json({
      players,
      meta: {
        count: players.length,
        dataSource: 'bbref',
        description: 'Players with significant performance trends (L5 vs Season)',
      },
    });
  } catch (error: any) {
    console.error('Error fetching trending players:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch trending players' },
      { status: 500 }
    );
  }
}




