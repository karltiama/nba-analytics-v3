'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

type PaperBet = {
  id: string;
  createdAt: string;
  status: string;
  gameId: string;
  playerId: string;
  playerName: string | null;
  sportsbook: string | null;
  propType: string | null;
  marketType: string | null;
  side: string | null;
  lineValue: number | null;
  oddsAmerican: number | null;
  impliedProbability: number | null;
  stakeUnits: number;
  ev: number | null;
  confidenceTier: string | null;
  calibrationVersion: string | null;
  decisionSnapshotAt: string;
  modelProbability: number | null;
  projection: number | null;
  evSelectedTrack: string | null;
  result: string | null;
  profitUnits: number | null;
  settledAt: string | null;
};

type AnalyticsSegment = {
  key: string;
  count: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  stakeSum: number;
  profitSum: number;
};

type PaperAnalytics = {
  byPropType: AnalyticsSegment[];
  byConfidence: AnalyticsSegment[];
  byCalibration: AnalyticsSegment[];
  byEvBucket: AnalyticsSegment[];
};

type Tab = 'open' | 'history' | 'summary';

const EV_BUCKET_LABEL: Record<string, string> = {
  unknown: 'EV null',
  neg: 'EV < 0',
  '0_2pct': '0% ≤ EV < 2%',
  '2_5pct': '2% ≤ EV < 5%',
  '5pct_plus': 'EV ≥ 5%',
};

