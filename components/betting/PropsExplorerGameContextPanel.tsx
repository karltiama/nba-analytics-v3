'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, LayoutGrid, Loader2, Zap, TrendingUp, AlertTriangle } from 'lucide-react';
import type { InjuryMatchupContext } from '@/lib/betting/injury-matchup-context';
import { buildInjuryContextNarrative } from '@/lib/betting/injury-context-narrative';
import {
  getGameSummaryBulletsForAi,
  formatOddsHintForAiSummary,
  buildAiSupplementalLines,
} from '@/lib/betting/ai-game-summary-payload';

type InjuryRow = { player: string; status: string; injury: string };

type TeamStatsBlock = {
  offensiveRating: number;
  defensiveRating: number;
  pace: number;
};

type GameDetailsPayload = {
  game: {
    id: string;
    homeTeam: { id: string; name: string; abbreviation: string; record: string };
    awayTeam: { id: string; name: string; abbreviation: string; record: string };
    startTime: string;
  };
  homeTeamStats: TeamStatsBlock;
  awayTeamStats: TeamStatsBlock;
  spreadMovement: { time: string; value: number }[];
  currentOdds: {
    spread: number | null;
    overUnder: number | null;
    moneylineHome?: number | null;
    moneylineAway?: number | null;
  } | null;
  injuryMatchupContext: InjuryMatchupContext;
  injuries?: { home: InjuryRow[]; away: InjuryRow[] };
};

function GameContextPlaceholder({ message }: { message: string }) {
  return (
    <div className="glass-card rounded-xl border border-white/5 overflow-hidden">
      <div className="px-3 py-2.5 border-b border-white/5 bg-white/[0.02] flex items-center gap-2">
        <Zap className="w-4 h-4 text-[#bf5af2]/90 shrink-0" aria-hidden />
        <h2 className="text-sm font-semibold text-white">AI Projection Summary</h2>
        <span className="text-[9px] px-1.5 py-0.5 bg-[#bf5af2]/20 text-[#bf5af2] rounded-full">Beta</span>
      </div>
      <p className="p-3 text-[11px] text-muted-foreground leading-relaxed">{message}</p>
    </div>
  );
}

