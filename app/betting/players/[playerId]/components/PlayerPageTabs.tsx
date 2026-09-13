'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { GameLog, SeasonAverages, PlayerRecentForm, PlayerVsOpponentHistory } from '@/lib/players/types';
import type { TeamMatchupGame } from '@/lib/analytics/games-queries';
import type { OpponentContext } from '@/lib/analytics/matchup-queries';
import { PlayerTrendsTab } from './PlayerTrendsTab';
import { PlayerMatchupTab } from './PlayerMatchupTab';
import { PlayerGameLogTab } from './PlayerGameLogTab';

export interface PlayerPageTabsProps {
  games: GameLog[];
  seasonAverages: SeasonAverages;
  nextGame: TeamMatchupGame | null;
  opponentContext: OpponentContext | null;
  recentForm: PlayerRecentForm | null;
  vsOpponentHistory: PlayerVsOpponentHistory | null;
}

const triggerClass = cn(
  'flex-none rounded-lg px-4 py-2 text-sm font-medium shadow-none',
  'text-[#4a6366] hover:text-[#063f46] hover:bg-[#f7f9f7]',
  'data-[state=active]:bg-[#063f46]! data-[state=active]:text-white! data-[state=active]:shadow-none'
);

export function PlayerPageTabs({
  games,
  seasonAverages,
  nextGame,
  opponentContext,
  recentForm,
  vsOpponentHistory,
}: PlayerPageTabsProps) {
  return (
    <Tabs defaultValue="trends" className="w-full">
      <TabsList
        className={cn(
          'inline-flex w-fit h-auto flex-wrap gap-1 p-1 rounded-xl',
          'bg-white border border-[#DCE9EA] shadow-none'
        )}
      >
        <TabsTrigger value="trends" className={triggerClass}>
          Trends
        </TabsTrigger>
        <TabsTrigger value="matchup" className={triggerClass}>
          Matchup
        </TabsTrigger>
        <TabsTrigger value="gamelog" className={triggerClass}>
          Game Log
        </TabsTrigger>
      </TabsList>
      <div className="mt-6">
        <TabsContent value="trends" className="mt-0 outline-none">
          <PlayerTrendsTab games={games} seasonAverages={seasonAverages} />
        </TabsContent>
        <TabsContent value="matchup" className="mt-0 outline-none">
          <PlayerMatchupTab
            games={games}
            seasonAverages={seasonAverages}
            nextGame={nextGame}
            opponentContext={opponentContext}
            recentForm={recentForm}
            vsOpponentHistory={vsOpponentHistory}
          />
        </TabsContent>
        <TabsContent value="gamelog" className="mt-0 outline-none">
          <PlayerGameLogTab games={games} />
        </TabsContent>
      </div>
    </Tabs>
  );
}
