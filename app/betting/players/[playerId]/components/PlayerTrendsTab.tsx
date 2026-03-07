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

type Timeframe = 5 | 10 | 20 | 'season';
type LocationFilter = 'all' | 'home' | 'away';

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: 5, label: 'L5' },
  { value: 10, label: 'L10' },
  { value: 20, label: 'L20' },
  { value: 'season', label: 'Season' },
];
const LOCATION_OPTIONS: { value: LocationFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'home', label: 'Home' },
  { value: 'away', label: 'Away' },
];

export interface PlayerTrendsTabProps {
  games: GameLog[];
  seasonAverages: SeasonAverages;
}

export function PlayerTrendsTab({ games, seasonAverages }: PlayerTrendsTabProps) {
  const [activeMetric, setActiveMetric] = useState<MetricKey>('pts');
  const [bettingLine, setBettingLine] = useState<number | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>(20);
  const [locationFilter, setLocationFilter] = useState<LocationFilter>('all');

  const gamesByLocation = useMemo(
    () =>
      locationFilter === 'all'
        ? games
        : games.filter((g) => g.location === locationFilter),
    [games, locationFilter]
  );

  const filteredGames = useMemo(
    () => (timeframe === 'season' ? gamesByLocation : gamesByLocation.slice(0, timeframe)),
    [gamesByLocation, timeframe]
  );

  const gamesForChart = useMemo(
    () => filteredGames.filter((g) => (g.minutes ?? 0) > 0),
    [filteredGames]
  );

  const values = useMemo(() => extractMetric(gamesForChart, activeMetric), [gamesForChart, activeMetric]);
  const seasonAvgValue = useMemo(() => {
    if (values.length > 0) {
      return values.reduce((a, b) => a + b, 0) / values.length;
    }
    return getSeasonAvgForMetric(seasonAverages, activeMetric);
  }, [values, seasonAverages, activeMetric]);
  const summary = useMemo(() => summaryStats(values), [values]);
  const chartLabels = useMemo(() => gamesForChart.map((g) => g.opponent_abbr || '???'), [gamesForChart]);

  const chartDataChronological = useMemo(() => [...values].reverse(), [values]);
  const chartLabelsChronological = useMemo(() => [...chartLabels].reverse(), [chartLabels]);

  const timeframeLabel =
    timeframe === 'season' ? `${gamesByLocation.length} games` : `last ${timeframe} games`;

  return (
    <div className="flex flex-col gap-6">
      <section className="space-y-4">
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
          <StatTabs
            activeMetric={activeMetric}
            onMetricChange={(key) => {
              setActiveMetric(key);
              setBettingLine(null);
            }}
          />
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
          <div className="h-6 w-px bg-white/10 hidden sm:block" />
          <div className="flex gap-1.5">
            {LOCATION_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setLocationFilter(value)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                  locationFilter === value
                    ? 'bg-[#bf5af2] text-white shadow-[0_0_12px_rgba(191,90,242,0.4)] font-semibold'
                    : 'glass-card text-muted-foreground hover:text-white hover:bg-white/10'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <SummaryCardsRow summary={summary} metricLabel={METRIC_LABELS[activeMetric]} timeframe={timeframe} />
      </section>

      <section className="slide-up" style={{ animationDelay: '50ms' }}>
        <PlayerTrendChart
          data={chartDataChronological}
          seasonAvg={seasonAvgValue}
          labels={chartLabelsChronological}
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
    </div>
  );
}
