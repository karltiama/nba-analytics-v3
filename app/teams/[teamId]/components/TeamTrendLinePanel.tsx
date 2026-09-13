'use client';

import { cn } from '@/lib/utils';
import { hitRate, avgMargin, streak } from '@/lib/players/metrics';

interface TeamTrendLinePanelProps {
  values: number[];
  bettingLine: number | null;
  onLineChange: (line: number | null) => void;
  lineLabel?: string;
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
    <div className="p-3 rounded-lg bg-[#F8FBFA] border border-[#DCE9EA]">
      <div className="text-[10px] text-[#4a6366] uppercase tracking-widest mb-1">
        {label}
      </div>
      <div
        className={cn(
          'text-xl font-bold font-mono',
          accent && 'text-[#20B95A]',
          warn && 'text-[#c2410c]',
          !accent && !warn && 'text-[#063f46]'
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function TeamTrendLinePanel({
  values,
  bettingLine,
  onLineChange,
  lineLabel = 'Line',
}: TeamTrendLinePanelProps) {
  const hr = bettingLine !== null ? hitRate(values, bettingLine) : null;
  const margin = bettingLine !== null ? avgMargin(values, bettingLine) : null;
  const stk = bettingLine !== null ? streak(values, bettingLine) : null;

  return (
    <div className="border-l-2 border-l-[#c2410c] pl-4 flex flex-col items-center text-center">
      <div className="flex items-center justify-center gap-2 mb-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[#4a6366]">
          Line Analysis
        </h4>
        <span className="text-[9px] px-1.5 py-0.5 bg-red-50 text-[#c2410c] rounded-full font-semibold">
          MANUAL
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-4 w-full justify-center">
        <label className="text-sm text-[#4a6366]">{lineLabel}:</label>
        <input
          type="number"
          step="0.5"
          min="0"
          value={bettingLine ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            onLineChange(val === '' ? null : parseFloat(val));
          }}
          placeholder="110.5"
          className={cn(
            'w-28 px-3 py-1.5 rounded-lg text-sm font-mono',
            'bg-white border border-[#DCE9EA] text-[#063f46] placeholder:text-[#8aa0a3]',
            'focus:outline-none focus:ring-2 focus:ring-[#55ddb1]/60 focus:border-[#075B5C]'
          )}
        />
        {bettingLine !== null && (
          <button
            onClick={() => onLineChange(null)}
            className="text-xs text-[#4a6366] hover:text-[#063f46] transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      {bettingLine !== null && hr && margin !== null && stk ? (
        <div className="grid gap-3 grid-cols-4 w-full">
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
        <p className="text-sm text-[#8aa0a3]">
          Enter a line above to see hit rate, margin, and streak analysis.
        </p>
      )}
    </div>
  );
}
