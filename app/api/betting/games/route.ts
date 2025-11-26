import { NextRequest, NextResponse } from 'next/server';
import { 
  getGamesForDate, 
  getTodaysGames,
  getRecentGames, 
  getAllTeamRatings,
  getTeamRecentForm 
} from '@/lib/betting/queries';

/**
 * GET /api/betting/games
 * 
 * Fetches games for the betting dashboard
 * Query params:
 *   - date: YYYY-MM-DD (optional, defaults to today's games)
 *   - mode: 'today' | 'recent' (optional, defaults to 'today')
 *   - limit: number (optional, defaults to 10 for recent mode)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get('date');
    const mode = searchParams.get('mode') || 'today';
    const limit = parseInt(searchParams.get('limit') || '10');

    let games;
    let displayDate: string;
    
    if (date) {
      // Specific date requested
      games = await getGamesForDate(date);
      displayDate = date;
    } else if (mode === 'recent') {
      // Recent completed games
      games = await getRecentGames(limit);
      displayDate = 'recent';
    } else {
      // Default: today's games
      games = await getTodaysGames();
      displayDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    }

    // Get team ratings for all teams
    const teamRatings = await getAllTeamRatings();

    // Get recent form for each team involved
    const teamIds = new Set<string>();
    games.forEach((game: any) => {
      teamIds.add(game.home_team_id);
      teamIds.add(game.away_team_id);
    });

    const recentFormPromises = Array.from(teamIds).map(async (teamId) => {
      const form = await getTeamRecentForm(teamId, 5);
      return { teamId, form };
    });
    
    const recentFormResults = await Promise.all(recentFormPromises);
    const recentFormMap: Record<string, any[]> = {};
    recentFormResults.forEach(({ teamId, form }) => {
      recentFormMap[teamId] = form;
    });

    // Enrich games with team stats
    const enrichedGames = games.map((game: any) => {
      const homeRatings = teamRatings[game.home_team_id] || {};
      const awayRatings = teamRatings[game.away_team_id] || {};
      const homeForm = recentFormMap[game.home_team_id] || [];
      const awayForm = recentFormMap[game.away_team_id] || [];

      return {
        id: game.game_id,
        gameDate: game.game_date,
        startTime: game.start_time,
        status: game.status,
        homeTeam: {
          id: game.home_team_id,
          name: game.home_team_name,
          abbreviation: game.home_team_abbr,
          record: `${homeRatings.wins || 0}-${homeRatings.losses || 0}`,
          offensiveRating: homeRatings.offensive_rating || 0,
          defensiveRating: homeRatings.defensive_rating || 0,
          pace: homeRatings.pace || 0,
          avgPoints: homeRatings.avg_points || 0,
          recentForm: homeForm,
        },
        awayTeam: {
          id: game.away_team_id,
          name: game.away_team_name,
          abbreviation: game.away_team_abbr,
          record: `${awayRatings.wins || 0}-${awayRatings.losses || 0}`,
          offensiveRating: awayRatings.offensive_rating || 0,
          defensiveRating: awayRatings.defensive_rating || 0,
          pace: awayRatings.pace || 0,
          avgPoints: awayRatings.avg_points || 0,
          recentForm: awayForm,
        },
        homeScore: game.home_score,
        awayScore: game.away_score,
        // Placeholder odds (will be populated from odds API later)
        odds: {
          home: {
            moneyline: 0,
            spread: 0,
            spreadOdds: -110,
          },
          away: {
            moneyline: 0,
            spread: 0,
            spreadOdds: -110,
          },
          overUnder: 0,
          overOdds: -110,
          underOdds: -110,
        },
      };
    });

    return NextResponse.json({
      games: enrichedGames,
      meta: {
        count: enrichedGames.length,
        date: displayDate,
        mode: mode,
        dataSource: 'bbref_schedule',
      },
    });
  } catch (error: any) {
    console.error('Error fetching betting games:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch games' },
      { status: 500 }
    );
  }
}

