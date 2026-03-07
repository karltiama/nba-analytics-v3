'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { GameLog, SeasonAverages } from '@/lib/players/types';
import type { TeamMatchupGame } from '@/lib/analytics/games-queries';
import { PlayerTrendsTab } from './PlayerTrendsTab';
import { PlayerMatchupTab } from './PlayerMatchupTab';
import { PlayerGameLogTab } from './PlayerGameLogTab';

export interface PlayerPageTabsProps {
  games: GameLog[];
  seasonAverages: SeasonAverages;
  nextGame: TeamMatchupGame | null;
}

export function PlayerPageTabs({ games, seasonAverages, nextGame }: PlayerPageTabsProps) {
  return (
    <Tabs defaultValue="trends" className="w-full">
      <TabsList
        className={cn(
          'w-full sm:w-auto h-auto flex flex-wrap gap-1 p-1 rounded-xl',
          'bg-white/5 border border-white/10',
          'data-[variant=default]:bg-white/5'
        )}
      >
        <TabsTrigger
          value="trends"
          className={cn(
            'rounded-lg px-4 py-2 text-sm font-medium',
            'data-[state=active]:bg-[#00d4ff] data-[state=active]:text-black',
            'data-[state=active]:shadow-[0_0_16px_rgba(0,212,255,0.4)]',
            'data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-white data-[state=inactive]:hover:bg-white/10'
          )}
        >
          Trends
        </TabsTrigger>
        <TabsTrigger
          value="matchup"
          className={cn(
            'rounded-lg px-4 py-2 text-sm font-medium',
            'data-[state=active]:bg-[#00d4ff] data-[state=active]:text-black',
            'data-[state=active]:shadow-[0_0_16px_rgba(0,212,255,0.4)]',
            'data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-white data-[state=inactive]:hover:bg-white/10'
          )}
        >
          Matchup
        </TabsTrigger>
        <TabsTrigger
          value="gamelog"
          className={cn(
            'rounded-lg px-4 py-2 text-sm font-medium',
            'data-[state=active]:bg-[#00d4ff] data-[state=active]:text-black',
            'data-[state=active]:shadow-[0_0_16px_rgba(0,212,255,0.4)]',
            'data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-white data-[state=inactive]:hover:bg-white/10'
          )}
        >
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
          />
        </TabsContent>
        <TabsContent value="gamelog" className="mt-0 outline-none">
          <PlayerGameLogTab games={games} />
        </TabsContent>
      </div>
    </Tabs>
  );
}
