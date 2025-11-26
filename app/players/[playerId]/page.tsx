import { PlayerHeader } from './components/PlayerHeader';
import { PlayerSeasonStats } from './components/PlayerSeasonStats';
import { PlayerRecentForm } from './components/PlayerRecentForm';
import { PlayerGameLogs } from './components/PlayerGameLogs';
import { PlayerAdvancedStats } from './components/PlayerAdvancedStats';
import {
  getBBRefPlayerInfo,
  getBBRefPlayerSeasonStats,
  getBBRefPlayerPaceAdjustedStats,
  getBBRefPlayerUsageRate,
  getBBRefPlayerRecentForm,
  getBBRefPlayerSplits,
  getBBRefPlayerGames,
} from '@/lib/players/bbref-queries';
import Link from 'next/link';

async function getPlayerStats(playerId: string, season: string | null = null) {
  const [seasonStats, paceAdjusted, usageRate, recentForm, splits] = await Promise.all([
    getBBRefPlayerSeasonStats(playerId, season),
    getBBRefPlayerPaceAdjustedStats(playerId, season),
    getBBRefPlayerUsageRate(playerId, season),
    getBBRefPlayerRecentForm(playerId, season),
    getBBRefPlayerSplits(playerId, season),
  ]);

  return {
    season_stats: seasonStats,
    pace_adjusted: paceAdjusted,
    usage_rate: usageRate,
    recent_form: recentForm,
    splits,
  };
}


export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { playerId } = await params;
  const { season } = await searchParams;
  const seasonParam = season || null;

  const [player, statsData, gamesData] = await Promise.all([
    getBBRefPlayerInfo(playerId),
    getPlayerStats(playerId, seasonParam),
    getBBRefPlayerGames(playerId, seasonParam, 20),
  ]);

  if (!player) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">Player not found</h1>
          <Link href="/dashboard" className="text-blue-600 dark:text-blue-400 hover:underline">
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const { season_stats, pace_adjusted, usage_rate, recent_form, splits } = statsData;
  const { games } = gamesData;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <PlayerHeader player={player} />
        <PlayerSeasonStats seasonStats={season_stats} />
        <PlayerAdvancedStats 
          seasonStats={season_stats}
          paceAdjusted={pace_adjusted}
          usageRate={usage_rate}
        />
        <PlayerRecentForm recentForm={recent_form} />
        <PlayerGameLogs games={games} />
      </div>
    </div>
  );
}

