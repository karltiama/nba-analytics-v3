'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { PropMarketResearch } from '@/lib/betting/prop-market-serving';
import { UPGRADE_COPY } from '@/lib/entitlements/types';
import { formatMarketRangePreview } from '@/lib/entitlements/market-preview';
import { FoundingProUpgradeLink } from '@/components/betting/FoundingProUpgradeLink';
import { MarketMovementSection } from '@/components/betting/market-movement/MarketMovementSection';
import {
  explorerBookDisplayName,
  explorerPropContextLabel,
} from '@/lib/betting/props-explorer-filters';

export type PropsExplorerMarketSelection = {
  gameId: string | number;
  playerId: number;
  playerName: string | null;
  propType: string | null;
  side: string | null;
  lineValue: number | null;
  sportsbook: string | null;
  oddsAmerican: number | null;
  snapshotAt: string;
};

type MarketPayload = PropMarketResearch & {
  entitlement?: {
    plan: 'free' | 'founding_pro';
    isPro: boolean;
    features?: {
      line_shopping_detail?: boolean;
      market_movement?: boolean;
    };
  };
};

type Props = {
  selection: PropsExplorerMarketSelection;
  dateEt: string;
  variant: 'sidebar' | 'drawer';
  onClose: () => void;
};

function formatOdds(odds: number | null | undefined): string {
  if (odds == null || !Number.isFinite(odds)) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

function formatBook(name: string | null | undefined): string {
  return explorerBookDisplayName(name);
}

function formatLine(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return String(value);
}

function MarketBody({
  data,
  loading,
  error,
  readable = false,
}: {
  data: MarketPayload | null;
  loading: boolean;
  error: string | null;
  readable?: boolean;
}) {
  if (loading) {
    // Do not mount MarketMovementSection here — viewed events fire only after a resolved payload.
    return (
      <div className="space-y-3" aria-busy="true" aria-live="polite">
        <p className="type-secondary text-center">Loading market comparison…</p>
        <div className="rounded-lg border border-[#DCE9EA] bg-[#F8FBFA] h-16" />
        <div
          data-market-section="market-movement-loading"
          className="rounded-lg border border-[#DCE9EA] bg-[#F8FBFA] p-2.5 min-h-[5.5rem]"
        >
          <p className="type-secondary">
            Market Movement
          </p>
          {/* Resolved MarketMovementSection is not mounted here — no market_movement_viewed. */}
          <p className="type-metadata mt-2">Loading certified history…</p>
        </div>
      </div>
    );
  }
  if (error) {
    return <p className="type-body py-4 text-center text-red-600">{error}</p>;
  }
  if (!data) return null;

  const shopping = data.shopping;
  const lineShoppingOn = data.entitlement?.features?.line_shopping_detail === true;

  return (
    <div className="space-y-3">
      <p className="type-secondary">{data.comparisonLabel}</p>
      <p className="type-metadata">{data.lineLabel}</p>

      <section className="rounded-lg border border-[#DCE9EA] bg-[#F8FBFA] p-2.5 space-y-1">
        <h3 className="type-secondary">Selected</h3>
        <p className="type-card-data whitespace-nowrap text-[#063f46]">
          {formatBook(data.selected.sportsbook)} {data.selected.side} {formatLine(data.selected.lineValue)}{' '}
          {formatOdds(data.selected.oddsAmerican)}
        </p>
      </section>

      {shopping.status !== 'ok' ? (
        <p className="type-secondary">{shopping.message}</p>
      ) : (
        <>
          <section
            data-market-section="range"
            className="rounded-lg border border-[#DCE9EA] bg-[#F8FBFA] p-2.5 space-y-1"
          >
            <h3 className="type-secondary">Market range</h3>
            <p className="type-card-data whitespace-nowrap text-[#063f46]">
              {formatMarketRangePreview(shopping.bookCount, shopping.marketMinLine, shopping.marketMaxLine)}
            </p>
            {shopping.latestSnapshotAt ? (
              <p className="type-metadata">
                Comparable snapshot {new Date(shopping.latestSnapshotAt).toLocaleString()}
              </p>
            ) : null}
          </section>

          {lineShoppingOn ? (
            <>
              <section
                data-market-section="best-line"
                data-premium-candidate="best-line"
                className="rounded-lg border border-[#DCE9EA] bg-[#F8FBFA] p-2.5 space-y-1"
              >
                <h3 className="type-secondary">Best available line</h3>
                {shopping.bestAvailableOverLine || shopping.bestAvailableUnderLine ? (
                  <>
                    {shopping.bestAvailableOverLine ? (
                      <p className="type-card-data whitespace-nowrap text-[#063f46]">
                        Over {formatBook(shopping.bestAvailableOverLine.sportsbook)}{' '}
                        {formatLine(shopping.bestAvailableOverLine.lineValue)}{' '}
                        {formatOdds(shopping.bestAvailableOverLine.oddsAmerican)}
                      </p>
                    ) : null}
                    {shopping.bestAvailableUnderLine ? (
                      <p className="type-card-data whitespace-nowrap text-[#063f46]">
                        Under {formatBook(shopping.bestAvailableUnderLine.sportsbook)}{' '}
                        {formatLine(shopping.bestAvailableUnderLine.lineValue)}{' '}
                        {formatOdds(shopping.bestAvailableUnderLine.oddsAmerican)}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="type-secondary">No comparable best line</p>
                )}
              </section>

              <section
                data-market-section="best-price"
                data-premium-candidate="best-price"
                className="rounded-lg border border-[#DCE9EA] bg-[#F8FBFA] p-2.5 space-y-1"
              >
                <h3 className="type-secondary">Best price at this line</h3>
                {shopping.bestPriceAtSelectedLine ? (
                  <p className="type-card-data whitespace-nowrap text-[#063f46]">
                    {formatBook(shopping.bestPriceAtSelectedLine.sportsbook)} {shopping.bestPriceAtSelectedLine.side}{' '}
                    {formatLine(shopping.bestPriceAtSelectedLine.lineValue)}{' '}
                    {formatOdds(shopping.bestPriceAtSelectedLine.oddsAmerican)}
                  </p>
                ) : (
                  <p className="type-secondary">No other book at this line</p>
                )}
              </section>

              {shopping.books.length > 0 ? (
                <section
                  data-market-section="books"
                  className="rounded-lg border border-[#DCE9EA] bg-[#F8FBFA] p-2.5 space-y-1.5"
                >
                  <h3 className="type-secondary">Sportsbook comparison</h3>
                  <ul className="space-y-1">
                    {shopping.books.map((book) => (
                      <li
                        key={`${book.sportsbook}-${book.side}-${book.lineValue}-${book.oddsAmerican}`}
                        className="flex justify-between gap-2"
                      >
                        <span className={readable ? 'type-secondary min-w-0 truncate' : 'truncate'}>
                          {formatBook(book.sportsbook)}
                        </span>
                        <span className={readable ? 'type-card-data shrink-0 whitespace-nowrap text-[#063f46]' : 'shrink-0 text-[#4a6366]'}>
                          {book.side} {formatLine(book.lineValue)} {formatOdds(book.oddsAmerican)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          ) : (
            <section
              data-market-section="upgrade"
              data-premium-candidate="line-shopping"
              className="rounded-lg border border-dashed border-[#075B5C] bg-white p-2.5 space-y-2"
            >
              <h3 className="type-secondary">{UPGRADE_COPY.line_shopping_detail.title}</h3>
              <p className="type-body text-cc-secondary">{UPGRADE_COPY.line_shopping_detail.detail}</p>
              <FoundingProUpgradeLink analyticsSurface="props_explorer_line_shopping" />
            </section>
          )}
        </>
      )}

      <MarketMovementSection
        marketMovement={data.marketMovement}
        selectedSide={data.selected.side}
      />
    </div>
  );
}

export function PropsExplorerMarketPanel({ selection, dateEt, variant, onClose }: Props) {
  const [data, setData] = useState<MarketPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setData(null);
      setError(null);
      try {
        const u = new URL('/api/betting/props-explorer/market', window.location.origin);
        u.searchParams.set('game_id', String(selection.gameId));
        u.searchParams.set('player_id', String(selection.playerId));
        u.searchParams.set('prop_type', selection.propType ?? '');
        u.searchParams.set('side', selection.side ?? '');
        u.searchParams.set('line_value', selection.lineValue == null ? '' : String(selection.lineValue));
        u.searchParams.set('sportsbook', selection.sportsbook ?? '');
        u.searchParams.set('snapshot_at', selection.snapshotAt);
        if (selection.oddsAmerican != null) {
          u.searchParams.set('odds_american', String(selection.oddsAmerican));
        }
        u.searchParams.set('date', dateEt);
        const res = await fetch(u.toString());
        if (!res.ok) throw new Error('Failed to load market comparison');
        const json = (await res.json()) as MarketPayload;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) {
          setData(null);
          setError(e instanceof Error ? e.message : 'Error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selection, dateEt]);

  const drawer = variant === 'drawer';
  const inner = (
    <div
      className={
        drawer
          ? 'flex h-full min-h-0 flex-col bg-white'
          : 'flex flex-col h-full min-h-0 bg-white border border-[#DCE9EA] rounded-2xl shadow-sm overflow-hidden'
      }
    >
      <div className="px-3 py-2 border-b border-[#DCE9EA] bg-[#F8FBFA] flex items-start justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <h2
            className="type-card-data truncate text-[#063f46]"
            data-coachmark="props-compare"
          >
            {selection.playerName ?? `Player ${selection.playerId}`}
          </h2>
          <p className="type-secondary mt-0.5 capitalize">
            {explorerPropContextLabel(selection.propType, selection.side, selection.lineValue)}
          </p>
          <p className="type-metadata mt-0.5">Compare books</p>
        </div>
        <button
          type="button"
          className={
            drawer
              ? 'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-[#063f46]'
              : 'p-1.5 rounded-lg text-[#4a6366] hover:text-[#063f46] hover:bg-[#f7f9f7] shrink-0'
          }
          aria-label="Close market comparison"
          onClick={onClose}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div
        className={
          drawer
            ? 'min-h-0 flex-1 overflow-y-auto p-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]'
            : 'p-2.5 sm:p-3 overflow-y-auto flex-1 min-h-0'
        }
      >
        <MarketBody data={data} loading={loading} error={error} readable />
      </div>
    </div>
  );

  if (variant === 'drawer') {
    return (
      <div className="fixed inset-0 z-50 xl:hidden" role="dialog" aria-modal="true">
        <button
          type="button"
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          aria-label="Dismiss"
          onClick={onClose}
        />
        <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-[#DCE9EA] bg-white pt-[env(safe-area-inset-top)] shadow-2xl">
          <div className="flex-1 min-h-0 flex flex-col">{inner}</div>
        </div>
      </div>
    );
  }

  return inner;
}
