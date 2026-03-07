import { PlayerHeader } from './components/PlayerHeader';
import { PlayerAnalysisClient } from './components/PlayerAnalysisClient';
import {
  getBBRefPlayerInfo,
  getBBRefPlayerSeasonStats,
  getBBRefPlayerGames,
} from '@/lib/players/bbref-queries';
import Link from 'next/link';
import { Zap } from 'lucide-react';
import type { GameLog, PlayerProfile, SeasonAverages } from '@/lib/players/types';

async function loadPlayerAnalysis(playerId: string, season: string | null) {
  const [player, seasonStats, gamesData] = await Promise.all([
    getBBRefPlayerInfo(playerId),
    getBBRefPlayerSeasonStats(playerId, season),
    getBBRefPlayerGames(playerId, season, 82),
  ]);

  return {
    player: player as PlayerProfile | null,
    seasonAverages: seasonStats as SeasonAverages,
    games: (gamesData.games ?? []) as GameLog[],
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
  const { player, seasonAverages, games } = await loadPlayerAnalysis(playerId, season || null);

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
        <div className="space-y-6 fade-in">
          <PlayerHeader
            player={player}
            seasonAverages={seasonAverages}
            team={currentTeam}
          />
          <PlayerAnalysisClient games={games} seasonAverages={seasonAverages} />
        </div>
      </main>
    </div>
  );
}
