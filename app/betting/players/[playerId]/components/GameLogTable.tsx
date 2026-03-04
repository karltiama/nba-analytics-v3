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
      <div className="glass-card rounded-xl p-8 text-center">
        <p className="text-muted-foreground">No game logs found.</p>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl border-l-4 border-l-[#39ff14] overflow-hidden">
      <div className="px-5 py-2.5 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Game Log
        </h3>
        <span className="text-[10px] px-2 py-0.5 bg-[#39ff14]/20 text-[#39ff14] rounded-full font-semibold">
          LAST {games.length}
        </span>
      </div>
      <div className="p-5">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-white/5">
              <TableHead className="w-24 text-muted-foreground">Date</TableHead>
              <TableHead className="text-muted-foreground">OPP</TableHead>
              <TableHead className="text-muted-foreground">Result</TableHead>
              <TableHead className="text-muted-foreground">MIN</TableHead>
              <TableHead className={cn('text-muted-foreground', activeMetric === 'pts' && 'text-[#00d4ff]!')}>PTS</TableHead>
              <TableHead className={cn('text-muted-foreground', activeMetric === 'reb' && 'text-[#00d4ff]!')}>REB</TableHead>
              <TableHead className={cn('text-muted-foreground', activeMetric === 'ast' && 'text-[#00d4ff]!')}>AST</TableHead>
              <TableHead className={cn('text-muted-foreground', activeMetric === '3pm' && 'text-[#00d4ff]!')}>3PM</TableHead>
              <TableHead className="text-muted-foreground">FG</TableHead>
              <TableHead className="text-muted-foreground">+/-</TableHead>
              {activeMetric === 'pra' && (
                <TableHead className="text-[#00d4ff]!">PRA</TableHead>
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
                  <TableRow key={game.game_id} className="border-white/5">
                    <TableCell>
                      <Link href={`/games/${game.game_id}`} className="text-[#00d4ff] hover:underline text-sm">
                        {gameDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {game.location === 'away' ? '@' : 'vs'} {game.opponent_abbr}
                    </TableCell>
                    <TableCell colSpan={activeMetric === 'pra' ? 9 : 8} className="text-muted-foreground/50 italic text-sm">
                      {game.dnp_reason}
                    </TableCell>
                  </TableRow>
                );
              }

              const highlightClass = (key: MetricKey) =>
                cn(
                  activeMetric === key && 'font-bold text-white',
                  activeMetric === key && bettingLine !== null && isOver && 'text-[#39ff14]!',
                  activeMetric === key && bettingLine !== null && isUnder && 'text-[#ff4757]!'
                );

              return (
                <TableRow
                  key={game.game_id}
                  className={cn(
                    'border-white/5 text-muted-foreground',
                    bettingLine !== null && isOver && 'bg-[#39ff14]/5',
                    bettingLine !== null && isUnder && 'bg-[#ff4757]/5'
                  )}
                >
                  <TableCell>
                    <Link href={`/games/${game.game_id}`} className="text-[#00d4ff] hover:underline text-sm">
                      {gameDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/teams/${game.opponent_id}`} className="hover:text-[#00d4ff] transition-colors">
                      {game.location === 'away' ? '@' : 'vs'} {game.opponent_abbr}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {game.result && (
                      <span className={cn('font-semibold', game.result === 'W' ? 'text-[#39ff14]' : 'text-[#ff4757]')}>
                        {game.result}
                      </span>
                    )}
                    {game.team_score != null && game.opponent_score != null && (
                      <span className="text-xs text-muted-foreground/50 ml-1">
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
                      game.plus_minus != null && game.plus_minus > 0 && 'text-[#39ff14]',
                      game.plus_minus != null && game.plus_minus < 0 && 'text-[#ff4757]'
                    )}
                  >
                    {game.plus_minus != null ? (game.plus_minus > 0 ? '+' : '') + game.plus_minus : '-'}
                  </TableCell>
                  {activeMetric === 'pra' && (
                    <TableCell className={cn(
                      'font-bold text-white',
                      bettingLine !== null && isOver && 'text-[#39ff14]!',
                      bettingLine !== null && isUnder && 'text-[#ff4757]!'
                    )}>
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
    </div>
  );
}
