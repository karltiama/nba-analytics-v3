'use client';

import { useState, useMemo } from 'react';
import type { GameLog, MetricKey, SeasonAverages } from '@/lib/players/types';
import { METRIC_LABELS } from '@/lib/players/types';
import { extractMetric, getSeasonAvgForMetric, summaryStats } from '@/lib/players/metrics';
import { StatTabs } from './StatTabs';
import { PlayerTrendChart } from './PlayerTrendChart';
import { SummaryCardsRow } from './SummaryCardsRow';
import { BettingLinePanel } from './BettingLinePanel';
import { GameLogTable } from './GameLogTable';

interface PlayerAnalysisClientProps {
  games: GameLog[];
  seasonAverages: SeasonAverages;
}

export function PlayerAnalysisClient({ games, seasonAverages }: PlayerAnalysisClientProps) {
  const [activeMetric, setActiveMetric] = useState<MetricKey>('pts');
  const [bettingLine, setBettingLine] = useState<number | null>(null);

  const values = useMemo(() => extractMetric(games, activeMetric), [games, activeMetric]);
  const seasonAvgValue = useMemo(() => getSeasonAvgForMetric(seasonAverages, activeMetric), [seasonAverages, activeMetric]);
  const summary = useMemo(() => summaryStats(values), [values]);
  const chartLabels = useMemo(() => games.map((g) => g.opponent_abbr || '???'), [games]);

  return (
    <div className="space-y-6">
      {/* Metric Selector */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">Player Trends</h2>
          <span className="text-[10px] px-2 py-0.5 bg-[#00d4ff]/20 text-[#00d4ff] rounded-full font-medium">
            {METRIC_LABELS[activeMetric]}
          </span>
        </div>
        <StatTabs activeMetric={activeMetric} onMetricChange={(key) => { setActiveMetric(key); setBettingLine(null); }} />
      </section>

      {/* Chart */}
      <section className="slide-up" style={{ animationDelay: '50ms' }}>
        <PlayerTrendChart
          data={values}
          seasonAvg={seasonAvgValue}
          labels={chartLabels}
          bettingLine={bettingLine}
          metricLabel={METRIC_LABELS[activeMetric]}
        />
      </section>

      {/* Summary Cards */}
      <section className="slide-up" style={{ animationDelay: '100ms' }}>
        <SummaryCardsRow summary={summary} metricLabel={METRIC_LABELS[activeMetric]} />
      </section>

      {/* Betting Line */}
      <section className="slide-up" style={{ animationDelay: '150ms' }}>
        <BettingLinePanel
          values={values}
          bettingLine={bettingLine}
          onLineChange={setBettingLine}
          metricKey={activeMetric}
        />
      </section>

      {/* Game Log */}
      <section className="slide-up" style={{ animationDelay: '200ms' }}>
        <GameLogTable games={games} activeMetric={activeMetric} bettingLine={bettingLine} />
      </section>
    </div>
  );
}
