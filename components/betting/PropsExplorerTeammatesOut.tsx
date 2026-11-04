'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { MetricKey } from '@/lib/players/types';
import { METRIC_LABELS } from '@/lib/players/types';
import {
  seasonLabel,
  splitMetricValue,
  type TeammateOut,
  type TeammatesOutResponse,
} from '@/lib/betting/teammates-out-display';

const STATUS_CLASS: Record<TeammateOut['status'], string> = {
  Out: 'bg-[#fff8ee] text-[#8A5A00] border-[#F2D7A6]',
  Doubtful: 'bg-[#fff8ee] text-[#8A5A00] border-[#F2D7A6]',
  Q: 'bg-[#F3F8F8] text-[#4a6366] border-[#DCE9EA]',
};

const METRIC_SHORT: Record<MetricKey, string> = { pts: 'pts', reb: 'reb', ast: 'ast', '3pm': '3PM', pra: 'PRA' };

function fmt(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : v.toFixed(1);
}

function SplitLines({ t, metric }: { t: TeammateOut; metric: MetricKey }) {
  const s = t.split;
  if (!s || s.tier === 'insufficient') {
    return <p className="type-metadata text-[#4a6366]">Not enough games without him to compare yet.</p>;
  }
  const w = splitMetricValue(s.without, metric);
  const wi = splitMetricValue(s.with, metric);
  const diff = w != null && wi != null ? w - wi : null;
  const unit = METRIC_SHORT[metric];
  return (
    <div className="space-y-0.5">
      <p className="type-metadata text-[#063f46]">
        <span className="font-medium">Without him</span> ({s.withoutGames} g):{' '}
        <span className="font-mono tabular-nums">{fmt(w)}</span> {unit} ·{' '}
        <span className="font-mono tabular-nums">{fmt(s.without.minutes)}</span> min
        {diff != null && Math.abs(diff) >= 0.05 ? (
          <span className={`ml-1 font-mono tabular-nums ${diff > 0 ? 'text-[#178A45]' : 'text-[#8A5A00]'}`}>
            ({diff > 0 ? '+' : '−'}
            {Math.abs(diff).toFixed(1)})
          </span>
        ) : null}
      </p>
      <p className="type-metadata text-[#4a6366]">
        With him ({s.withGames} g): <span className="font-mono tabular-nums">{fmt(wi)}</span> {unit} ·{' '}
        <span className="font-mono tabular-nums">{fmt(s.with.minutes)}</span> min
        <span className="ml-1">· {seasonLabel(s.season)}</span>
        {s.tier === 'low_support' ? <span className="ml-1 text-[#8A5A00]">· small sample</span> : null}
      </p>
    </div>
  );
}

/**
 * Regular teammates listed out for this game and how the selected player has done without them.
 * Descriptive only; lines usually already reflect injury news.
 */
export function PropsExplorerTeammatesOut({
  playerId,
  gameId,
  metric,
}: {
  playerId: number | string;
  gameId: number | string;
  metric: MetricKey;
}) {
  const [data, setData] = useState<TeammatesOutResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    setData(null);
    setError(false);
    const u = new URL(`/api/betting/players/${playerId}/teammates-out`, window.location.origin);
    u.searchParams.set('gameId', String(gameId));
    fetch(u.toString(), { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: TeammatesOutResponse) => setData(j))
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') setError(true);
      });
    return () => ac.abort();
  }, [playerId, gameId]);

  return (
    <section className="rounded-xl border border-[#DCE9EA] overflow-hidden" aria-label="Teammates out tonight">
      <div className="flex items-center justify-between gap-2 border-b border-[#DCE9EA] bg-[#F8FBFA] px-3 py-2">
        <div className="min-w-0">
          <h3 className="type-card-data text-[#063f46]">Teammates out tonight</h3>
          {data?.status === 'ok' && data.asOfLabel ? <p className="type-metadata">Injury report {data.asOfLabel}</p> : null}
        </div>
        {data?.status === 'ok' && data.minutesFreed >= 1 ? (
          <span
            className="type-metadata shrink-0 rounded-md bg-[#e7f8ef] px-2 py-0.5 font-medium text-[#178A45]"
            title="Usual minutes of teammates listed Out or Doubtful"
          >
            {Math.round(data.minutesFreed)} min freed
          </span>
        ) : null}
      </div>
      <div className="space-y-2.5 px-3 py-2.5">
        {!data && !error ? (
          <div className="space-y-2" aria-busy="true">
            <div className="h-3.5 w-40 animate-pulse rounded bg-[#DCE9EA]" />
            <div className="h-3 w-56 animate-pulse rounded bg-[#e8f0ef]" />
          </div>
        ) : null}
        {error ? <p className="type-metadata">Couldn&apos;t load the injury report.</p> : null}
        {data?.status === 'unavailable' ? <p className="type-metadata">{data.reason}</p> : null}
        {data?.status === 'ok' && data.teammates.length === 0 ? (
          <p className="type-metadata">No regular teammates listed out.</p>
        ) : null}
        {data?.status === 'ok'
          ? data.teammates.map((t) => (
              <div key={t.playerId} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="type-table-data truncate text-[#063f46]">{t.name}</span>
                    <span className={`type-metadata shrink-0 rounded border px-1.5 ${STATUS_CLASS[t.status]}`}>{t.status}</span>
                  </div>
                  <span className="type-metadata shrink-0 tabular-nums">{t.avgMinutes.toFixed(0)} min/g</span>
                </div>
                {t.split ? <SplitLines t={t} metric={metric} /> : null}
                {t.split && t.split.tier !== 'insufficient' ? (
                  <Link href={t.wowyHref} className="type-interactive text-[#075B5C] hover:underline">
                    Full with/without
                  </Link>
                ) : null}
              </div>
            ))
          : null}
        {data?.status === 'ok' && data.teammates.some((t) => t.split && t.split.tier !== 'insufficient') ? (
          <p className="type-metadata border-t border-[#DCE9EA] pt-2 text-[#4a6366]">
            {METRIC_LABELS[metric]} in games he did or didn&apos;t play. Past results, not a projection; lines usually
            already reflect injury news.
          </p>
        ) : null}
      </div>
    </section>
  );
}
