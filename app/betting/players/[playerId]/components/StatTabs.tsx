'use client';

import { cn } from '@/lib/utils';
import type { MetricKey } from '@/lib/players/types';
import { METRIC_LABELS } from '@/lib/players/types';

const TABS: MetricKey[] = ['pts', 'reb', 'ast', '3pm', 'pra'];

interface StatTabsProps {
  activeMetric: MetricKey;
  onMetricChange: (key: MetricKey) => void;
}

export function StatTabs({
  activeMetric,
  onMetricChange,
  scrollable = false,
}: StatTabsProps & { scrollable?: boolean }) {
  return (
    <div className={scrollable ? 'flex gap-2 overflow-x-auto' : 'flex flex-wrap gap-2'}>
      {TABS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onMetricChange(key)}
          className={cn(
            'rounded-lg transition-all',
            scrollable
              ? 'type-interactive min-h-11 shrink-0 whitespace-nowrap px-3'
              : 'px-4 py-2 text-sm font-medium',
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
