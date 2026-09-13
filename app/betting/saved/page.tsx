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
import { TeamLogo } from '@/components/nba/TeamLogo';

function formatOdds(odds: number | null): string {
  if (odds == null || !Number.isFinite(odds)) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

function formatLine(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return String(value);
}

function MatchupCell({ matchup }: { matchup: string | null }) {
  if (!matchup) return <span className="text-[#4a6366]">—</span>;
  const [away, home] = matchup.split(' @ ');
  if (!away || !home) {
    return <span className="text-[#4a6366] whitespace-nowrap">{matchup}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[#063f46]">
      <TeamLogo team={away} size="xs" decorative />
      <span>{away}</span>
      <span className="text-[#8aa0a3]">@</span>
      <TeamLogo team={home} size="xs" decorative />
      <span>{home}</span>
    </span>
  );
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
        <h1 className="text-xl font-semibold text-[#063f46]">Saved Research</h1>
        <p className="text-xs text-[#4a6366] mt-1 max-w-2xl">
          Bookmarks of markets you saved while researching. These are not active bets and are not
          live sportsbook offers.
        </p>
      </div>

      {unauthorized && (
        <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-4 border-l-4 border-l-amber-500 mb-4">
          <p className="text-sm text-amber-800">Sign in to view saved research.</p>
        </div>
      )}
      {error && (
        <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-4 border-l-4 border-l-red-500 mb-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex flex-col xl:flex-row xl:items-start gap-4">
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-8 text-center text-sm text-[#4a6366]">
              Loading saved research…
            </div>
          ) : rows.length === 0 && !unauthorized ? (
            <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm p-8 text-center space-y-3">
              <p className="text-sm text-[#063f46]">{empty.title}</p>
              <p className="text-xs text-[#4a6366] max-w-md mx-auto">{empty.detail}</p>
              <Link
                href={propsExplorerHref({})}
                className="inline-flex text-sm text-[#075B5C] hover:underline"
              >
                {empty.cta}
              </Link>
            </div>
          ) : (
            <div className="bg-white border border-[#DCE9EA] rounded-2xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-[#F8FBFA] border-b border-[#DCE9EA]">
                    <tr className="text-[#4a6366]">
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
                        <tr key={r.id} className="border-b border-[#DCE9EA] hover:bg-[#f7f9f7]">
                          <td className="py-1.5 px-2">
                            <Link href={links.playerHref} className="text-[#075B5C] hover:underline">
                              {r.playerName ?? r.playerId}
                            </Link>
                          </td>
                          <td className="py-1.5 px-2">
                            <MatchupCell matchup={r.matchup} />
                          </td>
                          <td className="py-1.5 px-2 font-mono text-[#4a6366] whitespace-nowrap">
                            {r.dateEt ?? '—'}
                          </td>
                          <td className="py-1.5 px-2 capitalize text-[#063f46]">
                            {(r.propType ?? '—').replace(/_/g, ' ')}
                          </td>
                          <td className="py-1.5 px-2 capitalize text-[#063f46]">{r.side ?? '—'}</td>
                          <td className="py-1.5 px-2 text-right font-mono text-[#063f46]">
                            {formatLine(r.lineValue)}
                          </td>
                          <td className="py-1.5 px-2 text-[#4a6366]">{r.sportsbook ?? '—'}</td>
                          <td className="py-1.5 px-2 text-right font-mono text-[#063f46]">{formatOdds(r.oddsAmerican)}</td>
                          <td className="py-1.5 px-2">
                            <span className="text-[10px] uppercase tracking-wide text-[#4a6366]">
                              {r.lineLabel}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-[10px] text-[#8aa0a3] whitespace-nowrap">
                            {r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'}
                          </td>
                          <td className="py-1.5 px-2">
                            <div className="flex flex-wrap gap-1">
                              <Link
                                href={links.gameHref}
                                className="text-[10px] px-1.5 py-0.5 rounded border border-[#DCE9EA] text-[#063f46] hover:bg-[#f7f9f7]"
                              >
                                Game
                              </Link>
                              <Link
                                href={links.explorerHref}
                                className="text-[10px] px-1.5 py-0.5 rounded border border-[#DCE9EA] text-[#063f46] hover:bg-[#f7f9f7]"
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
                                className="text-[10px] px-1.5 py-0.5 rounded border border-[#DCE9EA] text-[#063f46] hover:bg-[#f7f9f7]"
                              >
                                Compare
                              </button>
                              <button
                                type="button"
                                disabled={removingId === r.id}
                                onClick={() => void remove(r.id)}
                                className="text-[10px] px-1.5 py-0.5 rounded border border-[#DCE9EA] text-[#063f46] hover:bg-[#f7f9f7] disabled:opacity-40"
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
