import { PlayerHeader } from './components/PlayerHeader';
import { PlayerAnalysisClient } from './components/PlayerAnalysisClient';
import {
  getBBRefPlayerInfo,
  getBBRefPlayerSeasonStats,
  getBBRefPlayerGames,
} from '@/lib/players/bbref-queries';
import Link from 'next/link';
import type { GameLog, PlayerProfile, SeasonAverages } from '@/lib/players/types';

async function loadPlayerAnalysis(playerId: string, season: string | null) {
  const [player, seasonStats, gamesData] = await Promise.all([
    getBBRefPlayerInfo(playerId),
    getBBRefPlayerSeasonStats(playerId, season),
    getBBRefPlayerGames(playerId, season, 20),
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
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-12">
          <div className="glass-card rounded-xl p-8 text-center">
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

  return (
    <div className="min-h-screen bg-background gradient-mesh">
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
        <div className="space-y-6 fade-in">
          <PlayerHeader player={player} seasonAverages={seasonAverages} />
          <PlayerAnalysisClient games={games} seasonAverages={seasonAverages} />
        </div>
      </div>
    </div>
  );
}
