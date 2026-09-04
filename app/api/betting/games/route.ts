import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
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
import {
  buildEnrichedTeamSide,
  enrichGameStatus,
  toNullableGameOdds,
} from '@/lib/betting/enrich-games-response';
import { isFinalStatus } from '@/lib/betting/normalize-game-status';

export const dynamic = 'force-dynamic';

/**
 * GET /api/betting/games
 *
 * Fetches games for the betting dashboard
 * Auth required (private betting API). Public landing uses static demo cards
 * in `components/landing/FeaturedGames.tsx` — do not call this unauthenticated.
 * Query params:
 *   - date: YYYY-MM-DD (optional, defaults to today's games)
 *   - mode: 'today' | 'recent' (optional, defaults to 'today')
 *   - limit: number (optional, defaults to 10 for recent mode)
 *
 * Odds and season analytics fields are nullable — missing markets/ratings are null,
 * never fabricated 0 / -110.
 */
export async function GET(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;

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

    const [teamRatings, defRankings] = await Promise.all([
      getAllTeamRatings(),
      getTeamDefensiveRankings(),
    ]);

    const defRankMap: Record<string, number> = {};
    defRankings.forEach((r) => {
      defRankMap[r.team_id] = r.defensive_rank;
    });

    const teamIds = new Set<string>();
    games.forEach((game: { home_team_id: string; away_team_id: string }) => {
      teamIds.add(game.home_team_id);
      teamIds.add(game.away_team_id);
    });

    const recentFormResults = await Promise.all(
      Array.from(teamIds).map(async (teamId) => {
        const form = await getTeamRecentForm(teamId, 5);
        return { teamId, form };
      })
    );
    const recentFormMap: Record<string, unknown[]> = {};
    recentFormResults.forEach(({ teamId, form }) => {
      recentFormMap[teamId] = form;
    });

    const gameIds = games.map((g: { game_id: string }) => g.game_id);
    const oddsMap = await getGamesOdds(gameIds, 'draftkings');

    const enrichedGames = games.map((game: Record<string, unknown>) => {
      const homeRatings = teamRatings[String(game.home_team_id)];
      const awayRatings = teamRatings[String(game.away_team_id)];
      const homeForm = recentFormMap[String(game.home_team_id)] || [];
      const awayForm = recentFormMap[String(game.away_team_id)] || [];
      const { status, statusRaw } = enrichGameStatus(
        game.status == null ? null : String(game.status)
      );

      return {
        id: game.game_id,
        gameDate: game.game_date,
        startTime: game.start_time,
        status,
        statusRaw,
        homeTeam: buildEnrichedTeamSide({
          id: String(game.home_team_id),
          name: String(game.home_team_name),
          abbreviation: String(game.home_team_abbr),
          ratings: homeRatings,
          defensiveRank: defRankMap[String(game.home_team_id)],
          recentForm: homeForm,
        }),
        awayTeam: buildEnrichedTeamSide({
          id: String(game.away_team_id),
          name: String(game.away_team_name),
          abbreviation: String(game.away_team_abbr),
          ratings: awayRatings,
          defensiveRank: defRankMap[String(game.away_team_id)],
          recentForm: awayForm,
        }),
        homeScore: game.home_score ?? null,
        awayScore: game.away_score ?? null,
        odds: toNullableGameOdds(oddsMap[String(game.game_id)]),
      };
    });

    enrichedGames.sort((a, b) => {
      const aFinal = isFinalStatus(a.status) ? 1 : 0;
      const bFinal = isFinalStatus(b.status) ? 1 : 0;
      if (aFinal !== bFinal) return aFinal - bFinal;
      return new Date(String(a.startTime)).getTime() - new Date(String(b.startTime)).getTime();
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
  } catch (error: unknown) {
    console.error('Error fetching betting games:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch games';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
