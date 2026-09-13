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
              ? 'bg-[#55ddb1] text-[#063f46] font-semibold'
              : 'bg-white border border-[#DCE9EA] text-[#4a6366] hover:text-[#063f46] hover:bg-[#f7f9f7]'
          )}
        >
          {METRIC_LABELS[key]}
        </button>
      ))}
    </div>
  );
}
