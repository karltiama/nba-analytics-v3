'use client';

import { cn } from '@/lib/utils';
import type { MetricKey } from '@/lib/players/types';
import { METRIC_LABELS } from '@/lib/players/types';

const TABS: MetricKey[] = ['pts', 'reb', 'ast', '3pm', 'pra'];

interface StatTabsProps {
  activeMetric: MetricKey;
  onMetricChange: (key: MetricKey) => void;
}

export function StatTabs({ activeMetric, onMetricChange }: StatTabsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {TABS.map((key) => (
        <button
          key={key}
          onClick={() => onMetricChange(key)}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all',
            activeMetric === key
              ? 'bg-[#00d4ff] text-black shadow-[0_0_16px_rgba(0,212,255,0.5)] font-semibold'
              : 'glass-card text-muted-foreground hover:text-white hover:bg-white/10'
          )}
        >
          {METRIC_LABELS[key]}
        </button>
      ))}
    </div>
  );
}
