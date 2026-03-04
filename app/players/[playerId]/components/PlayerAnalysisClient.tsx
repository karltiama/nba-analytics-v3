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
    <div className="space-y-5">
      <StatTabs activeMetric={activeMetric} onMetricChange={(key) => { setActiveMetric(key); setBettingLine(null); }} />

      <PlayerTrendChart
        data={values}
        seasonAvg={seasonAvgValue}
        labels={chartLabels}
        bettingLine={bettingLine}
        metricLabel={METRIC_LABELS[activeMetric]}
      />

      <SummaryCardsRow summary={summary} metricLabel={METRIC_LABELS[activeMetric]} />

      <BettingLinePanel
        values={values}
        bettingLine={bettingLine}
        onLineChange={setBettingLine}
        metricKey={activeMetric}
      />

      <GameLogTable games={games} activeMetric={activeMetric} bettingLine={bettingLine} />
    </div>
  );
}
