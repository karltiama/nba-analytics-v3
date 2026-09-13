'use client';

import { cn } from '@/lib/utils';
import type { TeamMatchupGame } from '@/lib/analytics/games-queries';
import type { GameLog } from '@/lib/players/types';
import type { OpponentContext } from '@/lib/analytics/matchup-queries';

function formatGameDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function daysBetween(isoStart: string, isoEnd: string): number | null {
  const start = new Date(isoStart).getTime();
  const end = new Date(isoEnd).getTime();
  if (isNaN(start) || isNaN(end)) return null;
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

function fmt(value: number | null): string {
  return value != null ? value.toFixed(1) : '—';
}

export interface NextGameOverviewCardProps {
  nextGame: TeamMatchupGame | null;
  games: GameLog[];
  opponentContext: OpponentContext | null;
}

export function NextGameOverviewCard({ nextGame, games, opponentContext }: NextGameOverviewCardProps) {
  const daysRest =
    nextGame?.start_time && games.length > 0 && games[0].start_time
      ? daysBetween(games[0].start_time, nextGame.start_time)
      : null;

  return (
    <section className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-[#4a6366] mb-2">
        Next Game & Opponent Context
      </h3>
      {nextGame ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-bold text-[#063f46]">
              {nextGame.is_home ? 'vs' : '@'} {nextGame.opponent_abbr}
            </span>
            <span className="text-[#8aa0a3]">·</span>
            <span
              className={cn(
                'text-[10px] px-2 py-0.5 rounded-full font-semibold',
                nextGame.is_home
                  ? 'bg-[#55ddb1]/25 text-[#075B5C]'
                  : 'bg-[#F8FBFA] border border-[#DCE9EA] text-[#063f46]'
              )}
            >
              {nextGame.is_home ? 'Home' : 'Away'}
            </span>
            {daysRest != null && (
              <>
                <span className="text-[#8aa0a3]">·</span>
                <span className="text-[#4a6366]">
                  {daysRest} day{daysRest !== 1 ? 's' : ''} rest
                </span>
              </>
            )}
            <span className="text-[#8aa0a3]">·</span>
            <span className="text-[#4a6366]">{formatGameDateTime(nextGame.start_time)}</span>
            <span className="text-[#8aa0a3]">·</span>
            <span className="font-medium text-[#063f46]">
              {nextGame.is_home
                ? `${nextGame.team_abbr} vs ${nextGame.opponent_abbr}`
                : `${nextGame.team_abbr} @ ${nextGame.opponent_abbr}`}
            </span>
            <span className="text-[#8aa0a3]">·</span>
            <span className="text-[#4a6366]">{nextGame.opponent_name}</span>
          </div>

          {opponentContext ? (
            <div className="pt-3 border-t border-[#DCE9EA]">
              <p className="text-[10px] text-[#4a6366] uppercase mb-2">
                Opponent {nextGame.opponent_abbr} (season)
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-2">
                <div>
                  <div className="text-[10px] text-[#4a6366] uppercase">Def. rating</div>
                  <div className="text-base font-bold font-mono text-[#063f46] leading-tight">
                    {fmt(opponentContext.avg_defensive_rating)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[#4a6366] uppercase">Pace</div>
                  <div className="text-base font-bold font-mono text-[#063f46] leading-tight">
                    {fmt(opponentContext.avg_pace)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[#4a6366] uppercase">Pts allowed</div>
                  <div className="text-base font-bold font-mono text-[#063f46] leading-tight">
                    {fmt(opponentContext.avg_points_allowed)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[#4a6366] uppercase">Reb allowed</div>
                  <div className="text-base font-bold font-mono text-[#063f46] leading-tight">
                    {fmt(opponentContext.avg_rebounds_allowed)}
                  </div>
                </div>
                <div title="Not yet available in analytics">
                  <div className="text-[10px] text-[#4a6366] uppercase">Ast allowed</div>
                  <div className="text-base font-bold font-mono text-[#8aa0a3] leading-tight">—</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="pt-3 border-t border-[#DCE9EA]">
              <p className="text-sm text-[#4a6366]">Opponent team stats not available.</p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-[#4a6366]">No upcoming game scheduled.</p>
      )}
    </section>
  );
}
