'use client';

import { HelpCircle } from 'lucide-react';
import {
  formatProjectionGap,
  projectionGap,
  PROJECTION_METHODOLOGY,
} from '@/lib/betting/market-probability';

export type ProjectionVsMarketProps = {
  projection: number | null | undefined;
  line: number | null | undefined;
  unit?: string;
  label?: string;
  /** Anchored estimated EV as a decimal (0.031 = 3.1%). Shown separately from the gap. */
  estimatedEv?: number | null;
};

function gapTone(gap: number): string {
  if (Math.abs(gap) < 0.05) return 'text-[#4a6366]';
  if (gap > 0) return 'text-[#075B5C]';
  return 'text-[#9a5348]';
}

function formatEvPct(ev: number): string {
  const pct = ev * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

export function ProjectionVsMarket({
  projection,
  line,
  unit,
  label = 'PTS',
  estimatedEv,
}: ProjectionVsMarketProps) {
  const hasProjection = projection != null && Number.isFinite(projection);
  const hasLine = line != null && Number.isFinite(line);
  const gap = projectionGap(hasProjection ? projection : null, hasLine ? line : null);
  const unitBit = unit ?? label;

  if (!hasProjection) {
    return (
      <div className="rounded-xl border border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-wide font-medium text-[#72869A]">
          Court Context Projection
        </p>
        <p className="text-xs text-[#4a6366] mt-1">Projection unavailable for this player.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <p className="text-[10px] uppercase tracking-wide font-medium text-[#72869A]">
          Court Context Projection
        </p>
        <span
          className="inline-flex text-[#8aa0a3] hover:text-[#4a6366]"
          title={PROJECTION_METHODOLOGY}
          aria-label={PROJECTION_METHODOLOGY}
        >
          <HelpCircle className="w-3 h-3" aria-hidden />
        </span>
      </div>
      <p className="text-2xl font-bold text-[#063f46] tabular-nums leading-none">
        {projection!.toFixed(1)}
      </p>
      <p className="text-[11px] text-[#4a6366] mt-1">Projected {unitBit}</p>
      <dl className="mt-2.5 space-y-1 text-xs">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-[#4a6366]">Market line</dt>
          <dd className="font-mono text-[#063f46] tabular-nums">
            {hasLine ? line!.toFixed(1) : '—'}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-[#4a6366]">Projection gap</dt>
          <dd className={`font-mono font-semibold tabular-nums ${gap != null ? gapTone(gap) : 'text-[#4a6366]'}`}>
            {gap != null ? formatProjectionGap(gap) : '—'}
          </dd>
        </div>
        {estimatedEv != null && Number.isFinite(estimatedEv) ? (
          <div className="flex items-baseline justify-between gap-3 pt-1 border-t border-[#DCE9EA]">
            <dt className="text-[#4a6366]">Estimated EV</dt>
            <dd className="font-mono text-[#063f46] tabular-nums">{formatEvPct(estimatedEv)}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
