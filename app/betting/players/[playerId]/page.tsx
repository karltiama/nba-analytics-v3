import { PlayerHeader } from './components/PlayerHeader';
import { PlayerPageTabs } from './components/PlayerPageTabs';
import { PlayerPropSelectorSidebar } from '@/components/betting/PlayerPropSelectorSidebar';
import { PlayerAnalysisProvider } from './components/PlayerAnalysisContext';
import {
  resolveAnalyticsPlayerId,
  getAnalyticsPlayerInfo,
  getAnalyticsPlayerSeasonStats,
  getAnalyticsPlayerGames,
  getPlayerRecentForm,
  getPlayerVsOpponentHistory,
} from '@/lib/players/analytics-queries';
import { getNextGameForPlayer } from '@/lib/analytics/games-queries';
import { getOpponentContextForGame } from '@/lib/analytics/matchup-queries';
import { getAnalyticsSeason } from '@/lib/season';
import Link from 'next/link';
import { PlayerResearchReturnBar, playerReturnContextFromSearch } from './components/PlayerResearchReturnBar';
import type { GameLog, PlayerProfile, SeasonAverages } from '@/lib/players/types';
import type { OpponentContext } from '@/lib/analytics/matchup-queries';
import type { PlayerRecentForm, PlayerVsOpponentHistory } from '@/lib/players/types';
import { buildPreviewPlayerPage } from '@/lib/preview/player-page';
import { parsePreviewScenario } from '@/lib/preview/scenario';

async function loadPlayerAnalysis(playerId: string, season: string | null) {
  const analyticsPlayerId = await resolveAnalyticsPlayerId(playerId);
  if (!analyticsPlayerId) {
    return {
      analyticsPlayerId: null,
      player: null,
      seasonAverages: {},
      games: [],
      nextGame: null,
      opponentContext: null as OpponentContext | null,
      recentForm: null as PlayerRecentForm | null,
      vsOpponentHistory: null as PlayerVsOpponentHistory | null,
      activeSeason: season || getAnalyticsSeason(),
    };
  }
  const activeSeason = season || getAnalyticsSeason();
  const [player, seasonStats, gamesData, nextGame, recentForm] = await Promise.all([
    getAnalyticsPlayerInfo(analyticsPlayerId),
    getAnalyticsPlayerSeasonStats(analyticsPlayerId, activeSeason),
    getAnalyticsPlayerGames(analyticsPlayerId, activeSeason, 82),
    getNextGameForPlayer(analyticsPlayerId),
    getPlayerRecentForm(analyticsPlayerId, 5, activeSeason),
  ]);

  let opponentContext: OpponentContext | null = null;
  let vsOpponentHistory: PlayerVsOpponentHistory | null = null;
  if (nextGame) {
    [opponentContext, vsOpponentHistory] = await Promise.all([
      getOpponentContextForGame(nextGame.opponent_team_id, nextGame.season),
      getPlayerVsOpponentHistory(analyticsPlayerId, nextGame.opponent_team_id, nextGame.season),
    ]);
  }

  return {
    analyticsPlayerId,
    player: player as PlayerProfile | null,
    seasonAverages: seasonStats as SeasonAverages,
    games: (gamesData.games ?? []) as GameLog[],
    nextGame,
    opponentContext,
    recentForm,
    vsOpponentHistory,
    activeSeason,
  };
}

export default async function BettingPlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<{
    season?: string;
    from?: string;
    date?: string;
    game_id?: string;
    prop_type?: string;
    side?: string;
    sportsbook?: string;
    line?: string;
    preview?: string | string[];
  }>;
}) {
  const { playerId } = await params;
  const sp = await searchParams;
  const { season } = sp;
  const returnCtx = playerReturnContextFromSearch(sp);
  const previewFlag = Array.isArray(sp.preview) ? sp.preview[0] : sp.preview;
  const scenario = parsePreviewScenario(previewFlag);
  const { analyticsPlayerId, player, seasonAverages, games, nextGame, opponentContext, recentForm, vsOpponentHistory, activeSeason } =
    scenario
      ? buildPreviewPlayerPage(playerId, scenario)
      : await loadPlayerAnalysis(playerId, season || null);

  if (!player) {
    return (
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-12">
        <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm border-l-4 border-l-red-500 p-8 text-center">
          <h1 className="text-2xl font-bold text-[#063f46] mb-3">Player not found</h1>
          <p className="text-[#4a6366] mb-4">The requested player could not be located.</p>
          <Link href="/betting" className="text-[#075B5C] hover:underline text-sm">
            &larr; Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Current team from most recent game (games are ordered by date DESC)
  const currentTeam =
    games.length > 0 && games[0]
      ? {
          team_id: games[0].team_id,
          abbreviation: games[0].team_abbr,
          full_name: games[0].team_name,
        }
      : null;

  return (
    <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
      <PlayerAnalysisProvider>
        <div className="flex flex-col xl:flex-row gap-6">
          <div className="flex-1 min-w-0 space-y-6">
            <PlayerResearchReturnBar ctx={returnCtx} />
            <PlayerHeader
              player={player}
              seasonAverages={seasonAverages}
              team={currentTeam}
              seasonLabel={activeSeason}
            />
            {!(seasonAverages?.games_played || seasonAverages?.games_active) && (
              <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm px-4 py-3 text-sm text-[#4a6366]">
                No {activeSeason} season stats yet. Prior-season numbers are not shown here.
              </div>
            )}
            <PlayerPageTabs
              games={games}
              seasonAverages={seasonAverages}
              nextGame={nextGame}
              opponentContext={opponentContext}
              recentForm={recentForm}
              vsOpponentHistory={vsOpponentHistory}
            />
          </div>
          <aside className="w-full xl:w-80 shrink-0">
            <div className="xl:sticky xl:top-20">
              <PlayerPropSelectorSidebar
                key={analyticsPlayerId ?? playerId}
                playerId={analyticsPlayerId ?? playerId}
                playerName={player.full_name}
                gameId={nextGame ? parseInt(nextGame.game_id, 10) : undefined}
                defaultLineValue={seasonAverages?.avg_points ?? undefined}
              />
            </div>
          </aside>
        </div>
      </PlayerAnalysisProvider>
    </main>
  );
}
