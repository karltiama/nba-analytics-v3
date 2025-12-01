import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getTeamInfo } from '@/lib/teams/queries';

/**
 * GET /api/teams/[teamId]/insights
 * 
 * Fetches AI-style insights for a specific team
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId } = await params;
    const team = await getTeamInfo(teamId);

    if (!team) {
      return NextResponse.json(
        { error: 'Team not found' },
        { status: 404 }
      );
    }

    // Get team stats for insights from BBRef tables
    const teamStats = await query(`
      SELECT 
        COUNT(DISTINCT btgs.game_id) as games_played,
        AVG(btgs.points) as avg_points_for,
        AVG(CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END) as avg_points_against,
        AVG(btgs.field_goals_made::numeric / NULLIF(btgs.field_goals_attempted, 0)) * 100 as fg_pct,
        AVG(btgs.three_pointers_made::numeric / NULLIF(btgs.three_pointers_attempted, 0)) * 100 as three_pct
      FROM bbref_team_game_stats btgs
      JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
      WHERE btgs.team_id = $1 AND bg.status = 'Final' AND btgs.source = 'bbref'
    `, [teamId]);

    const stats = teamStats[0] || {};

    // Get recent form (last 5 games) from BBRef tables
    const recentGames = await query(`
      SELECT 
        btgs.game_id,
        COALESCE(bg.start_time, bg.game_date::timestamptz) as start_time,
        btgs.points as points_for,
        CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END as points_against,
        CASE WHEN btgs.points > CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END THEN 'W' ELSE 'L' END as result,
        CASE WHEN btgs.is_home THEN away_team.abbreviation ELSE home_team.abbreviation END as opponent_abbr
      FROM bbref_team_game_stats btgs
      JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
      JOIN teams home_team ON bg.home_team_id = home_team.team_id
      JOIN teams away_team ON bg.away_team_id = away_team.team_id
      WHERE btgs.team_id = $1 AND bg.status = 'Final' AND btgs.source = 'bbref'
      ORDER BY COALESCE(bg.start_time, bg.game_date) DESC
      LIMIT 5
    `, [teamId]);

    const last5Wins = recentGames.filter((g: any) => g.result === 'W').length;
    const last5Losses = recentGames.filter((g: any) => g.result === 'L').length;
    const last5Record = `${last5Wins}-${last5Losses}`;

    // Get league rankings for context from BBRef tables
    const offensiveRank = await query(`
      WITH team_offensive_avg AS (
        SELECT 
          btgs.team_id,
          AVG(btgs.points) as points_for
        FROM bbref_team_game_stats btgs
        JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
        WHERE bg.status = 'Final' AND btgs.source = 'bbref'
        GROUP BY btgs.team_id
      )
      SELECT 
        RANK() OVER (ORDER BY points_for DESC) as offensive_rank
      FROM team_offensive_avg
      WHERE team_id = $1
    `, [teamId]);

    const defensiveRank = await query(`
      WITH team_defensive AS (
        SELECT 
          btgs.team_id,
          AVG(CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END) as points_against
        FROM bbref_team_game_stats btgs
        JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
        WHERE bg.status = 'Final' AND btgs.source = 'bbref'
        GROUP BY btgs.team_id
      )
      SELECT 
        RANK() OVER (ORDER BY points_against ASC) as defensive_rank
      FROM team_defensive
      WHERE team_id = $1
    `, [teamId]);

    const offRank = offensiveRank[0]?.offensive_rank || null;
    const defRank = defensiveRank[0]?.defensive_rank || null;

    // Generate insights
    const insights = [];

    // Recent form insight
    if (recentGames.length > 0) {
      const winPct = (last5Wins / recentGames.length) * 100;
      if (winPct >= 80) {
        insights.push({
          id: 'recent-form-hot',
          type: 'trend' as const,
          title: 'Hot Streak',
          description: `${team.abbreviation} is ${last5Record} in their last 5 games, winning ${winPct.toFixed(0)}% of recent contests.`,
          timestamp: 'Last 5 games',
          importance: 'high' as const,
        });
      } else if (winPct <= 20) {
        insights.push({
          id: 'recent-form-cold',
          type: 'trend' as const,
          title: 'Cold Streak',
          description: `${team.abbreviation} is ${last5Record} in their last 5 games. Consider fading in recent matchups.`,
          timestamp: 'Last 5 games',
          importance: 'high' as const,
        });
      }
    }

    // Offensive ranking insight
    if (offRank !== null) {
      if (offRank <= 5) {
        insights.push({
          id: 'offensive-rank',
          type: 'trend' as const,
          title: 'Elite Offense',
          description: `${team.abbreviation} ranks ${offRank} in offensive rating. Their games tend to hit overs more frequently.`,
          timestamp: 'Season ranking',
          importance: 'high' as const,
        });
      } else if (offRank >= 25) {
        insights.push({
          id: 'offensive-rank-low',
          type: 'trend' as const,
          title: 'Struggling Offense',
          description: `${team.abbreviation} ranks ${offRank} in offensive rating. Consider unders in their matchups.`,
          timestamp: 'Season ranking',
          importance: 'medium' as const,
        });
      }
    }

    // Defensive ranking insight
    if (defRank !== null) {
      if (defRank <= 5) {
        insights.push({
          id: 'defensive-rank',
          type: 'defense' as const,
          title: 'Elite Defense',
          description: `${team.abbreviation} ranks ${defRank} in defensive rating, allowing only ${stats.avg_points_against ? Number(stats.avg_points_against).toFixed(1) : 'N/A'} PPG.`,
          timestamp: 'Season ranking',
          importance: 'high' as const,
        });
      }
    }

    // Shooting efficiency insight
    if (stats.fg_pct && stats.three_pct) {
      const fgPct = Number(stats.fg_pct);
      const threePct = Number(stats.three_pct);
      
      if (fgPct >= 48 && threePct >= 38) {
        insights.push({
          id: 'shooting-efficiency',
          type: 'trend' as const,
          title: 'Efficient Shooting',
          description: `${team.abbreviation} shoots ${fgPct.toFixed(1)}% FG and ${threePct.toFixed(1)}% from three. High-quality offense.`,
          timestamp: 'Season averages',
          importance: 'medium' as const,
        });
      }
    }

    // Scoring differential insight
    if (stats.avg_points_for && stats.avg_points_against) {
      const diff = Number(stats.avg_points_for) - Number(stats.avg_points_against);
      if (diff > 5) {
        insights.push({
          id: 'scoring-differential',
          type: 'general' as const,
          title: 'Positive Differential',
          description: `${team.abbreviation} has a +${diff.toFixed(1)} point differential, indicating strong overall play.`,
          timestamp: 'Season average',
          importance: 'medium' as const,
        });
      } else if (diff < -5) {
        insights.push({
          id: 'scoring-differential-negative',
          type: 'general' as const,
          title: 'Negative Differential',
          description: `${team.abbreviation} has a ${diff.toFixed(1)} point differential. Struggling to outscore opponents.`,
          timestamp: 'Season average',
          importance: 'medium' as const,
        });
      }
    }

    // Default insight if none generated
    if (insights.length === 0) {
      insights.push({
        id: 'general-info',
        type: 'general' as const,
        title: 'Team Overview',
        description: `${team.abbreviation} has played ${stats.games_played || 0} games this season.`,
        timestamp: 'Season data',
        importance: 'low' as const,
      });
    }

    return NextResponse.json({
      insights,
      meta: {
        teamId,
        teamAbbr: team.abbreviation,
        gamesPlayed: stats.games_played || 0,
      },
    });
  } catch (error: any) {
    console.error('Error fetching team insights:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch insights' },
      { status: 500 }
    );
  }
}

