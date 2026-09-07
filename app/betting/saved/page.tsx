'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { propsExplorerHref } from '@/lib/betting/research-journey';
import {
  savedResearchEmptyCopy,
  savedResearchLinks,
} from '@/lib/betting/saved-research';
import type { SavedResearchItem } from '@/lib/betting/saved-research-queries';
import {
  PropsExplorerMarketPanel,
  type PropsExplorerMarketSelection,
} from '@/components/betting/PropsExplorerMarketPanel';

function formatOdds(odds: number | null): string {
  if (odds == null || !Number.isFinite(odds)) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

function formatLine(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return String(value);
}

export default function SavedResearchPage() {
  const [rows, setRows] = useState<SavedResearchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<PropsExplorerMarketSelection | null>(null);
  const [compareDate, setCompareDate] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setUnauthorized(false);
    try {
      const res = await fetch('/api/user/saved-props?limit=100');
      if (res.status === 401) {
        setUnauthorized(true);
        setRows([]);
        return;
      }
      if (!res.ok) throw new Error('Failed to load saved research');
      const data = await res.json();
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string) => {
    setRemovingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/user/saved-props?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.status === 401) {
        setUnauthorized(true);
        return;
      }
      if (!res.ok) throw new Error('Could not remove bookmark');
      setRows((prev) => prev.filter((r) => r.id !== id));
      setSelectedMarket(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove bookmark');
    } finally {
      setRemovingId(null);
    }
  };

  const empty = savedResearchEmptyCopy();

  return (
    <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">Saved Research</h1>
        <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
          Bookmarks of markets you saved while researching. These are not active bets and are not
          live sportsbook offers.
        </p>
      </div>

      {unauthorized && (
        <div className="glass-card rounded-xl p-4 border-l-4 border-l-amber-500 mb-4">
          <p className="text-sm text-amber-200">Sign in to view saved research.</p>
        </div>
      )}
      {error && (
        <div className="glass-card rounded-xl p-4 border-l-4 border-l-[#ff4757] mb-4">
          <p className="text-sm text-[#ff4757]">{error}</p>
        </div>
      )}

      <div className="flex flex-col xl:flex-row xl:items-start gap-4">
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="glass-card rounded-xl p-8 text-center text-sm text-muted-foreground">
              Loading saved research…
            </div>
          ) : rows.length === 0 && !unauthorized ? (
            <div className="glass-card rounded-xl p-8 text-center space-y-3">
              <p className="text-sm text-white/80">{empty.title}</p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">{empty.detail}</p>
              <Link
                href={propsExplorerHref({})}
                className="inline-flex text-sm text-[#00d4ff] hover:underline"
              >
                {empty.cta}
              </Link>
            </div>
          ) : (
            <div className="glass-card rounded-xl overflow-hidden border border-white/5">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-gray-950/95 border-b border-white/10">
                    <tr className="text-muted-foreground">
                      <th className="py-2 px-2 font-medium">Player</th>
                      <th className="py-2 px-2 font-medium">Matchup</th>
                      <th className="py-2 px-2 font-medium">Date</th>
                      <th className="py-2 px-2 font-medium">Prop</th>
                      <th className="py-2 px-2 font-medium">Side</th>
                      <th className="py-2 px-2 font-medium text-right">Line</th>
                      <th className="py-2 px-2 font-medium">Book</th>
                      <th className="py-2 px-2 font-medium text-right">Odds</th>
                      <th className="py-2 px-2 font-medium">Context</th>
                      <th className="py-2 px-2 font-medium">Saved</th>
                      <th className="py-2 px-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const links = savedResearchLinks({
                        playerId: r.playerId,
                        gameId: r.gameId,
                        dateEt: r.dateEt,
                        propType: r.propType,
                        side: r.side,
                        sportsbook: r.sportsbook,
                        lineValue: r.lineValue,
                      });
                      return (
                        <tr key={r.id} className="border-b border-white/5 hover:bg-white/3">
                          <td className="py-1.5 px-2">
                            <Link href={links.playerHref} className="text-[#00d4ff] hover:underline">
                              {r.playerName ?? r.playerId}
                            </Link>
                          </td>
                          <td className="py-1.5 px-2 text-muted-foreground whitespace-nowrap">
                            {r.matchup ?? '—'}
                          </td>
                          <td className="py-1.5 px-2 font-mono text-muted-foreground whitespace-nowrap">
                            {r.dateEt ?? '—'}
                          </td>
                          <td className="py-1.5 px-2 capitalize text-white">
                            {(r.propType ?? '—').replace(/_/g, ' ')}
                          </td>
                          <td className="py-1.5 px-2 capitalize">{r.side ?? '—'}</td>
                          <td className="py-1.5 px-2 text-right font-mono text-white">
                            {formatLine(r.lineValue)}
                          </td>
                          <td className="py-1.5 px-2 text-muted-foreground">{r.sportsbook ?? '—'}</td>
                          <td className="py-1.5 px-2 text-right font-mono">{formatOdds(r.oddsAmerican)}</td>
                          <td className="py-1.5 px-2">
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {r.lineLabel}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-[10px] text-muted-foreground whitespace-nowrap">
                            {r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'}
                          </td>
                          <td className="py-1.5 px-2">
                            <div className="flex flex-wrap gap-1">
                              <Link
                                href={links.gameHref}
                                className="text-[10px] px-1.5 py-0.5 rounded border border-white/20 text-white hover:bg-white/10"
                              >
                                Game
                              </Link>
                              <Link
                                href={links.explorerHref}
                                className="text-[10px] px-1.5 py-0.5 rounded border border-white/20 text-white hover:bg-white/10"
                              >
                                Explorer
                              </Link>
                              <button
                                type="button"
                                onClick={() => {
                                  setCompareDate(r.dateEt ?? '');
                                  setSelectedMarket({
                                    gameId: r.gameId,
                                    playerId: r.playerId,
                                    playerName: r.playerName,
                                    propType: r.propType,
                                    side: r.side,
                                    lineValue: r.lineValue,
                                    sportsbook: r.sportsbook,
                                    oddsAmerican: r.oddsAmerican,
                                    snapshotAt: r.snapshotAt ?? '',
                                  });
                                }}
                                className="text-[10px] px-1.5 py-0.5 rounded border border-white/20 text-white hover:bg-white/10"
                              >
                                Compare
                              </button>
                              <button
                                type="button"
                                disabled={removingId === r.id}
                                onClick={() => void remove(r.id)}
                                className="text-[10px] px-1.5 py-0.5 rounded border border-white/20 text-white hover:bg-white/10 disabled:opacity-40"
                              >
                                {removingId === r.id ? '…' : 'Remove'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {selectedMarket ? (
          <aside className="hidden xl:block w-full xl:w-96 shrink-0 xl:sticky xl:top-16">
            <PropsExplorerMarketPanel
              variant="sidebar"
              selection={selectedMarket}
              dateEt={compareDate}
              onClose={() => setSelectedMarket(null)}
            />
          </aside>
        ) : null}
      </div>

      {selectedMarket ? (
        <div className="xl:hidden mt-4">
          <PropsExplorerMarketPanel
            variant="drawer"
            selection={selectedMarket}
            dateEt={compareDate}
            onClose={() => setSelectedMarket(null)}
          />
        </div>
      ) : null}
    </main>
  );
}
