'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getTodayET, addDaysET, getDateLabel } from '@/components/betting';

type PropEvalRow = {
  gameId: string;
  playerId: string;
  playerName: string | null;
  gameDate: string | null;
  sportsbook: string | null;
  propType: string | null;
  side: string | null;
  lineValue: number | null;
  decisionAt: string;
  oddsAmerican: number | null;
  oddsDecimal: number | null;
  impliedProbability: number | null;
  gameStartTime: string | null;
  statActual: number | null;
  betWon: boolean | null;
};

type Meta = {
  totalMatching: number;
  limit: number;
  offset: number;
  dateRange: { min: string | null; max: string | null };
};

export default function BettingResearchPage() {
  const [after, setAfter] = useState(() => addDaysET(getTodayET(), -14));
  const [before, setBefore] = useState('');
  const [propType, setPropType] = useState('');
  const [rows, setRows] = useState<PropEvalRow[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missingViews, setMissingViews] = useState(false);

  const queryString = useMemo(() => {
    const u = new URLSearchParams();
    if (after && /^\d{4}-\d{2}-\d{2}$/.test(after)) u.set('after', after);
    if (before && /^\d{4}-\d{2}-\d{2}$/.test(before)) u.set('before', before);
    if (propType.trim()) u.set('prop_type', propType.trim());
    u.set('limit', '200');
    u.set('offset', '0');
    return u.toString();
  }, [after, before, propType]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/betting/research/prop-eval?${queryString}`);
      const data = await res.json();
      if (!res.ok) {
        setRows([]);
        setMeta(null);
        setMissingViews(res.status === 503);
        setError(data.error || data.message || `HTTP ${res.status}`);
        return;
      }
      setMissingViews(false);
      setRows(data.rows ?? []);
      setMeta(data.meta ?? null);
    } catch (e) {
      setRows([]);
      setMeta(null);
      setMissingViews(false);
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
      <div className="mb-6">
        <p className="text-xs text-muted-foreground mb-2">
          <Link href="/betting/props-explorer" className="text-[#00d4ff] hover:underline">
            Props Explorer
          </Link>
          <span className="mx-2">/</span>
          <span className="text-white">Research</span>
        </p>
        <h1 className="text-xl font-semibold text-white">Prop eval (SQL)</h1>
        <p className="text-xs text-muted-foreground mt-2 max-w-3xl">
          Rows come from <code className="text-[10px] bg-white/5 px-1 rounded">research.v_prop_eval_units</code>:
          last pre-tip line snapshot per market plus realized stat. Coverage depends on how long{' '}
          <code className="text-[10px] bg-white/5 px-1 rounded">raw.player_prop_snapshots_v2</code> has been
          ingested. Track B probabilities are not computed here (phase 2).
        </p>
      </div>

      <div className="glass-card rounded-xl p-3 sm:p-4 space-y-3 mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">game_date ≥ (after)</span>
          <input
            type="date"
            value={after}
            onChange={(e) => setAfter(e.target.value)}
            className="rounded-lg border border-white/10 bg-gray-900 text-white text-xs py-1.5 px-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">game_date &lt; (before, exclusive)</span>
          <input
            type="date"
            value={before}
            onChange={(e) => setBefore(e.target.value)}
            className="rounded-lg border border-white/10 bg-gray-900 text-white text-xs py-1.5 px-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">prop_type (exact)</span>
          <input
            placeholder="e.g. points"
            value={propType}
            onChange={(e) => setPropType(e.target.value)}
            className="rounded-lg border border-white/10 bg-gray-900 text-white text-xs py-1.5 px-2 w-40"
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="glass-card rounded-xl p-4 border-l-4 border-l-amber-500 mb-4 space-y-2">
          <p className="text-sm text-amber-200">{error}</p>
          {missingViews && (
            <div className="text-xs text-muted-foreground mt-2 p-3 rounded-lg bg-white/5 font-mono">
              <p className="text-white/90 mb-1 font-sans not-italic">One-time DB setup:</p>
              Open Supabase → SQL Editor → paste and run the file{' '}
              <code className="text-[#00d4ff]">db/schemas/research_install_all.sql</code>
              (creates <code className="text-white/80">research.v_prop_eval_units</code> and dependent views).
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mb-2 text-xs text-muted-foreground">
        <span>
          {loading ? 'Loading…' : `${rows.length} rows`}
          {meta != null && ` · ${meta.totalMatching.toLocaleString()} matching`}
          {meta?.dateRange?.min && meta?.dateRange?.max && (
            <span className="ml-2 font-mono">
              range {meta.dateRange.min} … {meta.dateRange.max}
            </span>
          )}
        </span>
        <span className="text-[10px]">
          Holdout: use <strong className="text-white">after</strong> for test window,{' '}
          <strong className="text-white">before</strong> for train-only cap.
        </span>
      </div>

      <div className="glass-card rounded-xl overflow-hidden border border-white/5">
        <div className="overflow-x-auto max-h-[calc(100vh-14rem)] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-gray-950/95 border-b border-white/10">
              <tr className="text-muted-foreground">
                <th className="py-2 px-2 font-medium">Date</th>
                <th className="py-2 px-2 font-medium">Player</th>
                <th className="py-2 px-2 font-medium">Prop</th>
                <th className="py-2 px-2 font-medium">Side</th>
                <th className="py-2 px-2 font-medium text-right">Line</th>
                <th className="py-2 px-2 font-medium text-right">Actual</th>
                <th className="py-2 px-2 font-medium">Won</th>
                <th className="py-2 px-2 font-medium">Book</th>
                <th className="py-2 px-2 font-medium text-right">Decided</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-muted-foreground">
                    No rows. Widen dates or apply SQL views in the database.
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr
                    key={`${r.gameId}-${r.playerId}-${r.propType}-${r.side}-${r.lineValue}-${i}`}
                    className="border-b border-white/5 hover:bg-white/3"
                  >
                    <td className="py-1.5 px-2 font-mono text-muted-foreground whitespace-nowrap">
                      {r.gameDate ?? '—'}
                    </td>
                    <td className="py-1.5 px-2 text-white truncate max-w-[120px]">
                      {r.playerName ?? r.playerId}
                    </td>
                    <td className="py-1.5 px-2 capitalize">{(r.propType ?? '—').replace(/_/g, ' ')}</td>
                    <td className="py-1.5 px-2 capitalize">{r.side ?? '—'}</td>
                    <td className="py-1.5 px-2 text-right font-mono">
                      {r.lineValue != null && Number.isFinite(r.lineValue) ? r.lineValue : '—'}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-white">
                      {r.statActual != null && Number.isFinite(r.statActual) ? r.statActual.toFixed(1) : '—'}
                    </td>
                    <td className="py-1.5 px-2">
                      {r.betWon === null ? '—' : r.betWon ? 'Y' : 'N'}
                    </td>
                    <td className="py-1.5 px-2 text-muted-foreground truncate max-w-[90px]">
                      {r.sportsbook ?? '—'}
                    </td>
                    <td className="py-1.5 px-2 text-[10px] text-muted-foreground whitespace-nowrap">
                      {r.decisionAt ? new Date(r.decisionAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground mt-4">
        Date label (ET): {getDateLabel(after)} — default window is last 14 days from today ET.
      </p>
    </main>
  );
}
