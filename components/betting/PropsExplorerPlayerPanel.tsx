'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, X } from 'lucide-react';
import { StatTabs } from '@/app/betting/players/[playerId]/components/StatTabs';
import { PlayerTrendChart } from '@/app/betting/players/[playerId]/components/PlayerTrendChart';
import { GameLogTable } from '@/app/betting/players/[playerId]/components/GameLogTable';
import type { GameLog, MetricKey, PlayerProfile, SeasonAverages } from '@/lib/players/types';
import { METRIC_LABELS, propTypeToMetricKey } from '@/lib/players/types';
import { extractMetric, getSeasonAvgForMetric } from '@/lib/players/metrics';

const PREVIEW_GAMES = 25;
const CHART_GAMES = 20;

export type PropsExplorerSelection = {
  playerId: number;
  playerName: string | null;
  propType: string | null;
  lineValue: number | null;
  /** NBA game id for loading sidebar game context alongside the player preview. */
  gameId: number;
};

type PreviewResponse = {
  player: PlayerProfile;
  seasonAverages: SeasonAverages;
  games: GameLog[];
  resolvedPlayerId: string;
};

const skeletonPulse = 'animate-pulse bg-white/10 rounded';

/** Stat tabs + chart + game log blocks (shared by empty shell and loading state). */
function PropsExplorerPlayerPanelBodySkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={`h-8 w-14 sm:w-16 ${skeletonPulse} bg-white/[0.08]`} />
        ))}
      </div>
      <div className="rounded-xl overflow-hidden border border-white/5">
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-white/[0.02]">
          <div className={`h-3 w-20 ${skeletonPulse} bg-white/5`} />
          <div className="flex gap-2">
            <div className={`h-2 w-12 ${skeletonPulse} bg-white/5`} />
            <div className={`h-2 w-12 ${skeletonPulse} bg-white/5`} />
          </div>
        </div>
        <div className="p-3 h-[180px] bg-white/[0.02] flex items-end">
          <div
            className="w-full h-[85%] rounded-md bg-gradient-to-t from-white/[0.07] via-white/[0.12] to-white/[0.06] animate-pulse"
            style={{
              clipPath:
                'polygon(0% 85%, 8% 70%, 18% 78%, 28% 45%, 38% 52%, 48% 30%, 58% 38%, 68% 22%, 78% 35%, 88% 18%, 100% 28%, 100% 100%, 0% 100%)',
            }}
          />
        </div>
      </div>
      <div className="rounded-xl border border-white/5 overflow-hidden border-l-4 border-l-white/10">
        <div className="h-9 px-3 flex items-center justify-between border-b border-white/5 bg-white/[0.02]">
          <div className={`h-3 w-16 ${skeletonPulse} bg-white/5`} />
          <div className={`h-5 w-14 rounded-full ${skeletonPulse} bg-white/5`} />
        </div>
        <div className="p-2 space-y-2.5">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`h-3 w-10 ${skeletonPulse} bg-white/5`} />
              <div className={`h-3 flex-1 ${skeletonPulse}`} />
              <div className={`h-3 w-6 ${skeletonPulse} bg-white/5`} />
              <div className={`h-3 w-8 ${skeletonPulse} bg-white/5`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Full aside placeholder: header shimmer + body skeleton (empty selection). */
export function PropsExplorerPlayerPanelSkeleton() {
  return (
    <div className="glass-card rounded-xl border border-white/5 overflow-hidden flex flex-col max-h-[calc(100vh-5rem)] xl:max-h-full xl:min-h-0 xl:flex-1">
      <div className="px-3 py-2.5 border-b border-white/5 bg-white/[0.02] shrink-0">
        <div className={`h-4 w-36 ${skeletonPulse}`} />
        <div className={`h-3 w-28 mt-2 ${skeletonPulse} bg-white/5`} />
      </div>
      <div
        className="p-2.5 sm:p-3 space-y-3 flex-1 min-h-0 overflow-hidden"
        aria-label="Player preview. Choose a player from the table."
      >
        <PropsExplorerPlayerPanelBodySkeleton />
        <p className="text-[10px] text-center text-muted-foreground/80 pt-0.5">Select a player in the table</p>
      </div>
    </div>
  );
}

interface PropsExplorerPlayerPanelProps {
  selection: PropsExplorerSelection;
  onClose: () => void;
  variant: 'sidebar' | 'drawer';
}

export function PropsExplorerPlayerPanel({ selection, onClose, variant }: PropsExplorerPlayerPanelProps) {
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeMetric, setActiveMetric] = useState<MetricKey>(() => propTypeToMetricKey(selection.propType));

  const rowMetric = useMemo(() => propTypeToMetricKey(selection.propType), [selection.propType]);

  useEffect(() => {
    setActiveMetric(propTypeToMetricKey(selection.propType));
  }, [selection.playerId, selection.propType]);

  const fetchPreview = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const u = new URL(
          `/api/betting/players/${selection.playerId}/game-log-preview`,
          window.location.origin
        );
        u.searchParams.set('limit', String(PREVIEW_GAMES));
        const res = await fetch(u.toString(), { signal });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || body.error || `HTTP ${res.status}`);
        }
        const json = (await res.json()) as PreviewResponse;
        setData(json);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setData(null);
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    },
    [selection.playerId]
  );

  useEffect(() => {
    const ac = new AbortController();
    fetchPreview(ac.signal);
    return () => ac.abort();
  }, [fetchPreview]);

  const games = data?.games ?? [];
  const gamesForChart = useMemo(
    () => games.filter((g) => (g.minutes ?? 0) > 0).slice(0, CHART_GAMES),
    [games]
  );
  const values = useMemo(() => extractMetric(gamesForChart, activeMetric), [gamesForChart, activeMetric]);
  const chartLabels = useMemo(() => gamesForChart.map((g) => g.opponent_abbr || '???'), [gamesForChart]);
  const chartDataChronological = useMemo(() => [...values].reverse(), [values]);
  const chartLabelsChronological = useMemo(() => [...chartLabels].reverse(), [chartLabels]);
  const seasonAvgValue = useMemo(() => {
    if (!data?.seasonAverages) return 0;
    return getSeasonAvgForMetric(data.seasonAverages, activeMetric);
  }, [data?.seasonAverages, activeMetric]);

  const bettingLine =
    activeMetric === rowMetric && selection.lineValue != null && Number.isFinite(selection.lineValue)
      ? selection.lineValue
      : null;

  const displayName =
    (selection.playerName ?? '').trim() || data?.player?.full_name || String(selection.playerId);
  const profileId = data?.resolvedPlayerId ?? String(selection.playerId);

  const inner = (
    <div
      className={
        variant === 'drawer'
          ? 'glass-card rounded-xl border border-white/10 overflow-hidden flex flex-col h-full max-h-[calc(100dvh-1.5rem)]'
          : 'glass-card rounded-xl border border-white/5 overflow-hidden flex flex-col max-h-[calc(100vh-5rem)] xl:max-h-full xl:min-h-0 xl:flex-1'
      }
    >
      <div className="px-3 py-2.5 border-b border-white/5 bg-white/[0.02] flex items-start justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white truncate">{displayName}</h2>
          <Link
            href={`/betting/players/${profileId}`}
            className="inline-flex items-center gap-1 text-[11px] text-[#00d4ff] hover:underline mt-0.5"
          >
            Full profile
            <ExternalLink className="w-3 h-3 shrink-0 opacity-70" />
          </Link>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 shrink-0"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-2.5 sm:p-3 overflow-y-auto flex-1 min-h-0 space-y-3">
        {loading && (
          <div aria-busy="true" aria-label="Loading player stats">
            <PropsExplorerPlayerPanelBodySkeleton />
          </div>
        )}
        {error && !loading && (
          <p className="text-xs text-[#ff4757] py-4 text-center">{error}</p>
        )}
        {!loading && !error && data && (
          <>
            <div className="[&_button]:px-2 [&_button]:py-1.5 [&_button]:text-xs">
              <StatTabs activeMetric={activeMetric} onMetricChange={setActiveMetric} />
            </div>
            <PlayerTrendChart
              data={chartDataChronological}
              seasonAvg={seasonAvgValue}
              labels={chartLabelsChronological}
              bettingLine={bettingLine}
              metricLabel={METRIC_LABELS[activeMetric]}
              svgWidth={340}
              chartHeight={180}
              compactTrend
            />
            <div className="max-h-56 overflow-y-auto rounded-xl border border-white/5">
              <GameLogTable
                games={games}
                activeMetric={activeMetric}
                bettingLine={bettingLine}
                compact
              />
            </div>
          </>
        )}
      </div>
    </div>
  );

  if (variant === 'drawer') {
    return (
      <div className="fixed inset-0 z-50 xl:hidden" role="dialog" aria-modal="true">
        <button
          type="button"
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          aria-label="Dismiss"
          onClick={onClose}
        />
        <div className="absolute inset-y-0 right-0 w-full max-w-md flex flex-col p-2 sm:p-3 border-l border-white/10 bg-background/95 backdrop-blur-md shadow-2xl">
          <div className="flex-1 min-h-0 flex flex-col">{inner}</div>
        </div>
      </div>
    );
  }

  return inner;
}

export function PropsExplorerPlayerSidebarPlaceholder() {
  return <PropsExplorerPlayerPanelSkeleton />;
}
