'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { GameLog, MetricKey } from '@/lib/players/types';
import { extractMetric } from '@/lib/players/metrics';

interface GameLogTableProps {
  games: GameLog[];
  activeMetric: MetricKey;
  bettingLine: number | null;
}

function metricValue(game: GameLog, key: MetricKey): number {
  return extractMetric([game], key)[0];
}

export function GameLogTable({ games, activeMetric, bettingLine }: GameLogTableProps) {
  if (games.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
        <p className="text-zinc-500">No game logs found.</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3">
        Last {games.length} Games
      </h3>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Date</TableHead>
              <TableHead>OPP</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>MIN</TableHead>
              <TableHead className={cn(activeMetric === 'pts' && 'text-[#00d4ff]')}>PTS</TableHead>
              <TableHead className={cn(activeMetric === 'reb' && 'text-[#00d4ff]')}>REB</TableHead>
              <TableHead className={cn(activeMetric === 'ast' && 'text-[#00d4ff]')}>AST</TableHead>
              <TableHead className={cn(activeMetric === '3pm' && 'text-[#00d4ff]')}>3PM</TableHead>
              <TableHead>FG</TableHead>
              <TableHead>+/-</TableHead>
              {activeMetric === 'pra' && (
                <TableHead className="text-[#00d4ff]">PRA</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {games.map((game) => {
              const gameDate = new Date(game.start_time);
              const mv = metricValue(game, activeMetric);
              const isOver = bettingLine !== null && mv > bettingLine;
              const isUnder = bettingLine !== null && mv <= bettingLine;

              const fgDisplay =
                game.field_goals_made !== null && game.field_goals_attempted !== null
                  ? `${game.field_goals_made}/${game.field_goals_attempted}`
                  : '-';

              if (game.dnp_reason) {
                return (
                  <TableRow key={game.game_id}>
                    <TableCell>
                      <Link href={`/games/${game.game_id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                        {gameDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {game.location === 'away' ? '@' : 'vs'} {game.opponent_abbr}
                    </TableCell>
                    <TableCell colSpan={activeMetric === 'pra' ? 9 : 8} className="text-zinc-500 italic">
                      {game.dnp_reason}
                    </TableCell>
                  </TableRow>
                );
              }

              const highlightClass = (key: MetricKey) =>
                cn(
                  activeMetric === key && 'font-bold',
                  activeMetric === key && bettingLine !== null && isOver && 'text-green-600 dark:text-[#39ff14]',
                  activeMetric === key && bettingLine !== null && isUnder && 'text-red-500 dark:text-[#ff4757]'
                );

              return (
                <TableRow
                  key={game.game_id}
                  className={cn(
                    bettingLine !== null && isOver && 'bg-green-50/50 dark:bg-green-950/20',
                    bettingLine !== null && isUnder && 'bg-red-50/50 dark:bg-red-950/20'
                  )}
                >
                  <TableCell>
                    <Link href={`/games/${game.game_id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                      {gameDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/teams/${game.opponent_id}`} className="hover:text-blue-600 dark:hover:text-blue-400">
                      {game.location === 'away' ? '@' : 'vs'} {game.opponent_abbr}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {game.result && (
                      <span className={cn('font-semibold', game.result === 'W' ? 'text-green-600' : 'text-red-600')}>
                        {game.result}
                      </span>
                    )}
                    {game.team_score != null && game.opponent_score != null && (
                      <span className="text-xs text-zinc-500 ml-1">
                        {game.team_score}-{game.opponent_score}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{game.minutes ? Number(game.minutes).toFixed(0) : '-'}</TableCell>
                  <TableCell className={highlightClass('pts')}>{game.points ?? '-'}</TableCell>
                  <TableCell className={highlightClass('reb')}>{game.rebounds ?? '-'}</TableCell>
                  <TableCell className={highlightClass('ast')}>{game.assists ?? '-'}</TableCell>
                  <TableCell className={highlightClass('3pm')}>{game.three_pointers_made ?? '-'}</TableCell>
                  <TableCell className="text-sm">{fgDisplay}</TableCell>
                  <TableCell
                    className={cn(
                      game.plus_minus != null && game.plus_minus > 0 && 'text-green-600',
                      game.plus_minus != null && game.plus_minus < 0 && 'text-red-600'
                    )}
                  >
                    {game.plus_minus != null ? (game.plus_minus > 0 ? '+' : '') + game.plus_minus : '-'}
                  </TableCell>
                  {activeMetric === 'pra' && (
                    <TableCell className={cn('font-bold', bettingLine !== null && isOver && 'text-green-600 dark:text-[#39ff14]', bettingLine !== null && isUnder && 'text-red-500 dark:text-[#ff4757]')}>
                      {(game.points ?? 0) + (game.rebounds ?? 0) + (game.assists ?? 0)}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
