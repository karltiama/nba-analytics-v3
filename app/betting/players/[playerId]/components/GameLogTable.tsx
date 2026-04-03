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
  /** Narrow columns and padding for sidebars / tight layouts */
  compact?: boolean;
}

function metricValue(game: GameLog, key: MetricKey): number {
  return extractMetric([game], key)[0];
}

function formatGameDate(isoOrDateStr: string): string {
  const date = new Date(isoOrDateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function GameLogTable({ games, activeMetric, bettingLine, compact = false }: GameLogTableProps) {
  if (games.length === 0) {
    return (
      <div className={cn('glass-card rounded-xl text-center', compact ? 'p-4' : 'p-8')}>
        <p className="text-muted-foreground text-xs">No game logs found.</p>
      </div>
    );
  }

  const cellText = compact ? 'text-[10px] py-1 px-1.5' : 'text-sm';
  const headText = compact ? 'text-[10px] h-8 px-1.5' : '';

  return (
    <div className="glass-card rounded-xl border-l-4 border-l-[#39ff14] overflow-hidden">
      <div
        className={cn(
          'border-b border-white/5 flex items-center justify-between bg-white/[0.02]',
          compact ? 'px-2.5 py-1.5' : 'px-5 py-2.5'
        )}
      >
        <h3
          className={cn(
            'font-semibold uppercase tracking-wider text-muted-foreground',
            compact ? 'text-[10px]' : 'text-sm'
          )}
        >
          Game Log
        </h3>
        <span
          className={cn(
            'px-2 py-0.5 bg-[#39ff14]/20 text-[#39ff14] rounded-full font-semibold',
            compact ? 'text-[9px]' : 'text-[10px]'
          )}
        >
          LAST {games.length}
        </span>
      </div>
      <div className={compact ? 'p-2' : 'p-5'}>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-white/5">
                <TableHead className={cn(compact ? 'w-14' : 'w-24', 'text-muted-foreground', headText)}>Date</TableHead>
                {!compact && (
                  <>
                    <TableHead className="text-muted-foreground">OPP</TableHead>
                    <TableHead className="text-muted-foreground">Result</TableHead>
                    <TableHead className="text-muted-foreground">MIN</TableHead>
                  </>
                )}
                {compact && <TableHead className={cn('text-muted-foreground min-w-0', headText)}>Result</TableHead>}
                <TableHead
                  className={cn(
                    'text-muted-foreground',
                    headText,
                    activeMetric === 'pts' && 'text-[#00d4ff]!'
                  )}
                >
                  PTS
                </TableHead>
                <TableHead
                  className={cn(
                    'text-muted-foreground',
                    headText,
                    activeMetric === 'reb' && 'text-[#00d4ff]!'
                  )}
                >
                  REB
                </TableHead>
                {compact ? (
                  <TableHead
                    className={cn(
                      'text-muted-foreground',
                      headText,
                      activeMetric === '3pm' && 'text-[#00d4ff]!',
                      activeMetric === 'ast' && 'text-[#00d4ff]!'
                    )}
                  >
                    {activeMetric === '3pm' ? '3PM' : 'AST'}
                  </TableHead>
                ) : (
                  <TableHead
                    className={cn('text-muted-foreground', activeMetric === 'ast' && 'text-[#00d4ff]!')}
                  >
                    AST
                  </TableHead>
                )}
                {!compact && (
                  <>
                    <TableHead className={cn('text-muted-foreground', activeMetric === '3pm' && 'text-[#00d4ff]!')}>
                      3PM
                    </TableHead>
                    <TableHead className="text-muted-foreground">FG</TableHead>
                    <TableHead className="text-muted-foreground">+/-</TableHead>
                  </>
                )}
                {activeMetric === 'pra' && (
                  <TableHead className={cn('text-[#00d4ff]!', headText)}>PRA</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {games.map((game) => {
                const dateStr = formatGameDate(game.start_time || game.game_date || '');
                const mv = metricValue(game, activeMetric);
                const isOver = bettingLine !== null && mv > bettingLine;
                const isUnder = bettingLine !== null && mv <= bettingLine;

                const fgDisplay =
                  game.field_goals_made !== null && game.field_goals_attempted !== null
                    ? `${game.field_goals_made}/${game.field_goals_attempted}`
                    : '-';

                const highlightClass = (key: MetricKey) =>
                  cn(
                    cellText,
                    activeMetric === key && 'font-bold text-white',
                    activeMetric === key && bettingLine !== null && isOver && 'text-[#39ff14]!',
                    activeMetric === key && bettingLine !== null && isUnder && 'text-[#ff4757]!'
                  );

                const resultCell = (
                  <>
                    {game.result && (
                      <span
                        className={cn(
                          'font-semibold',
                          compact ? 'text-[10px]' : '',
                          game.result === 'W' ? 'text-[#39ff14]' : 'text-[#ff4757]'
                        )}
                      >
                        {game.result}
                      </span>
                    )}
                    {game.team_score != null && game.opponent_score != null && (
                      <span
                        className={cn(
                          'text-muted-foreground/50 ml-0.5',
                          compact ? 'text-[9px]' : 'text-xs'
                        )}
                      >
                        {game.team_score}-{game.opponent_score}
                      </span>
                    )}
                  </>
                );

                if (game.dnp_reason) {
                  if (compact) {
                    const dnpSpan = activeMetric === 'pra' ? 5 : 4;
                    return (
                      <TableRow key={game.game_id} className="border-white/5">
                        <TableCell className={cellText}>
                          <Link
                            href={`/games/${game.game_id}`}
                            className="text-[#00d4ff] hover:underline text-[10px]"
                          >
                            {dateStr}
                          </Link>
                        </TableCell>
                        <TableCell
                          colSpan={dnpSpan}
                          className="text-muted-foreground/50 italic text-[10px] py-1"
                        >
                          {game.dnp_reason}
                        </TableCell>
                      </TableRow>
                    );
                  }
                  return (
                    <TableRow key={game.game_id} className="border-white/5">
                      <TableCell>
                        <Link href={`/games/${game.game_id}`} className="text-[#00d4ff] hover:underline text-sm">
                          {dateStr}
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

                if (compact) {
                  return (
                    <TableRow
                      key={game.game_id}
                      className={cn(
                        'border-white/5 text-muted-foreground',
                        bettingLine !== null && isOver && 'bg-[#39ff14]/5',
                        bettingLine !== null && isUnder && 'bg-[#ff4757]/5'
                      )}
                    >
                      <TableCell className={cellText}>
                        <Link
                          href={`/games/${game.game_id}`}
                          className="text-[#00d4ff] hover:underline text-[10px] whitespace-nowrap"
                        >
                          {dateStr}
                        </Link>
                      </TableCell>
                      <TableCell className={cn(cellText, 'max-w-[4.5rem] truncate')}>{resultCell}</TableCell>
                      <TableCell className={highlightClass('pts')}>{game.points ?? '-'}</TableCell>
                      <TableCell className={highlightClass('reb')}>{game.rebounds ?? '-'}</TableCell>
                      {activeMetric === '3pm' ? (
                        <TableCell className={highlightClass('3pm')}>{game.three_pointers_made ?? '-'}</TableCell>
                      ) : (
                        <TableCell className={highlightClass('ast')}>{game.assists ?? '-'}</TableCell>
                      )}
                      {activeMetric === 'pra' && (
                        <TableCell
                          className={cn(
                            cellText,
                            'font-bold text-white',
                            bettingLine !== null && isOver && 'text-[#39ff14]!',
                            bettingLine !== null && isUnder && 'text-[#ff4757]!'
                          )}
                        >
                          {(game.points ?? 0) + (game.rebounds ?? 0) + (game.assists ?? 0)}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                }

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
                        {dateStr}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/teams/${game.opponent_id}`} className="hover:text-[#00d4ff] transition-colors">
                        {game.location === 'away' ? '@' : 'vs'} {game.opponent_abbr}
                      </Link>
                    </TableCell>
                    <TableCell>{resultCell}</TableCell>
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
                      <TableCell
                        className={cn(
                          'font-bold text-white',
                          bettingLine !== null && isOver && 'text-[#39ff14]!',
                          bettingLine !== null && isUnder && 'text-[#ff4757]!'
                        )}
                      >
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
