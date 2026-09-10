'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { HistoricalFinalAdvancedStats } from '@/components/betting/HistoricalFinalAdvancedStats';
import { playerResearchHref } from '@/lib/betting/research-journey';
import {
  HISTORICAL_PLAYER_VIEW_ADVANCED,
  HISTORICAL_PLAYER_VIEW_BOX,
  HISTORICAL_PLAYER_VIEW_DEFAULT,
  shouldShowHistoricalAdvanced,
  type HistoricalPlayerView,
} from '@/lib/betting/historical-advanced';
import type { HistoricalBoxPlayer, HistoricalBoxScore, HistoricalModuleAvailability } from '@/lib/betting/historical-final';

function formatStat(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return String(value);
}

function TeamBoxTable({
  teamName,
  teamId,
  rows,
  gameId,
  date,
  season,
}: {
  teamName: string;
  teamId: string;
  rows: HistoricalBoxPlayer[];
  gameId: string;
  date?: string;
  season?: string;
}) {
  return (
    <div className="glass-card rounded-xl overflow-hidden border border-white/5 min-w-0">
      <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02]">
        <Link href={`/teams/${teamId}`} className="text-sm font-semibold text-white hover:text-[#00d4ff]">
          {teamName}
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground p-4">No player logs for this team.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="px-3 py-2 font-medium">Player</th>
                <th className="px-2 py-2 font-medium text-right">MIN</th>
                <th className="px-2 py-2 font-medium text-right">PTS</th>
                <th className="px-2 py-2 font-medium text-right">REB</th>
                <th className="px-2 py-2 font-medium text-right">AST</th>
                <th className="px-2 py-2 font-medium text-right">STL</th>
                <th className="px-2 py-2 font-medium text-right">BLK</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.teamId}-${row.playerId}`} className="border-t border-white/5">
                  <td className="px-3 py-1.5">
                    <Link
                      href={playerResearchHref({
                        playerId: row.playerId,
                        gameId,
                        date,
                        season,
                      })}
                      className="text-white hover:text-[#00d4ff]"
                    >
                      {row.playerName || 'Player'}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {row.minutes ?? '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-white">
                    {formatStat(row.points)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-white">
                    {formatStat(row.rebounds)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-white">
                    {formatStat(row.assists)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-white">
                    {formatStat(row.steals)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-white">
                    {formatStat(row.blocks)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function HistoricalFinalBoxScore({
  awayName,
  awayTeamId,
  homeName,
  homeTeamId,
  boxScore,
  gameId,
  date,
  season,
  availability,
}: {
  awayName: string;
  awayTeamId: string;
  homeName: string;
  homeTeamId: string;
  boxScore: HistoricalBoxScore;
  gameId: string;
  date?: string;
  season?: string;
  availability?: HistoricalModuleAvailability | null;
}) {
  const [view, setView] = useState<HistoricalPlayerView>(HISTORICAL_PLAYER_VIEW_DEFAULT);
  const showAdvanced = shouldShowHistoricalAdvanced(availability);

  if (!boxScore.available) {
    return (
      <div className="glass-card rounded-xl border border-white/5 p-4">
        <h2 className="text-sm font-semibold text-white mb-1">Box score</h2>
        <p className="text-xs text-muted-foreground">
          Box score is not available for this game. The official final is still shown above.
        </p>
      </div>
    );
  }

  const boxTables = (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <TeamBoxTable
        teamName={awayName}
        teamId={awayTeamId}
        rows={boxScore.away}
        gameId={gameId}
        date={date}
        season={season}
      />
      <TeamBoxTable
        teamName={homeName}
        teamId={homeTeamId}
        rows={boxScore.home}
        gameId={gameId}
        date={date}
        season={season}
      />
    </div>
  );

  if (!showAdvanced) {
    return (
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-white">Box score</h2>
        {boxTables}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Tabs
        value={view}
        onValueChange={(next) => {
          if (next === HISTORICAL_PLAYER_VIEW_ADVANCED || next === HISTORICAL_PLAYER_VIEW_BOX) {
            setView(next);
          }
        }}
        className="gap-3"
      >
        <div className="flex flex-col gap-2">
          <div>
            <h2 className="text-sm font-semibold text-white">Players</h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              This game — Box Score or Advanced. Not season role.
            </p>
          </div>
          <TabsList
            aria-label="This game player stats"
            className="h-8 bg-white/5 border border-white/10"
          >
            <TabsTrigger value={HISTORICAL_PLAYER_VIEW_BOX} className="px-3 text-xs">
              Box Score
            </TabsTrigger>
            <TabsTrigger value={HISTORICAL_PLAYER_VIEW_ADVANCED} className="px-3 text-xs">
              Advanced
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value={HISTORICAL_PLAYER_VIEW_BOX} className="mt-0">
          {boxTables}
        </TabsContent>
        <TabsContent value={HISTORICAL_PLAYER_VIEW_ADVANCED} className="mt-0">
          <HistoricalFinalAdvancedStats
            awayName={awayName}
            awayTeamId={awayTeamId}
            homeName={homeName}
            homeTeamId={homeTeamId}
            away={boxScore.away}
            home={boxScore.home}
            gameId={gameId}
            date={date}
            season={season}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