function UnderlyingNumbersBlock({
  injuryMatchupContext,
  game,
}: {
  injuryMatchupContext: InjuryMatchupContext;
  game: GameDetailsPayload['game'];
}) {
  if (!injuryMatchupContext.entries?.length) return null;
  return (
    <details className="group rounded-lg border border-white/10 bg-white/[0.02]">
      <summary className="cursor-pointer list-none px-2.5 py-2 text-[10px] text-muted-foreground hover:text-white/90 [&::-webkit-details-marker]:hidden flex items-center gap-2">
        <ChevronDown className="w-3.5 h-3.5 shrink-0 transition-transform group-open:rotate-180" />
        Underlying numbers
      </summary>
      <div className="px-2.5 pb-2.5 pt-0 space-y-2 border-t border-white/5">
        <p className="text-[9px] text-muted-foreground pt-2 leading-relaxed">
          Out / doubtful teammate PTS splits (box scores). Descriptive only—not a projection.
        </p>
        {injuryMatchupContext.entries.map((entry) => {
          const teamLabel =
            entry.team_id === game.homeTeam.id ? game.homeTeam.name : game.awayTeam.name;
          return (
            <div key={entry.player_id} className="border border-white/5 rounded-lg p-2 bg-white/[0.02]">
              <div className="flex flex-wrap items-baseline gap-1.5 mb-1.5">
                <span className="text-[10px] font-medium text-white">{entry.full_name}</span>
                <span className="text-[9px] text-muted-foreground">{teamLabel}</span>
                <span className="text-[9px] text-muted-foreground">
                  With {entry.games_played_sample} · No min {entry.games_missed_sample}
                </span>
                {entry.low_sample ? <span className="text-[9px] text-amber-400/90">Low sample</span> : null}
              </div>
              {entry.teammates.length === 0 ? (
                <p className="text-[9px] text-muted-foreground">No teammate split data.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[9px] text-left">
                    <thead>
                      <tr className="text-muted-foreground border-b border-white/5">
                        <th className="py-0.5 pr-1 font-normal">Tm</th>
                        <th className="py-0.5 px-0.5 font-normal">w/</th>
                        <th className="py-0.5 px-0.5 font-normal">out</th>
                        <th className="py-0.5 pl-0.5 font-normal">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entry.teammates.map((t) => (
                        <tr key={t.player_id} className="border-b border-white/[0.03] text-white/90">
                          <td className="py-0.5 pr-1 truncate max-w-[100px]" title={t.full_name}>
                            {t.full_name}
                          </td>
                          <td className="py-0.5 px-0.5">{t.avg_pts_with ?? '—'}</td>
                          <td className="py-0.5 px-0.5">{t.avg_pts_without ?? '—'}</td>
                          <td
                            className={`py-0.5 pl-0.5 ${
                              (t.pts_delta ?? 0) > 0
                                ? 'text-emerald-400/90'
                                : (t.pts_delta ?? 0) < 0
                                  ? 'text-rose-400/90'
                                  : ''
                            }`}
                          >
                            {t.pts_delta != null
                              ? t.pts_delta > 0
                                ? `+${t.pts_delta}`
                                : String(t.pts_delta)
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}

export function PropsExplorerGameContextPanel({ gameId }: { gameId: string | null }) {
  const [data, setData] = useState<GameDetailsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiSummaryText, setAiSummaryText] = useState<string | null>(null);
  const [aiSummaryStatus, setAiSummaryStatus] = useState<
    'idle' | 'loading' | 'success' | 'unavailable' | 'error'
  >('idle');

  useEffect(() => {
    setAiSummaryText(null);
    setAiSummaryStatus('idle');
    if (!gameId?.trim()) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/betting/games/${encodeURIComponent(gameId)}/details`, {
          signal: ac.signal,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || body.error || `HTTP ${res.status}`);
        }
        const json = (await res.json()) as GameDetailsPayload;
        setData(json);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setData(null);
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [gameId]);

  const summaryBullets = useMemo(() => {
    if (!data) return [];
    return getGameSummaryBulletsForAi({
      matchupAnalysis: null,
      homeTeamStats: data.homeTeamStats,
      awayTeamStats: data.awayTeamStats,
      spreadMovement: data.spreadMovement,
      injuries: data.injuries,
    });
  }, [data]);

  useEffect(() => {
    if (!data) return;
    const payload: GameDetailsPayload = data;
    const ac = new AbortController();
    let cancelled = false;

    async function loadAi(d: GameDetailsPayload) {
      setAiSummaryStatus('loading');
      setAiSummaryText(null);
      const game = d.game;
      const gameRef = {
        homeTeam: { id: game.homeTeam.id, abbreviation: game.homeTeam.abbreviation },
        awayTeam: { id: game.awayTeam.id, abbreviation: game.awayTeam.abbreviation },
      };
      const bullets = getGameSummaryBulletsForAi({
        matchupAnalysis: null,
        homeTeamStats: d.homeTeamStats,
        awayTeamStats: d.awayTeamStats,
        spreadMovement: d.spreadMovement,
        injuries: d.injuries,
      });
      const oddsHint = formatOddsHintForAiSummary(d.currentOdds, gameRef);
      const supplemental = buildAiSupplementalLines(d.injuries, d.injuryMatchupContext, gameRef, null);
      const body: Record<string, unknown> = {
        homeTeamName: game.homeTeam.name,
        awayTeamName: game.awayTeam.name,
        bullets,
        oddsHint,
      };
      if (supplemental.injuryReportLines.length) body.injuryReportLines = supplemental.injuryReportLines;
      if (supplemental.usageShiftLines.length) body.usageShiftLines = supplemental.usageShiftLines;
      if (supplemental.expectedStarterLines.length) {
        body.expectedStarterLines = supplemental.expectedStarterLines;
      }
      if (d.injuryMatchupContext?.entries?.length) {
        const nar = buildInjuryContextNarrative(
          d.injuryMatchupContext,
          d.game.homeTeam.id,
          d.game.homeTeam.name,
          d.game.awayTeam.name
        );
        body.injuryIntro = nar.intro;
        body.injuryParagraphs = nar.paragraphs;
      }

      try {
        const res = await fetch(`/api/betting/games/${encodeURIComponent(game.id)}/ai-projection-summary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        const j = (await res.json().catch(() => ({}))) as { summary?: string; code?: string };
        if (cancelled) return;
        if (res.status === 503 && j?.code === 'NO_OPENAI_KEY') {
          setAiSummaryStatus('unavailable');
          return;
        }
        if (!res.ok) {
          setAiSummaryStatus('error');
          return;
        }
        const text = typeof j.summary === 'string' ? j.summary.trim() : '';
        if (text) {
          setAiSummaryText(text);
          setAiSummaryStatus('success');
        } else {
          setAiSummaryStatus('error');
        }
      } catch {
        if (ac.signal.aborted || cancelled) return;
        setAiSummaryStatus('error');
      }
    }

    void loadAi(payload);
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [data]);

  if (!gameId?.trim()) {
    return (
      <GameContextPlaceholder message="Choose a game from the filter above, or select a player in the table, to load the AI projection summary and split tables for that matchup." />
    );
  }

  if (loading && !data) {
    return (
      <div className="glass-card rounded-xl border border-white/5 overflow-hidden">
        <div className="px-3 py-2.5 border-b border-white/5 bg-white/[0.02] flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-[#bf5af2]/90 animate-spin shrink-0" aria-hidden />
          <h2 className="text-sm font-semibold text-white">AI Projection Summary</h2>
          <span className="text-[9px] px-1.5 py-0.5 bg-[#bf5af2]/20 text-[#bf5af2] rounded-full">Beta</span>
        </div>
        <div className="p-3 space-y-2 animate-pulse">
          <div className="h-3 bg-white/10 rounded w-3/4" />
          <div className="h-3 bg-white/10 rounded w-full" />
          <div className="h-3 bg-white/10 rounded w-5/6" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card rounded-xl border border-white/5 overflow-hidden border-l-4 border-l-amber-500/50">
        <div className="px-3 py-2.5 border-b border-white/5 bg-white/[0.02] flex items-center gap-2">
          <LayoutGrid className="w-4 h-4 text-amber-400/90 shrink-0" aria-hidden />
          <h2 className="text-sm font-semibold text-white">AI Projection Summary</h2>
        </div>
        <p className="p-3 text-[11px] text-amber-200/90">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { game, injuryMatchupContext, injuries } = data;
  const matchupLabel = `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`;
  const hasSplitTables = Boolean(injuryMatchupContext.entries?.length);

  return (
    <div className="glass-card rounded-xl border border-[#bf5af2]/25 overflow-hidden flex flex-col max-h-[min(28rem,52vh)]">
      <div className="px-3 py-2.5 border-b border-white/5 bg-white/[0.02] shrink-0 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center justify-center p-1 rounded-md bg-[#bf5af2]/20 shrink-0">
              <Zap className="w-3.5 h-3.5 text-[#bf5af2]" aria-hidden />
            </div>
            <h2 className="text-sm font-semibold text-white">AI Projection Summary</h2>
            <span className="text-[9px] px-1.5 py-0.5 bg-[#bf5af2]/20 text-[#bf5af2] rounded-full">Beta</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 truncate" title={matchupLabel}>
            {matchupLabel}
            {game.startTime ? ` · ${game.startTime}` : ''}
          </p>
          <p className="text-[10px] text-muted-foreground/80 mt-0.5">
            {game.awayTeam.record} — {game.homeTeam.record}
          </p>
        </div>
        <Link
          href={`/betting/games/${game.id}`}
          className="text-[10px] text-[#00d4ff] hover:underline shrink-0 pt-0.5"
        >
          Full matchup
        </Link>
      </div>

      <div className="p-2.5 sm:p-3 overflow-y-auto flex-1 min-h-0 space-y-3 text-[11px] leading-relaxed">
        {summaryBullets.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {summaryBullets.slice(0, 4).map((label, i) => {
              const isPace = /pace|fast|slow|avg/i.test(label);
              const isLine = /line|moved/i.test(label);
              const isInjury = /injur|listed/i.test(label);
              const Icon = isPace ? Zap : isLine ? TrendingUp : isInjury ? AlertTriangle : TrendingUp;
              return (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[9px] bg-white/10 text-muted-foreground border border-white/5"
                >
                  <Icon className="w-3 h-3 shrink-0 opacity-80" aria-hidden />
                  <span className="leading-tight">{label}</span>
                </span>
              );
            })}
          </div>
        ) : null}

        {aiSummaryStatus === 'loading' && (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-[#bf5af2]/90" aria-hidden />
            <span>Generating summary…</span>
          </div>
        )}
        {aiSummaryStatus === 'success' && aiSummaryText && (
          <p className="text-[11px] text-white/90 leading-relaxed border-l-2 border-[#bf5af2]/35 pl-2.5">
            {aiSummaryText}
          </p>
        )}
        {aiSummaryStatus === 'unavailable' && (
          <p className="text-[10px] text-muted-foreground">
            Add <span className="font-mono text-white/70">OPENAI_API_KEY</span> on the server for the AI-written
            summary (same as full matchup page).
          </p>
        )}
        {aiSummaryStatus === 'error' && (
          <p className="text-[10px] text-amber-400/90">Could not load AI summary. Try again later.</p>
        )}

        <UnderlyingNumbersBlock injuryMatchupContext={injuryMatchupContext} game={game} />

        {!hasSplitTables ? (
          <div className="space-y-2 pt-1 border-t border-white/5">
            <p className="text-[10px] text-muted-foreground">
              No Out/Doubtful teammate split snapshot yet. Injury report:
            </p>
            {injuries && (injuries.home.length > 0 || injuries.away.length > 0) ? (
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2 space-y-2">
                {injuries.away.length > 0 ? (
                  <div>
                    <p className="text-[10px] font-medium text-white/90 mb-1">{game.awayTeam.abbreviation}</p>
                    <ul className="text-[10px] text-muted-foreground space-y-0.5">
                      {injuries.away.map((r) => (
                        <li key={r.player}>
                          {r.player} <span className="text-white/70">({r.status})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {injuries.home.length > 0 ? (
                  <div>
                    <p className="text-[10px] font-medium text-white/90 mb-1">{game.homeTeam.abbreviation}</p>
                    <ul className="text-[10px] text-muted-foreground space-y-0.5">
                      {injuries.home.map((r) => (
                        <li key={r.player}>
                          {r.player} <span className="text-white/70">({r.status})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground">No injuries listed for this game.</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
