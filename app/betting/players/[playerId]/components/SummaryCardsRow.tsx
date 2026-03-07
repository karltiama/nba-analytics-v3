import { cn } from '@/lib/utils';
import type { SummaryResult } from '@/lib/players/types';

type TimeframeKey = 5 | 10 | 20 | 'season';

interface SummaryCardsRowProps {
  summary: SummaryResult;
  metricLabel: string;
  timeframe?: TimeframeKey;
}

const CARD_KEYS: { key: keyof SummaryResult; accent?: string }[] = [
  { key: 'avg' },
  { key: 'last10' },
  { key: 'last5' },
  { key: 'high', accent: 'text-[#39ff14]' },
  { key: 'low', accent: 'text-[#ff4757]' },
];

function getCardLabel(key: keyof SummaryResult, timeframe: TimeframeKey): string {
  const periodLabel = timeframe === 'season' ? 'Season' : `L${timeframe}`;
  switch (key) {
    case 'avg':
      return `${periodLabel} Avg`;
    case 'last10':
      return 'Last 10';
    case 'last5':
      return 'Last 5';
    case 'high':
      return `${periodLabel} High`;
    case 'low':
      return `${periodLabel} Low`;
    default:
      return String(key);
  }
}

export function SummaryCardsRow({ summary, metricLabel, timeframe = 'season' }: SummaryCardsRowProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {CARD_KEYS.map(({ key, accent }, index) => {
        const label = getCardLabel(key, timeframe);
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
