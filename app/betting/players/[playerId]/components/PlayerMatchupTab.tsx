'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { GameLog, SeasonAverages } from '@/lib/players/types';
import type { TeamMatchupGame } from '@/lib/analytics/games-queries';
import { extractMetric, summaryStats } from '@/lib/players/metrics';

export interface PlayerMatchupTabProps {
  games: GameLog[];
  seasonAverages: SeasonAverages;
  nextGame: TeamMatchupGame | null;
}

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

export function PlayerMatchupTab({ games, seasonAverages, nextGame }: PlayerMatchupTabProps) {
  const recentForm = useMemo(() => {
    const played = games.filter((g) => (g.minutes ?? 0) > 0).slice(0, 5);
    const pts = extractMetric(played, 'pts');
    const reb = extractMetric(played, 'reb');
    const ast = extractMetric(played, 'ast');
    const threes = extractMetric(played, '3pm');
    return {
      pts: summaryStats(pts),
      reb: summaryStats(reb),
      ast: summaryStats(ast),
      threes: summaryStats(threes),
      gamesPlayed: played.length,
    };
  }, [games]);

  const vsOpponentGames = useMemo(() => {
    if (!nextGame) return [];
    return games.filter((g) => g.opponent_abbr === nextGame.opponent_abbr);
  }, [games, nextGame]);

  const vsOpponentSummary = useMemo(() => {
    if (vsOpponentGames.length === 0) return null;
    const pts = extractMetric(vsOpponentGames, 'pts');
    const reb = extractMetric(vsOpponentGames, 'reb');
    const ast = extractMetric(vsOpponentGames, 'ast');
    const threes = extractMetric(vsOpponentGames, '3pm');
    const pra = extractMetric(vsOpponentGames, 'pra');
    return {
      games: vsOpponentGames.length,
      pts: pts.length ? (pts.reduce((a, b) => a + b, 0) / pts.length).toFixed(1) : '—',
      reb: reb.length ? (reb.reduce((a, b) => a + b, 0) / reb.length).toFixed(1) : '—',
      ast: ast.length ? (ast.reduce((a, b) => a + b, 0) / ast.length).toFixed(1) : '—',
      threes: threes.length ? (threes.reduce((a, b) => a + b, 0) / threes.length).toFixed(1) : '—',
      pra: pra.length ? (pra.reduce((a, b) => a + b, 0) / pra.length).toFixed(1) : '—',
    };
  }, [vsOpponentGames]);

  return (
    <div className="flex flex-col gap-6">
      {/* Next Game */}
      <section className="glass-card rounded-xl border-l-4 border-l-[#00d4ff] p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Next Game
        </h3>
        {nextGame ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xl font-bold text-white">
                {nextGame.is_home ? 'vs' : '@'} {nextGame.opponent_abbr}
              </span>
              <span
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full font-semibold',
                  nextGame.is_home ? 'bg-[#bf5af2]/20 text-[#bf5af2]' : 'bg-[#00d4ff]/20 text-[#00d4ff]'
                )}
              >
                {nextGame.is_home ? 'Home' : 'Away'}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {formatGameDateTime(nextGame.start_time)}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground">No upcoming game scheduled.</p>
        )}
      </section>

      {/* Recent Form (L5) */}
      <section className="glass-card rounded-xl p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Recent Form (Last 5 games)
        </h3>
        {recentForm.gamesPlayed === 0 ? (
          <p className="text-muted-foreground">No recent games.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">PTS</div>
              <div className="text-lg font-bold font-mono text-white">
                {recentForm.pts.avg.toFixed(1)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">REB</div>
              <div className="text-lg font-bold font-mono text-white">
                {recentForm.reb.avg.toFixed(1)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">AST</div>
              <div className="text-lg font-bold font-mono text-white">
                {recentForm.ast.avg.toFixed(1)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">3PM</div>
              <div className="text-lg font-bold font-mono text-white">
                {recentForm.threes.avg.toFixed(1)}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Vs Opponent (this season) */}
      <section className="glass-card rounded-xl p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Vs {nextGame?.opponent_abbr ?? 'Next opponent'} (this season)
        </h3>
        {!nextGame ? (
          <p className="text-muted-foreground">No next game to compare.</p>
        ) : vsOpponentSummary ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {vsOpponentSummary.games} matchup{vsOpponentSummary.games !== 1 ? 's' : ''} this season
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div>
                <div className="text-[10px] text-muted-foreground">PTS</div>
                <div className="font-mono font-semibold text-white">{vsOpponentSummary.pts}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">REB</div>
                <div className="font-mono font-semibold text-white">{vsOpponentSummary.reb}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">AST</div>
                <div className="font-mono font-semibold text-white">{vsOpponentSummary.ast}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">3PM</div>
                <div className="font-mono font-semibold text-white">{vsOpponentSummary.threes}</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">PRA</div>
                <div className="font-mono font-semibold text-white">{vsOpponentSummary.pra}</div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">No matchups this season.</p>
        )}
      </section>

      {/* Placeholder for future matchup analytics / odds */}
      <section
        className={cn(
          'glass-card rounded-xl p-6 border border-dashed border-white/20',
          'flex items-center justify-center min-h-[120px]'
        )}
      >
        <p className="text-sm text-muted-foreground">
          Matchup Analytics — Coming Soon
        </p>
      </section>
    </div>
  );
}
