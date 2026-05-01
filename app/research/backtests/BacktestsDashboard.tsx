'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { BacktestReportSummary, BacktestSeasonComparison } from '@/lib/backtesting/backtest-report-types';
import type { ThresholdSweepReport } from '@/lib/backtesting/backtest-threshold-sweep-types';

const SEASON_OPTIONS = [2023, 2024] as const;
const THRESHOLD_OPTIONS = [1, 2, 3, 4, 5] as const;
const COMPARISON_SEASONS = [2023, 2024] as const;
const SWEEP_THRESHOLDS = [1, 2, 3, 4, 5] as const;

type SummaryPayload = {
  generatedAt: string;
  reportVersion: 1;
  summary: BacktestReportSummary;
};

type ComparisonPayload = {
  generatedAt: string;
  reportVersion: 1;
  comparison: BacktestSeasonComparison;
};

type SweepPayload = {
  generatedAt: string;
  reportVersion: 1;
  sweep: ThresholdSweepReport;
  missingThresholds: number[];
};

function fmtRate(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(2)}%`;
}

function fmtNum(n: number | null | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function cardTitle(cls: string) {
  return `text-[10px] uppercase tracking-wide ${cls}`;
}

export function BacktestsDashboard() {
  const [season, setSeason] = useState<number>(2023);
  const [threshold, setThreshold] = useState<number>(3);

  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [summaryErr, setSummaryErr] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  const [comparison, setComparison] = useState<ComparisonPayload | null>(null);
  const [comparisonErr, setComparisonErr] = useState<string | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(true);

  const [sweep, setSweep] = useState<SweepPayload | null>(null);
  const [sweepErr, setSweepErr] = useState<string | null>(null);
  const [sweepLoading, setSweepLoading] = useState(true);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryErr(null);
    setSummary(null);
    try {
      const res = await fetch(
        `/api/backtests/points-l5-vs-season/summary?season=${season}&threshold=${threshold}`
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSummaryErr(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setSummary(data as SummaryPayload);
    } catch (e) {
      setSummaryErr(e instanceof Error ? e.message : 'Failed to load summary');
    } finally {
      setSummaryLoading(false);
    }
  }, [season, threshold]);

  const loadComparison = useCallback(async () => {
    setComparisonLoading(true);
    setComparisonErr(null);
    setComparison(null);
    try {
      const tag = [...COMPARISON_SEASONS].join(',');
      const res = await fetch(
        `/api/backtests/points-l5-vs-season/comparison?seasons=${encodeURIComponent(tag)}&threshold=${threshold}`
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setComparisonErr(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setComparison(data as ComparisonPayload);
    } catch (e) {
      setComparisonErr(e instanceof Error ? e.message : 'Failed to load comparison');
    } finally {
      setComparisonLoading(false);
    }
  }, [threshold]);

  const loadSweep = useCallback(async () => {
    setSweepLoading(true);
    setSweepErr(null);
    setSweep(null);
    try {
      const seasonsQ = [...COMPARISON_SEASONS].join(',');
      const thrQ = [...SWEEP_THRESHOLDS].join(',');
      const res = await fetch(
        `/api/backtests/points-l5-vs-season/threshold-sweep?seasons=${encodeURIComponent(seasonsQ)}&thresholds=${encodeURIComponent(thrQ)}`
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSweepErr(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setSweep(data as SweepPayload);
    } catch (e) {
      setSweepErr(e instanceof Error ? e.message : 'Failed to load threshold sweep');
    } finally {
      setSweepLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadComparison();
  }, [loadComparison]);

  useEffect(() => {
    void loadSweep();
  }, [loadSweep]);

  const sum = summary?.summary;

  return (
    <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
      <div className="mb-6">
        <p className="text-xs text-muted-foreground mb-2">
          <Link href="/" className="text-[#00d4ff] hover:underline">
            Home
          </Link>
          <span className="mx-2">/</span>
          <span className="text-white">Research</span>
          <span className="mx-2">/</span>
          <span className="text-white">Backtests</span>
        </p>
        <h1 className="text-xl font-semibold text-white">Backtest results</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Strategy: <span className="text-white font-mono">points_l5_vs_season_v1</span>
        </p>
        <p className="text-xs text-muted-foreground mt-2 max-w-3xl">
          Read-only view of JSON reports stored in S3 (server-side fetch). No EV or sportsbook lines.
        </p>
      </div>

      <div className="glass-card rounded-xl p-3 sm:p-4 flex flex-wrap items-end gap-4 mb-6">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Season</span>
          <select
            value={season}
            onChange={(e) => setSeason(Number(e.target.value))}
            className="rounded-lg border border-white/10 bg-gray-900 text-white text-xs py-1.5 px-2 min-w-[100px]"
          >
            {SEASON_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Edge threshold</span>
          <select
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="rounded-lg border border-white/10 bg-gray-900 text-white text-xs py-1.5 px-2 min-w-[80px]"
          >
            {THRESHOLD_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            void loadSummary();
            void loadComparison();
          }}
          className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs"
        >
          Refresh summary & comparison
        </button>
      </div>

      {summaryErr && (
        <div className="glass-card rounded-xl p-4 border-l-4 border-l-amber-500 mb-4 space-y-3">
          <p className="text-sm text-amber-200">{summaryErr}</p>
          {(summaryErr.toLowerCase().includes('not found') ||
            summaryErr.toLowerCase().includes('report')) && (
            <div className="text-xs text-muted-foreground font-mono bg-black/30 rounded-lg p-3 space-y-2">
              <p className="text-white/80 font-sans not-italic">
                Generate artifacts (machine with AWS creds + <code className="text-[#00d4ff]">NBA_DATA_BUCKET</code>
                ). On Windows PowerShell, prefer <code className="text-[#00d4ff]">npx tsx</code> so arguments are not
                dropped.
              </p>
              <p>{`npx tsx scripts/backtesting/run-points-l5-vs-season-backtest.ts --season=${season} --threshold=${threshold}`}</p>
              <p>{`npx tsx scripts/backtesting/report-points-l5-vs-season-backtest.ts --season=${season} --threshold=${threshold}`}</p>
              <p className="text-[10px] text-muted-foreground font-sans border-t border-white/10 pt-2">
                Or: <code className="text-white/70">npm run backtest:points-l5-vs-season -- --season=...</code> from
                bash/Git Bash. Reports land under{' '}
                <code className="text-[#00d4ff]">threshold={threshold}/</code>; for threshold 3 only, the API also
                tries the pre–Slice-11 path without that folder.
              </p>
            </div>
          )}
        </div>
      )}

      {summaryLoading && !summaryErr && (
        <p className="text-xs text-muted-foreground mb-4">Loading summary…</p>
      )}

      {sum && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {(
              [
                ['Win rate', fmtRate(sum.winRate), 'text-emerald-300'],
                ['Signals', String(sum.signalsGenerated), 'text-white'],
                ['Signal rate', fmtRate(sum.signalRate), 'text-[#00d4ff]'],
                ['Avg edge', fmtNum(sum.averageEdge), 'text-white'],
                ['Avg margin', fmtNum(sum.averageActualMargin), 'text-white'],
                ['Rows scanned', String(sum.rowsScanned), 'text-muted-foreground'],
              ] as const
            ).map(([label, val, cls]) => (
              <div key={label} className="glass-card rounded-xl p-3 border border-white/5">
                <p className={cardTitle('text-muted-foreground')}>{label}</p>
                <p className={`text-lg font-semibold mt-1 ${cls}`}>{val}</p>
              </div>
            ))}
          </div>

          <div className="glass-card rounded-xl p-4 mb-6 border border-white/5">
            <h2 className="text-sm font-medium text-white mb-3">Skip reasons</h2>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-white/10">
                  <th className="py-2 pr-4">Reason</th>
                  <th className="py-2 text-right">Count</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['insufficient_prior_games', sum.skippedReasons.insufficient_prior_games],
                    ['missing_feature_values', sum.skippedReasons.missing_feature_values],
                    ['no_signal', sum.skippedReasons.no_signal],
                  ] as const
                ).map(([k, v]) => (
                  <tr key={k} className="border-b border-white/5">
                    <td className="py-1.5 font-mono text-white/90">{k}</td>
                    <td className="py-1.5 text-right font-mono">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="text-sm font-medium text-white mb-2">By month</h2>
          <div className="glass-card rounded-xl overflow-hidden border border-white/5 mb-6 overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[640px]">
              <thead className="bg-gray-950/95 border-b border-white/10">
                <tr className="text-muted-foreground">
                  <th className="py-2 px-2">Month</th>
                  <th className="py-2 px-2 text-right">Signals</th>
                  <th className="py-2 px-2 text-right">W/L/P</th>
                  <th className="py-2 px-2 text-right">Win rate</th>
                  <th className="py-2 px-2 text-right">Avg edge</th>
                  <th className="py-2 px-2 text-right">Avg margin</th>
                </tr>
              </thead>
              <tbody>
                {sum.byMonth.map((b) => (
                  <tr key={b.bucketKey} className="border-b border-white/5 hover:bg-white/3">
                    <td className="py-1.5 px-2 font-mono">{b.bucketKey}</td>
                    <td className="py-1.5 px-2 text-right">{b.signals}</td>
                    <td className="py-1.5 px-2 text-right font-mono">
                      {b.wins}/{b.losses}/{b.pushes}
                    </td>
                    <td className="py-1.5 px-2 text-right">{fmtRate(b.winRate)}</td>
                    <td className="py-1.5 px-2 text-right">{fmtNum(b.averageEdge)}</td>
                    <td className="py-1.5 px-2 text-right">{fmtNum(b.averageActualMargin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="text-sm font-medium text-white mb-2">Prior games bucket</h2>
          <div className="glass-card rounded-xl overflow-hidden border border-white/5 mb-6 overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[640px]">
              <thead className="bg-gray-950/95 border-b border-white/10">
                <tr className="text-muted-foreground">
                  <th className="py-2 px-2">Bucket</th>
                  <th className="py-2 px-2 text-right">Signals</th>
                  <th className="py-2 px-2 text-right">W/L/P</th>
                  <th className="py-2 px-2 text-right">Win rate</th>
                  <th className="py-2 px-2 text-right">Avg edge</th>
                  <th className="py-2 px-2 text-right">Avg margin</th>
                </tr>
              </thead>
              <tbody>
                {sum.byPriorGamesBucket.map((b) => (
                  <tr key={b.bucketKey} className="border-b border-white/5 hover:bg-white/3">
                    <td className="py-1.5 px-2 font-mono">{b.bucketKey}</td>
                    <td className="py-1.5 px-2 text-right">{b.signals}</td>
                    <td className="py-1.5 px-2 text-right font-mono">
                      {b.wins}/{b.losses}/{b.pushes}
                    </td>
                    <td className="py-1.5 px-2 text-right">{fmtRate(b.winRate)}</td>
                    <td className="py-1.5 px-2 text-right">{fmtNum(b.averageEdge)}</td>
                    <td className="py-1.5 px-2 text-right">{fmtNum(b.averageActualMargin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="text-sm font-medium text-white mb-2">Top winning margins</h2>
          <SampleTable rows={sum.topWinningMargins} />

          <h2 className="text-sm font-medium text-white mb-2 mt-6">Top losing margins</h2>
          <SampleTable rows={sum.worstLosingMargins} />

          <h2 className="text-sm font-medium text-white mb-2 mt-6">Top pre-game edges</h2>
          <SampleTable rows={sum.topEdges} />
        </>
      )}

      <div className="mt-10 border-t border-white/10 pt-8">
        <h2 className="text-sm font-medium text-white mb-2">
          Season comparison ({COMPARISON_SEASONS.join(' vs ')}, threshold={threshold})
        </h2>
        {comparisonLoading && !comparisonErr && (
          <p className="text-xs text-muted-foreground mb-2">Loading comparison…</p>
        )}
        {comparisonErr && (
          <div className="glass-card rounded-xl p-4 border-l-4 border-l-amber-500 mb-4">
            <p className="text-sm text-amber-200">{comparisonErr}</p>
          </div>
        )}
        {comparison?.comparison && (
          <div className="glass-card rounded-xl overflow-hidden border border-white/5 overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[720px]">
              <thead className="bg-gray-950/95 border-b border-white/10">
                <tr className="text-muted-foreground">
                  <th className="py-2 px-2">Season</th>
                  <th className="py-2 px-2 text-right">Signals</th>
                  <th className="py-2 px-2 text-right">Sig rate</th>
                  <th className="py-2 px-2 text-right">W/L/P</th>
                  <th className="py-2 px-2 text-right">Win rate</th>
                  <th className="py-2 px-2 text-right">Avg edge</th>
                  <th className="py-2 px-2 text-right">Avg margin</th>
                </tr>
              </thead>
              <tbody>
                {comparison.comparison.perSeason.map((p) => (
                  <tr key={p.season} className="border-b border-white/5 hover:bg-white/3">
                    <td className="py-1.5 px-2 font-mono">{p.season}</td>
                    <td className="py-1.5 px-2 text-right">{p.signalsGenerated}</td>
                    <td className="py-1.5 px-2 text-right">{fmtRate(p.signalRate)}</td>
                    <td className="py-1.5 px-2 text-right font-mono">
                      {p.wins}/{p.losses}/{p.pushes}
                    </td>
                    <td className="py-1.5 px-2 text-right">{fmtRate(p.winRate)}</td>
                    <td className="py-1.5 px-2 text-right">{fmtNum(p.averageEdge)}</td>
                    <td className="py-1.5 px-2 text-right">{fmtNum(p.averageActualMargin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-10 border-t border-white/10 pt-8">
        <h2 className="text-sm font-medium text-white mb-2">
          Threshold sweep ({COMPARISON_SEASONS.join('–')}, thresholds {SWEEP_THRESHOLDS.join(', ')})
        </h2>
        {sweepLoading && !sweepErr && (
          <p className="text-xs text-muted-foreground mb-2">Loading sweep…</p>
        )}
        {sweepErr && (
          <div className="glass-card rounded-xl p-4 border-l-4 border-l-amber-500 mb-4">
            <p className="text-sm text-amber-200">{sweepErr}</p>
          </div>
        )}
        {sweep?.sweep && (
          <>
            {sweep.missingThresholds.length > 0 && (
              <div className="glass-card rounded-xl p-3 border border-amber-500/40 mb-3 text-xs text-amber-100">
                Some requested thresholds are missing from the sweep file:{' '}
                <span className="font-mono">{sweep.missingThresholds.join(', ')}</span>. Regenerate the sweep
                report with the same threshold list.
              </div>
            )}
            <p className="text-xs text-muted-foreground mb-2">
              Best (raw win rate):{' '}
              <span className="text-white font-mono">{sweep.sweep.bestThresholdByWinRate ?? '—'}</span>
              {' · '}
              Best (sample-adjusted):{' '}
              <span className="text-white font-mono">
                {sweep.sweep.bestThresholdBySampleAdjustedWinRate ?? '—'}
              </span>
            </p>
            <div className="glass-card rounded-xl overflow-hidden border border-white/5 overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[800px]">
                <thead className="bg-gray-950/95 border-b border-white/10">
                  <tr className="text-muted-foreground">
                    <th className="py-2 px-2">Thr</th>
                    <th className="py-2 px-2 text-right">Signals</th>
                    <th className="py-2 px-2 text-right">Sig rate</th>
                    <th className="py-2 px-2 text-right">W/L/P</th>
                    <th className="py-2 px-2 text-right">Win rate</th>
                    <th className="py-2 px-2 text-right">Adj win</th>
                    <th className="py-2 px-2 text-right">Avg edge</th>
                    <th className="py-2 px-2 text-right">Avg margin</th>
                    <th className="py-2 px-2 text-right">Min S WR</th>
                    <th className="py-2 px-2 text-right">Max S WR</th>
                  </tr>
                </thead>
                <tbody>
                  {sweep.sweep.rows.map((r) => (
                    <tr key={r.threshold} className="border-b border-white/5 hover:bg-white/3">
                      <td className="py-1.5 px-2 font-mono">{r.threshold}</td>
                      <td className="py-1.5 px-2 text-right">{r.totalSignalsGenerated}</td>
                      <td className="py-1.5 px-2 text-right">{fmtRate(r.signalRate)}</td>
                      <td className="py-1.5 px-2 text-right font-mono">
                        {r.wins}/{r.losses}/{r.pushes}
                      </td>
                      <td className="py-1.5 px-2 text-right">{fmtRate(r.winRate)}</td>
                      <td className="py-1.5 px-2 text-right">{fmtRate(r.sampleAdjustedWinRate)}</td>
                      <td className="py-1.5 px-2 text-right">{fmtNum(r.averageEdge)}</td>
                      <td className="py-1.5 px-2 text-right">{fmtNum(r.averageActualMargin)}</td>
                      <td className="py-1.5 px-2 text-right">{fmtRate(r.minSeasonWinRate)}</td>
                      <td className="py-1.5 px-2 text-right">{fmtRate(r.maxSeasonWinRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="glass-card rounded-xl p-4 mt-10 border border-white/10">
        <h2 className="text-sm font-medium text-white mb-2">Notes</h2>
        <ul className="text-xs text-muted-foreground space-y-2 list-disc pl-4">
          <li>Synthetic season-average line only — not sportsbook odds.</li>
          <li>Does not prove profitability; no EV shown.</li>
          <li>Use to validate signal behavior before adding real market odds.</li>
        </ul>
      </div>
    </main>
  );
}

function SampleTable({
  rows,
}: {
  rows: {
    player_id: string;
    game_id: string;
    game_date: string;
    edge: number;
    actual_margin: number;
    synthetic_line: number;
    actual_points: number;
    outcome: string;
  }[];
}) {
  if (!rows.length) {
    return <p className="text-xs text-muted-foreground">No rows.</p>;
  }
  return (
    <div className="glass-card rounded-xl overflow-hidden border border-white/5 overflow-x-auto">
      <table className="w-full text-left text-xs min-w-[720px]">
        <thead className="bg-gray-950/95 border-b border-white/10">
          <tr className="text-muted-foreground">
            <th className="py-2 px-2">Player</th>
            <th className="py-2 px-2">Game</th>
            <th className="py-2 px-2">Date</th>
            <th className="py-2 px-2 text-right">Actual</th>
            <th className="py-2 px-2 text-right">Line</th>
            <th className="py-2 px-2 text-right">Margin</th>
            <th className="py-2 px-2 text-right">Edge</th>
            <th className="py-2 px-2">Out</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.player_id}-${r.game_id}-${i}`} className="border-b border-white/5 hover:bg-white/3">
              <td className="py-1.5 px-2 font-mono truncate max-w-[100px]">{r.player_id}</td>
              <td className="py-1.5 px-2 font-mono truncate max-w-[100px]">{r.game_id}</td>
              <td className="py-1.5 px-2 font-mono">{r.game_date}</td>
              <td className="py-1.5 px-2 text-right">{fmtNum(r.actual_points, 1)}</td>
              <td className="py-1.5 px-2 text-right">{fmtNum(r.synthetic_line, 2)}</td>
              <td className="py-1.5 px-2 text-right">{fmtNum(r.actual_margin, 2)}</td>
              <td className="py-1.5 px-2 text-right">{fmtNum(r.edge, 2)}</td>
              <td className="py-1.5 px-2 uppercase">{r.outcome}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
