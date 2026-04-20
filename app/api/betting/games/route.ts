import { NextRequest, NextResponse } from 'next/server';
import {
  getGamesForDate,
  getTodaysGames,
  getRecentGames,
  getAllTeamRatings,
  getTeamRecentForm,
  getGamesOdds,
  getTeamDefensiveRankings,
} from '@/lib/betting/queries';
import {
  getTodayEtYmd,
  refreshBdlScheduleForEtDateRange,
} from '@/lib/balldontlie/refresh-schedule-from-bdl';

export const dynamic = 'force-dynamic';

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

    const todayEt = getTodayEtYmd();
    const liveRefreshEnabled = process.env.DISABLE_BDL_LIVE_SCHEDULE_REFRESH !== '1';

    async function maybeRefreshScheduleForEtDay(ymd: string) {
      if (!liveRefreshEnabled || ymd !== todayEt) return;
      try {
        await refreshBdlScheduleForEtDateRange(ymd, ymd);
      } catch (e) {
        console.error('[api/betting/games] Live BDL schedule refresh failed:', e);
      }
    }

    let games;
    let displayDate: string;

    if (date) {
      await maybeRefreshScheduleForEtDay(date);
      games = await getGamesForDate(date);
      displayDate = date;
    } else if (mode === 'recent') {
      games = await getRecentGames(limit);
      displayDate = 'recent';
    } else {
      await maybeRefreshScheduleForEtDay(todayEt);
      games = await getTodaysGames();
      displayDate = todayEt;
    }

    // Get team ratings and defensive rankings for all teams
    const [teamRatings, defRankings] = await Promise.all([
      getAllTeamRatings(),
      getTeamDefensiveRankings(),
    ]);

    const defRankMap: Record<string, number> = {};
    defRankings.forEach((r) => { defRankMap[r.team_id] = r.defensive_rank; });

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

    // Get odds for all games (defaults to DraftKings, falls back to any available bookmaker)
    // Use game_id (canonical_game_id or bbref_game_id) for odds lookup
    const gameIds = games.map((g: any) => g.game_id);
    const oddsMap = await getGamesOdds(gameIds, 'draftkings'); // Default bookmaker: DraftKings

    // Enrich games with team stats and odds
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
          defensiveRank: defRankMap[game.home_team_id] || 0,
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
          defensiveRank: defRankMap[game.away_team_id] || 0,
          pace: awayRatings.pace || 0,
          avgPoints: awayRatings.avg_points || 0,
          recentForm: awayForm,
        },
        homeScore: game.home_score,
        awayScore: game.away_score,
        // Odds from analytics.game_odds_current (matched by BDL game_id)
        odds: (() => {
          const gameOdds = oddsMap[game.game_id] || {
            home: { moneyline: null, spread: null, spreadOdds: null },
            away: { moneyline: null, spread: null, spreadOdds: null },
            overUnder: null,
            overOdds: null,
            underOdds: null,
            bookmaker: null,
          };

          // Return with fallback values if odds are missing
          return {
            home: {
              moneyline: gameOdds.home.moneyline ?? 0,
              spread: gameOdds.home.spread ?? 0,
              spreadOdds: gameOdds.home.spreadOdds ?? -110,
            },
            away: {
              moneyline: gameOdds.away.moneyline ?? 0,
              spread: gameOdds.away.spread ?? 0,
              spreadOdds: gameOdds.away.spreadOdds ?? -110,
            },
            overUnder: gameOdds.overUnder ?? 0,
            overOdds: gameOdds.overOdds ?? -110,
            underOdds: gameOdds.underOdds ?? -110,
            bookmaker: gameOdds.bookmaker, // Include bookmaker for reference
          };
        })(),
      };
    });

    enrichedGames.sort((a: any, b: any) => {
      const aFinal = a.status === 'Final' ? 1 : 0;
      const bFinal = b.status === 'Final' ? 1 : 0;
      if (aFinal !== bFinal) return aFinal - bFinal;
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    });

    return NextResponse.json({
      games: enrichedGames,
      meta: {
        count: enrichedGames.length,
        date: displayDate,
        mode: mode,
        dataSource: 'analytics.games',
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

