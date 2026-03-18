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
import Link from 'next/link';
import { Zap } from 'lucide-react';
import type { GameLog, PlayerProfile, SeasonAverages } from '@/lib/players/types';
import type { OpponentContext } from '@/lib/analytics/matchup-queries';
import type { PlayerRecentForm, PlayerVsOpponentHistory } from '@/lib/players/types';

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
    };
  }
  const [player, seasonStats, gamesData, nextGame, recentForm] = await Promise.all([
    getAnalyticsPlayerInfo(analyticsPlayerId),
    getAnalyticsPlayerSeasonStats(analyticsPlayerId, season),
    getAnalyticsPlayerGames(analyticsPlayerId, season, 82),
    getNextGameForPlayer(analyticsPlayerId),
    getPlayerRecentForm(analyticsPlayerId, 5),
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
  };
}

export default async function BettingPlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { playerId } = await params;
  const { season } = await searchParams;
  const { analyticsPlayerId, player, seasonAverages, games, nextGame, opponentContext, recentForm, vsOpponentHistory } =
    await loadPlayerAnalysis(playerId, season || null);

  if (!player) {
    return (
      <div className="min-h-screen bg-background gradient-mesh">
        <header className="sticky top-0 z-50 glass-card border-b border-white/5">
          <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center h-14">
              <Link href="/betting" className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#00d4ff] to-[#bf5af2] flex items-center justify-center">
                  <Zap className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h1 className="text-sm font-bold tracking-tight">
                    <span className="neon-text-cyan">NBA</span>
                    <span className="text-white ml-1">Analytics</span>
                  </h1>
                </div>
              </Link>
            </div>
          </div>
        </header>
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-12">
          <div className="glass-card rounded-xl border-l-4 border-l-[#ff4757] p-8 text-center">
            <h1 className="text-2xl font-bold text-white mb-3">Player not found</h1>
            <p className="text-muted-foreground mb-4">The requested player could not be located.</p>
            <Link href="/betting" className="text-[#00d4ff] hover:underline text-sm">
              &larr; Back to Betting Dashboard
            </Link>
          </div>
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
    <div className="min-h-screen bg-background gradient-mesh">
      {/* Mini header matching betting dashboard nav */}
      <header className="sticky top-0 z-50 glass-card border-b border-white/5">
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <Link href="/betting" className="flex items-center gap-3 group">
              <div className="relative">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#00d4ff] to-[#bf5af2] flex items-center justify-center">
                  <Zap className="w-4 h-4 text-white" />
                </div>
                <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-[#39ff14] rounded-full pulse-dot" />
              </div>
              <div>
                <h1 className="text-sm font-bold tracking-tight">
                  <span className="neon-text-cyan">NBA</span>
                  <span className="text-white ml-1">Analytics</span>
                </h1>
                <p className="text-[10px] text-muted-foreground -mt-0.5">Player Analysis</p>
              </div>
            </Link>
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-2 py-0.5 bg-[#00d4ff]/20 text-[#00d4ff] rounded-full font-semibold">
                PLAYER PROFILE
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
        <PlayerAnalysisProvider>
          <div className="flex flex-col xl:flex-row gap-6">
            <div className="flex-1 min-w-0 space-y-6 fade-in">
              <PlayerHeader
                player={player}
                seasonAverages={seasonAverages}
                team={currentTeam}
              />
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
              <div className="sticky top-14">
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
    </div>
  );
}
