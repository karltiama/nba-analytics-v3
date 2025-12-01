import { NextResponse } from 'next/server';
import { 
  getTeamPaceRankings, 
  getTeamDefensiveRankings,
  getDashboardSummary,
  getTrendingPlayers 
} from '@/lib/betting/queries';

/**
 * GET /api/betting/insights
 * 
 * Fetches AI-style insights for the betting dashboard
 * Based on real BBRef data analysis
 */
export async function GET() {
  try {
    // Fetch all necessary data in parallel
    const [paceRankings, defenseRankings, summary, trendingPlayers] = await Promise.all([
      getTeamPaceRankings(),
      getTeamDefensiveRankings(),
      getDashboardSummary(),
      getTrendingPlayers(5),
    ]);

    const insights = [];

    // Pace insight - fastest team
    if (paceRankings.length > 0) {
      const fastestTeam = paceRankings[0];
      insights.push({
        id: 'pace-1',
        type: 'pace',
        title: 'Highest Pace Team',
        description: `${fastestTeam.team_abbr} leads the league in pace at ${fastestTeam.pace.toFixed(1)} possessions per game. Games involving them tend to have higher totals.`,
        timestamp: 'Based on season data',
        importance: 'medium',
      });
    }

    // Defense insight - best defensive team
    if (defenseRankings.length > 0) {
      const bestDefense = defenseRankings[0];
      insights.push({
        id: 'defense-1',
        type: 'defense',
        title: 'Elite Defense Alert',
        description: `${bestDefense.team_abbr} has the best defensive rating (${bestDefense.defensive_rating.toFixed(1)}), allowing only ${bestDefense.points_allowed.toFixed(1)} PPG. Consider unders in their matchups.`,
        timestamp: 'Based on season data',
        importance: 'high',
      });
    }

    // Trending player insights
    trendingPlayers.slice(0, 3).forEach((player, index) => {
      const direction = player.trend_direction === 'up' ? 'above' : 'below';
      insights.push({
        id: `trend-${index}`,
        type: 'trend',
        title: `${player.full_name} Trending ${player.trend_direction === 'up' ? 'Up' : 'Down'}`,
        description: `${player.full_name} is ${Math.abs(player.points_trend_pct).toFixed(0)}% ${direction} their season average in the last 5 games (${player.l5_avg_points.toFixed(1)} vs ${player.season_avg_points.toFixed(1)} PPG).`,
        timestamp: 'Last 5 games',
        importance: Math.abs(player.points_trend_pct) > 15 ? 'high' : 'medium',
      });
    });

    // Pace mismatch insight
    if (paceRankings.length >= 2) {
      const fastest = paceRankings[0];
      const slowest = paceRankings[paceRankings.length - 1];
      const paceDiff = fastest.pace - slowest.pace;
      
      if (paceDiff > 3) {
        insights.push({
          id: 'pace-mismatch',
          type: 'pace',
          title: 'Pace Mismatch Available',
          description: `${fastest.team_abbr} (${fastest.pace.toFixed(1)}) vs ${slowest.team_abbr} (${slowest.pace.toFixed(1)}) would create a ${paceDiff.toFixed(1)} pace differential matchup.`,
          timestamp: 'Season analysis',
          importance: 'medium',
        });
      }
    }

    // Data freshness insight
    if (summary.latest_game_date) {
      const latestDate = new Date(summary.latest_game_date);
      const today = new Date();
      const daysDiff = Math.floor((today.getTime() - latestDate.getTime()) / (1000 * 60 * 60 * 24));
      
      insights.push({
        id: 'data-freshness',
        type: 'general',
        title: 'Data Status',
        description: `Stats updated through ${latestDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. ${summary.total_games} games analyzed across ${summary.teams_with_stats} teams.`,
        timestamp: `${daysDiff} day(s) ago`,
        importance: 'low',
      });
    }

    // Generate widgets data
    const widgets = [
      {
        id: 'w-1',
        title: 'Games Analyzed',
        value: summary.total_games?.toString() || '0',
        description: 'Total games with full stats in database',
        type: 'general',
      },
      {
        id: 'w-2',
        title: 'Fastest Pace',
        value: paceRankings[0]?.team_abbr || 'N/A',
        description: `${paceRankings[0]?.pace.toFixed(1) || 0} possessions/game`,
        type: 'pace',
      },
      {
        id: 'w-3',
        title: 'Best Defense',
        value: defenseRankings[0]?.team_abbr || 'N/A',
        description: `${defenseRankings[0]?.defensive_rating.toFixed(1) || 0} DRTG`,
        type: 'defense',
      },
      {
        id: 'w-4',
        title: 'Hot Player',
        value: trendingPlayers[0]?.full_name.split(' ').pop() || 'N/A',
        description: trendingPlayers[0] 
          ? `+${Math.abs(trendingPlayers[0].points_trend_pct).toFixed(0)}% trend` 
          : 'No data',
        type: 'props',
        change: trendingPlayers[0] ? `${trendingPlayers[0].trend_direction === 'up' ? '+' : ''}${trendingPlayers[0].points_trend_pct.toFixed(0)}%` : undefined,
        changeDirection: trendingPlayers[0]?.trend_direction,
      },
      {
        id: 'w-5',
        title: 'Players Tracked',
        value: summary.total_players?.toString() || '0',
        description: 'Active players with game logs',
        type: 'general',
      },
    ];

    return NextResponse.json({
      insights,
      widgets,
      meta: {
        dataSource: 'bbref',
        gamesAnalyzed: summary.total_games,
        lastUpdate: summary.latest_game_date,
      },
    });
  } catch (error: any) {
    console.error('Error fetching betting insights:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch insights' },
      { status: 500 }
    );
  }
}