function formatPct(x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

function SegmentTable({ title, rows, keyLabel }: { title: string; rows: AnalyticsSegment[]; keyLabel?: (k: string) => string }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-5">
      <h3 className="text-xs font-medium text-white mb-2">{title}</h3>
      <div className="overflow-x-auto border border-white/10 rounded-lg">
        <table className="w-full text-left text-[11px]">
          <thead className="bg-gray-950/80 border-b border-white/10 text-muted-foreground">
            <tr>
              <th className="py-1.5 px-2 font-medium">Segment</th>
              <th className="py-1.5 px-2 font-medium text-right">n</th>
              <th className="py-1.5 px-2 font-medium text-right">W/L/P/V</th>
              <th className="py-1.5 px-2 font-medium text-right">Net</th>
              <th className="py-1.5 px-2 font-medium text-right">ROI</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const roi = r.stakeSum > 0 ? r.profitSum / r.stakeSum : null;
              const label = keyLabel ? keyLabel(r.key) : r.key;
              return (
                <tr key={r.key} className="border-b border-white/5">
                  <td className="py-1 px-2 text-white capitalize">{label}</td>
                  <td className="py-1 px-2 text-right font-mono text-muted-foreground">{r.count}</td>
                  <td className="py-1 px-2 text-right font-mono text-muted-foreground text-[10px]">
                    {r.wins}/{r.losses}/{r.pushes}/{r.voids}
                  </td>
                  <td
                    className={`py-1 px-2 text-right font-mono ${r.profitSum >= 0 ? 'text-[#39ff14]' : 'text-[#ff4757]'}`}
                  >
                    {r.profitSum >= 0 ? '+' : ''}
                    {r.profitSum.toFixed(2)}
                  </td>
                  <td className="py-1 px-2 text-right font-mono text-white">
                    {roi != null ? `${(roi * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatOdds(odds: number | null): string {
  if (odds == null) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

function PaperBetsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = (searchParams.get('tab') as Tab) || 'open';
  const validTab: Tab = ['open', 'history', 'summary'].includes(tab) ? tab : 'open';

  const [openBets, setOpenBets] = useState<PaperBet[]>([]);
  const [historyBets, setHistoryBets] = useState<PaperBet[]>([]);
  const [analytics, setAnalytics] = useState<PaperAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOpen = useCallback(async () => {
    const res = await fetch('/api/betting/paper-bets?status=open&limit=200');
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || 'Failed to load');
    return (data.bets ?? []) as PaperBet[];
  }, []);

  const loadHistory = useCallback(async () => {
    const res = await fetch('/api/betting/paper-bets?status=settled&limit=500');
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || 'Failed to load');
    return (data.bets ?? []) as PaperBet[];
  }, []);

  const loadAnalytics = useCallback(async () => {
    const res = await fetch('/api/betting/paper-bets/analytics');
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || 'Failed to load analytics');
    return {
      byPropType: data.byPropType ?? [],
      byConfidence: data.byConfidence ?? [],
      byCalibration: data.byCalibration ?? [],
      byEvBucket: data.byEvBucket ?? [],
    } as PaperAnalytics;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [open, hist, seg] = await Promise.all([
        loadOpen(),
        loadHistory(),
        loadAnalytics().catch(() => null),
      ]);
      setOpenBets(open);
      setHistoryBets(hist);
      setAnalytics(seg);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
      setOpenBets([]);
      setHistoryBets([]);
      setAnalytics(null);
    } finally {
      setLoading(false);
    }
  }, [loadOpen, loadHistory, loadAnalytics]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setTab = (t: Tab) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', t);
    router.replace(`/betting/paper?${next.toString()}`, { scroll: false });
  };

  const summary = useMemo(() => {
    const settled = historyBets;
    const n = settled.length;
    let wins = 0;
    let losses = 0;
    let pushes = 0;
    let voids = 0;
    let profitStaked = 0;
    let stakeStaked = 0;
    for (const b of settled) {
      stakeStaked += b.stakeUnits;
      if (b.result === 'win') wins++;
      else if (b.result === 'loss') losses++;
      else if (b.result === 'push') pushes++;
      else if (b.result === 'void') voids++;
      profitStaked += b.profitUnits ?? 0;
    }
    const roi = stakeStaked > 0 ? profitStaked / stakeStaked : null;
    return { n, wins, losses, pushes, voids, profitStaked, stakeStaked, roi };
  }, [historyBets]);

  const handleSettle = async () => {
    setSettling(true);
    setError(null);
    try {
      const res = await fetch('/api/betting/paper-bets/settle', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'Settle failed');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Settle failed');
    } finally {
      setSettling(false);
    }
  };

  const displayRows = validTab === 'open' ? openBets : validTab === 'history' ? historyBets : [];

  return (
    <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white">Paper Bets</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Log legs from Props Explorer. Settlement uses Final box scores (same stat mapping as research views).
            ROI = sum(profit) / sum(stake) on settled bets. Cron: GET /api/cron/paper-settle (Bearer{' '}
            <span className="font-mono">PAPER_SETTLE_CRON_SECRET</span> or <span className="font-mono">CRON_SECRET</span>
            ). No auth in v1 — personal use only.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab('open')}
            className={`px-3 py-1.5 rounded-lg text-xs border ${
              validTab === 'open'
                ? 'border-[#00d4ff] bg-[#00d4ff]/10 text-white'
                : 'border-white/10 text-muted-foreground hover:bg-white/5'
            }`}
          >
            Open ({openBets.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('history')}
            className={`px-3 py-1.5 rounded-lg text-xs border ${
              validTab === 'history'
                ? 'border-[#00d4ff] bg-[#00d4ff]/10 text-white'
                : 'border-white/10 text-muted-foreground hover:bg-white/5'
            }`}
          >
            History
          </button>
          <button
            type="button"
            onClick={() => setTab('summary')}
            className={`px-3 py-1.5 rounded-lg text-xs border ${
              validTab === 'summary'
                ? 'border-[#00d4ff] bg-[#00d4ff]/10 text-white'
                : 'border-white/10 text-muted-foreground hover:bg-white/5'
            }`}
          >
            Summary
          </button>
          <button
            type="button"
            disabled={settling || loading}
            onClick={handleSettle}
            className="px-3 py-1.5 rounded-lg text-xs border border-[#39ff14]/50 bg-[#39ff14]/10 text-[#b8ffc9] hover:bg-[#39ff14]/20 disabled:opacity-50"
          >
            {settling ? 'Settling…' : 'Settle now'}
          </button>
        </div>
      </div>

      {error && (
        <div className="glass-card rounded-xl p-4 border-l-4 border-l-[#ff4757] mb-4">
          <p className="text-sm text-[#ff4757]">{error}</p>
        </div>
      )}

      {validTab === 'summary' && (
        <div className="glass-card rounded-xl p-4 sm:p-6 mb-6 space-y-3">
          <h2 className="text-sm font-medium text-white">ROI summary (settled only)</h2>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <dt className="text-muted-foreground">Settled bets</dt>
              <dd className="text-white font-mono text-lg">{summary.n}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">W / L / Push / Void</dt>
              <dd className="text-white font-mono">
                {summary.wins} / {summary.losses} / {summary.pushes} / {summary.voids}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Net units</dt>
              <dd
                className={`font-mono text-lg ${summary.profitStaked >= 0 ? 'text-[#39ff14]' : 'text-[#ff4757]'}`}
              >
                {summary.profitStaked >= 0 ? '+' : ''}
                {summary.profitStaked.toFixed(2)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">ROI (profit / stake)</dt>
              <dd className="text-white font-mono text-lg">
                {summary.roi != null ? `${(summary.roi * 100).toFixed(2)}%` : '—'}
              </dd>
            </div>
          </dl>
          <p className="text-[10px] text-muted-foreground">
            Breakdowns use all settled rows in the database (not limited by the 500-row history fetch). EV buckets use
            decimal edge as stored (e.g. 0.05 = 5%).
          </p>
          {loading && !analytics ? (
            <p className="text-xs text-muted-foreground mt-4">Loading breakdowns…</p>
          ) : analytics ? (
            <>
              <SegmentTable title="By prop type" rows={analytics.byPropType} />
              <SegmentTable title="By confidence tier" rows={analytics.byConfidence} />
              <SegmentTable title="By calibration version" rows={analytics.byCalibration} />
              <SegmentTable
                title="By EV bucket"
                rows={analytics.byEvBucket}
                keyLabel={(k) => EV_BUCKET_LABEL[k] ?? k}
              />
            </>
          ) : (
            <p className="text-xs text-muted-foreground mt-4">Breakdowns unavailable.</p>
          )}
        </div>
      )}

      {validTab !== 'summary' && (
        <div className="glass-card rounded-xl overflow-hidden border border-white/5">
          <div className="overflow-x-auto max-h-[calc(100vh-14rem)] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-gray-950/95 border-b border-white/10">
                <tr className="text-muted-foreground">
                  <th className="py-2 px-2 font-medium">Game</th>
                  <th className="py-2 px-2 font-medium">Player</th>
                  <th className="py-2 px-2 font-medium">Prop</th>
                  <th className="py-2 px-2 font-medium">Side</th>
                  <th className="py-2 px-2 font-medium text-right">Line</th>
                  <th className="py-2 px-2 font-medium">Book</th>
                  <th className="py-2 px-2 font-medium text-right">Odds</th>
                  <th className="py-2 px-2 font-medium text-right">Stake</th>
                  <th className="py-2 px-2 font-medium text-right">Model</th>
                  <th className="py-2 px-2 font-medium text-right">Proj</th>
                  <th className="py-2 px-2 font-medium">Track</th>
                  {validTab === 'history' && (
                    <>
                      <th className="py-2 px-2 font-medium">Result</th>
                      <th className="py-2 px-2 font-medium text-right">P/L</th>
                      <th className="py-2 px-2 font-medium">Settled</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={validTab === 'history' ? 14 : 11} className="py-8 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                ) : displayRows.length === 0 ? (
                  <tr>
                    <td colSpan={validTab === 'history' ? 14 : 11} className="py-8 text-center text-muted-foreground">
                      {validTab === 'open' ? 'No open bets. Add from Props Explorer.' : 'No settled bets yet.'}
                    </td>
                  </tr>
                ) : (
                  displayRows.map((b) => (
                    <tr key={b.id} className="border-b border-white/5 hover:bg-white/3">
                      <td className="py-1.5 px-2 font-mono">
                        <Link href={`/betting/games/${b.gameId}`} className="text-[#00d4ff] hover:underline">
                          {b.gameId}
                        </Link>
                      </td>
                      <td className="py-1.5 px-2">
                        <Link
                          href={`/betting/players/${b.playerId}`}
                          className="text-[#00d4ff] hover:underline truncate max-w-[120px] block"
                        >
                          {b.playerName ?? b.playerId}
                        </Link>
                      </td>
                      <td className="py-1.5 px-2 text-white capitalize">
                        {(b.propType ?? '—').replace(/_/g, ' ')}
                      </td>
                      <td className="py-1.5 px-2 capitalize">{b.side ?? '—'}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-white">{b.lineValue ?? '—'}</td>
                      <td className="py-1.5 px-2 text-muted-foreground truncate max-w-[100px]">
                        {b.sportsbook ?? '—'}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono">{formatOdds(b.oddsAmerican)}</td>
                      <td className="py-1.5 px-2 text-right font-mono">{b.stakeUnits}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">
                        {formatPct(b.modelProbability)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono text-white">
                        {b.projection != null && Number.isFinite(b.projection) ? b.projection.toFixed(1) : '—'}
                      </td>
                      <td className="py-1.5 px-2 text-[10px] font-mono text-muted-foreground truncate max-w-[100px]">
                        {b.evSelectedTrack ?? '—'}
                      </td>
                      {validTab === 'history' && (
                        <>
                          <td className="py-1.5 px-2 capitalize text-muted-foreground">{b.result ?? '—'}</td>
                          <td
                            className={`py-1.5 px-2 text-right font-mono ${
                              (b.profitUnits ?? 0) >= 0 ? 'text-[#39ff14]' : 'text-[#ff4757]'
                            }`}
                          >
                            {b.profitUnits != null && Number.isFinite(b.profitUnits)
                              ? `${b.profitUnits >= 0 ? '+' : ''}${b.profitUnits.toFixed(2)}`
                              : '—'}
                          </td>
                          <td className="py-1.5 px-2 text-[10px] text-muted-foreground whitespace-nowrap">
                            {b.settledAt ? new Date(b.settledAt).toLocaleString() : '—'}
                          </td>
                        </>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}

export default function PaperBetsPage() {
  return (
    <Suspense
      fallback={
        <main className="max-w-[1800px] mx-auto px-4 pt-8 pb-12">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </main>
      }
    >
      <PaperBetsContent />
    </Suspense>
  );
}
