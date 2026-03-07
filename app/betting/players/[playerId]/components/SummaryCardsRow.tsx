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
  { key: 'high', label: 'Season High', accent: 'text-[#39ff14]' },
  { key: 'low', label: 'Season Low', accent: 'text-[#ff4757]' },
];

export function SummaryCardsRow({ summary, metricLabel }: SummaryCardsRowProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-1 gap-3">
      {CARDS.map(({ key, label, accent }, index) => {
        const val = summary[key];
        const diff = key !== 'avg' && key !== 'high' && key !== 'low'
          ? val - summary.avg
          : null;

        return (
          <div
            key={key}
            className="glass-card rounded-xl p-4 card-hover slide-up"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest">
                {label}
              </div>
              <div className="text-[10px] text-muted-foreground/60">{metricLabel}</div>
            </div>
            <div className="flex items-baseline justify-between mt-1.5">
              <div className={cn('text-2xl font-bold font-mono', accent ?? 'text-white')}>
                {val.toFixed(1)}
              </div>
              {diff !== null && (
                <div
                  className={cn(
                    'text-xs font-medium font-mono',
                    diff > 0 ? 'text-[#39ff14]' : diff < 0 ? 'text-[#ff4757]' : 'text-muted-foreground'
                  )}
                >
                  {diff > 0 ? '+' : ''}{diff.toFixed(1)} vs avg
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
