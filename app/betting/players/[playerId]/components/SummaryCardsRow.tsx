import { cn } from '@/lib/utils';
import type { SummaryResult } from '@/lib/players/types';
import {
  formatNullableStat,
  formatStatDiffVsAvg,
  hasSummarySample,
} from '@/lib/players/stat-display';

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
  { key: 'high', accent: 'text-[#20B95A]' },
  { key: 'low', accent: 'text-[#c2410c]' },
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
  if (!hasSummarySample(summary)) {
    return (
      <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-4">
        <p className="text-sm text-[#4a6366]">Not enough data yet</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {CARD_KEYS.map(({ key, accent }) => {
        const label = getCardLabel(key, timeframe);
        const val = summary[key];
        const diffLabel =
          key !== 'avg' && key !== 'high' && key !== 'low'
            ? formatStatDiffVsAvg(val, summary.avg)
            : null;

        return (
          <div
            key={key}
            className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-4"
          >
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-[#4a6366] uppercase tracking-widest">
                {label}
              </div>
              <div className="text-[10px] text-[#8aa0a3]">{metricLabel}</div>
            </div>
            <div className="flex items-baseline justify-between mt-1.5">
              <div className={cn('text-2xl font-bold font-mono', accent ?? 'text-[#063f46]')}>
                {formatNullableStat(val)}
              </div>
              {diffLabel !== null && (
                <div
                  className={cn(
                    'text-xs font-medium font-mono',
                    val != null && summary.avg != null && val - summary.avg > 0
                      ? 'text-[#20B95A]'
                      : val != null && summary.avg != null && val - summary.avg < 0
                        ? 'text-[#c2410c]'
                        : 'text-[#4a6366]'
                  )}
                >
                  {diffLabel}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
