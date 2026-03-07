'use client';

import { useState } from 'react';
import type { GameLog, MetricKey } from '@/lib/players/types';
import { StatTabs } from './StatTabs';
import { GameLogTable } from './GameLogTable';

export interface PlayerGameLogTabProps {
  games: GameLog[];
}

export function PlayerGameLogTab({ games }: PlayerGameLogTabProps) {
  const [activeMetric, setActiveMetric] = useState<MetricKey>('pts');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Highlight column:</span>
        <StatTabs activeMetric={activeMetric} onMetricChange={setActiveMetric} />
      </div>
      <GameLogTable games={games} activeMetric={activeMetric} bettingLine={null} />
    </div>
  );
}
