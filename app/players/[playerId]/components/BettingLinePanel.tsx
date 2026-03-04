// HOW TO EXTEND: Odds overlay
// 1. Add an optional `bookLine?: number` prop from the markets table
// 2. Pass it as the default value for the line input
// 3. Add a "Book Line" badge next to the input
// 4. Compare user-entered line vs book line to show edge
// 5. Wire up to GET /api/players/[playerId]/odds when ETL populates markets

'use client';

import { cn } from '@/lib/utils';
import { hitRate, avgMargin, streak } from '@/lib/players/metrics';
import type { MetricKey } from '@/lib/players/types';
import { METRIC_LABELS } from '@/lib/players/types';

interface BettingLinePanelProps {
  values: number[];
  bettingLine: number | null;
  onLineChange: (line: number | null) => void;
  metricKey: MetricKey;
}

export function BettingLinePanel({ values, bettingLine, onLineChange, metricKey }: BettingLinePanelProps) {
  const hr = bettingLine !== null ? hitRate(values, bettingLine) : null;
  const margin = bettingLine !== null ? avgMargin(values, bettingLine) : null;
  const stk = bettingLine !== null ? streak(values, bettingLine) : null;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3">
        Betting Line Analysis
      </h3>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="text-sm text-zinc-600 dark:text-zinc-400">
          {METRIC_LABELS[metricKey]} Line:
        </label>
        <input
          type="number"
          step="0.5"
          min="0"
          value={bettingLine ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            onLineChange(val === '' ? null : parseFloat(val));
          }}
          placeholder="e.g. 24.5"
          className={cn(
            'w-28 px-3 py-1.5 rounded-md text-sm font-mono',
            'bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700',
            'focus:outline-none focus:ring-2 focus:ring-neon-cyan focus:border-transparent'
          )}
        />
        {bettingLine !== null && (
          <button
            onClick={() => onLineChange(null)}
            className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Clear
          </button>
        )}
      </div>

      {bettingLine !== null && hr && margin !== null && stk ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCell
            label="Hit Rate L10"
            value={`${hr.last10.toFixed(0)}%`}
            accent={hr.last10 >= 60}
            warn={hr.last10 < 40}
          />
          <StatCell
            label="Hit Rate L20"
            value={`${hr.last20.toFixed(0)}%`}
            accent={hr.last20 >= 60}
            warn={hr.last20 < 40}
          />
          <StatCell
            label="Avg Margin"
            value={`${margin > 0 ? '+' : ''}${margin.toFixed(1)}`}
            accent={margin > 0}
            warn={margin < 0}
          />
          <StatCell
            label="Current Streak"
            value={`${stk.count} ${stk.type}`}
            accent={stk.type === 'over'}
            warn={stk.type === 'under' && stk.count >= 3}
          />
        </div>
      ) : (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">
          Enter a line above to see hit rate, margin, and streak analysis.
        </p>
      )}
    </div>
  );
}

function StatCell({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
        {label}
      </div>
      <div
        className={cn(
          'text-xl font-bold font-mono',
          accent && 'text-green-600 dark:text-[#39ff14]',
          warn && 'text-red-500 dark:text-[#ff4757]',
          !accent && !warn && 'text-foreground'
        )}
      >
        {value}
      </div>
    </div>
  );
}
