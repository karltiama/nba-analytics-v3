'use client';

import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { GameLog, MetricKey, SeasonAverages } from '@/lib/players/types';
import { METRIC_LABELS } from '@/lib/players/types';
import { extractMetric, getSeasonAvgForMetric, summaryStats } from '@/lib/players/metrics';
import { StatTabs } from './StatTabs';
import { PlayerTrendChart } from './PlayerTrendChart';
import { SummaryCardsRow } from './SummaryCardsRow';
import { BettingLinePanel } from './BettingLinePanel';
import { GameLogTable } from './GameLogTable';

type Timeframe = 5 | 10 | 20 | 'season';
const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: 5, label: 'L5' },
  { value: 10, label: 'L10' },
  { value: 20, label: 'L20' },
  { value: 'season', label: 'Season' },
];

interface PlayerAnalysisClientProps {
  games: GameLog[];
  seasonAverages: SeasonAverages;
}

export function PlayerAnalysisClient({ games, seasonAverages }: PlayerAnalysisClientProps) {
  const [activeMetric, setActiveMetric] = useState<MetricKey>('pts');
  const [bettingLine, setBettingLine] = useState<number | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>(20);

  const filteredGames = useMemo(
    () => (timeframe === 'season' ? games : games.slice(0, timeframe)),
    [games, timeframe]
  );

  const values = useMemo(() => extractMetric(filteredGames, activeMetric), [filteredGames, activeMetric]);
  const seasonAvgValue = useMemo(() => getSeasonAvgForMetric(seasonAverages, activeMetric), [seasonAverages, activeMetric]);
  const summary = useMemo(() => summaryStats(values), [values]);
  const chartLabels = useMemo(() => filteredGames.map((g) => g.opponent_abbr || '???'), [filteredGames]);

  const timeframeLabel = timeframe === 'season' ? `${games.length} games` : `last ${timeframe} games`;

  return (
    <div className="flex flex-col 2xl:flex-row gap-6">
      {/* Main Content */}
      <div className="flex-1 space-y-6 min-w-0">
        {/* Metric Selector + Timeframe */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Player Trends</h2>
              <p className="text-xs text-muted-foreground">Performance breakdown across {timeframeLabel}</p>
            </div>
            <span className="text-[10px] px-2 py-1 bg-[#00d4ff]/20 text-[#00d4ff] rounded-full font-medium">
              {METRIC_LABELS[activeMetric]}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatTabs activeMetric={activeMetric} onMetricChange={(key) => { setActiveMetric(key); setBettingLine(null); }} />
            <div className="h-6 w-px bg-white/10 hidden sm:block" />
            <div className="flex gap-1.5">
              {TIMEFRAMES.map(({ value, label }) => (
                <button
                  key={label}
                  onClick={() => setTimeframe(value)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                    timeframe === value
                      ? 'bg-[#bf5af2] text-white shadow-[0_0_12px_rgba(191,90,242,0.4)] font-semibold'
                      : 'glass-card text-muted-foreground hover:text-white hover:bg-white/10'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Chart + Line Analysis (side-by-side on xl+, stacked on smaller) */}
        <section className="slide-up" style={{ animationDelay: '50ms' }}>
          <PlayerTrendChart
            data={values}
            seasonAvg={seasonAvgValue}
            labels={chartLabels}
            bettingLine={bettingLine}
            metricLabel={METRIC_LABELS[activeMetric]}
          >
            <BettingLinePanel
              values={values}
              bettingLine={bettingLine}
              onLineChange={setBettingLine}
              metricKey={activeMetric}
              embedded
            />
          </PlayerTrendChart>
        </section>

        {/* Game Log */}
        <section className="slide-up" style={{ animationDelay: '150ms' }}>
          <GameLogTable games={filteredGames} activeMetric={activeMetric} bettingLine={bettingLine} />
        </section>
      </div>

      {/* Sidebar */}
      <aside className="w-full 2xl:w-80 shrink-0">
        <div className="sticky top-20 space-y-6">
          {/* Statistical Summary */}
          <section className="slide-up" style={{ animationDelay: '100ms' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Statistical Summary</h2>
              <span className="text-[10px] px-2 py-0.5 bg-[#bf5af2]/20 text-[#bf5af2] rounded-full font-medium">
                DATA-DRIVEN
              </span>
            </div>
            <SummaryCardsRow summary={summary} metricLabel={METRIC_LABELS[activeMetric]} />
          </section>
        </div>
      </aside>
    </div>
  );
}
