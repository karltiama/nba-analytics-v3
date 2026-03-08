'use client';

import { useMemo } from 'react';
import type { GameLog, SeasonAverages, PlayerRecentForm, PlayerVsOpponentHistory } from '@/lib/players/types';
import type { TeamMatchupGame } from '@/lib/analytics/games-queries';
import type { OpponentContext } from '@/lib/analytics/matchup-queries';
import { NextGameOverviewCard } from './matchup/NextGameOverviewCard';
import { PlayerRecentFormCard } from './matchup/PlayerRecentFormCard';
import { PlayerVsOpponentHistoryCard } from './matchup/PlayerVsOpponentHistoryCard';
import { FutureOddsPlaceholderCard } from './matchup/FutureOddsPlaceholderCard';

export interface PlayerMatchupTabProps {
  games: GameLog[];
  seasonAverages: SeasonAverages;
  nextGame: TeamMatchupGame | null;
  opponentContext: OpponentContext | null;
  recentForm: PlayerRecentForm | null;
  vsOpponentHistory: PlayerVsOpponentHistory | null;
}

export function PlayerMatchupTab({
  games,
  seasonAverages,
  nextGame,
  opponentContext,
  recentForm,
  vsOpponentHistory,
}: PlayerMatchupTabProps) {
  const seasonAvgMinutes = useMemo(() => {
    const withMinutes = games.filter((g) => g.minutes != null && g.minutes > 0);
    if (withMinutes.length === 0) return null;
    const sum = withMinutes.reduce((a, g) => a + (g.minutes ?? 0), 0);
    return sum / withMinutes.length;
  }, [games]);

  return (
    <div className="flex flex-col gap-6">
      <NextGameOverviewCard
        nextGame={nextGame}
        games={games}
        opponentContext={nextGame ? opponentContext : null}
      />
      <PlayerRecentFormCard
        recentForm={recentForm}
        seasonAverages={seasonAverages}
        seasonAvgMinutes={seasonAvgMinutes}
      />
      <PlayerVsOpponentHistoryCard
        vsOpponentHistory={nextGame ? vsOpponentHistory : null}
        opponentAbbr={nextGame?.opponent_abbr ?? null}
      />
      <FutureOddsPlaceholderCard />
    </div>
  );
}
