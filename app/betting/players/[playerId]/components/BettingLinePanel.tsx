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
  embedded?: boolean;
}

export function BettingLinePanel({ values, bettingLine, onLineChange, metricKey, embedded }: BettingLinePanelProps) {
  const hr = bettingLine !== null ? hitRate(values, bettingLine) : null;
  const margin = bettingLine !== null ? avgMargin(values, bettingLine) : null;
  const stk = bettingLine !== null ? streak(values, bettingLine) : null;

  const content = (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="text-sm text-muted-foreground">
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
          placeholder="24.5"
          className={cn(
            'w-28 px-3 py-1.5 rounded-lg text-sm font-mono',
            'bg-white/5 border border-white/10 text-white placeholder:text-muted-foreground/50',
            'focus:outline-none focus:ring-2 focus:ring-[#00d4ff]/50 focus:border-[#00d4ff]/30'
          )}
        />
        {bettingLine !== null && (
          <button
            onClick={() => onLineChange(null)}
            className="text-xs text-muted-foreground hover:text-white transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {bettingLine !== null && hr && margin !== null && stk ? (
        <div className={cn('grid gap-3', 'grid-cols-4')}>
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
            label="Streak"
            value={`${stk.count} ${stk.type}`}
            accent={stk.type === 'over'}
            warn={stk.type === 'under' && stk.count >= 3}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground/60">
          Enter a line above to see hit rate, margin, and streak analysis.
        </p>
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="border-l-2 border-l-[#ff6b35] pl-4 flex flex-col items-center text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Line Analysis
          </h4>
          <span className="text-[9px] px-1.5 py-0.5 bg-[#ff6b35]/20 text-[#ff6b35] rounded-full font-semibold">
            MANUAL
          </span>
        </div>
        {content}
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl border-l-4 border-l-[#ff6b35] overflow-hidden">
      <div className="px-5 py-2.5 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Line Analysis
        </h3>
        <span className="text-[10px] px-2 py-0.5 bg-[#ff6b35]/20 text-[#ff6b35] rounded-full font-semibold">
          MANUAL
        </span>
      </div>
      <div className="p-5">{content}</div>
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
    <div className="p-3 rounded-lg bg-white/5">
      <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">
        {label}
      </div>
      <div
        className={cn(
          'text-xl font-bold font-mono',
          accent && 'text-[#39ff14]',
          warn && 'text-[#ff4757]',
          !accent && !warn && 'text-white'
        )}
      >
        {value}
      </div>
    </div>
  );
}
