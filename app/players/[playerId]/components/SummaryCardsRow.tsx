import { cn } from '@/lib/utils';
import type { SummaryResult } from '@/lib/players/types';

interface SummaryCardsRowProps {
  summary: SummaryResult;
  metricLabel: string;
}

const CARDS: { key: keyof SummaryResult; label: string; accent?: string }[] = [
  { key: 'avg', label: 'Season Avg' },
  { key: 'last10', label: 'Last 10' },
  { key: 'last5', label: 'Last 5' },
  { key: 'high', label: 'High', accent: 'text-green-500 dark:text-[#39ff14]' },
  { key: 'low', label: 'Low', accent: 'text-red-500 dark:text-[#ff4757]' },
];

export function SummaryCardsRow({ summary, metricLabel }: SummaryCardsRowProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {CARDS.map(({ key, label, accent }) => {
        const val = summary[key];
        const diff = key !== 'avg' && key !== 'high' && key !== 'low'
          ? val - summary.avg
          : null;

        return (
          <div
            key={key}
            className={cn(
              'rounded-lg border p-4 transition-all',
              'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800',
              'hover:border-zinc-300 dark:hover:border-zinc-700'
            )}
          >
            <div className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
              {label}
            </div>
            <div className={cn('text-2xl font-bold', accent)}>
              {val.toFixed(1)}
            </div>
            {diff !== null && (
              <div
                className={cn(
                  'text-xs mt-1 font-medium',
                  diff > 0
                    ? 'text-green-600 dark:text-green-400'
                    : diff < 0
                    ? 'text-red-500 dark:text-red-400'
                    : 'text-zinc-400'
                )}
              >
                {diff > 0 ? '+' : ''}{diff.toFixed(1)} vs avg
              </div>
            )}
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">{metricLabel}</div>
          </div>
        );
      })}
    </div>
  );
}
