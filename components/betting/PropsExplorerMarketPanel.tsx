'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { PropMarketResearch } from '@/lib/betting/prop-market-serving';
import { UPGRADE_COPY } from '@/lib/entitlements/types';

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
  if (!name) return '—';
  return name
    .split(/[\s_]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatLine(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return String(value);
}

function formatDelta(delta: number | null): string {
  if (delta == null || !Number.isFinite(delta)) return '—';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta} points`;
}

function MarketBody({
  data,
  loading,
  error,
}: {
  data: MarketPayload | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <p className="text-xs text-muted-foreground py-6 text-center" aria-busy="true">
        Loading market comparison…
      </p>
    );
  }
  if (error) {
    return <p className="text-xs text-[#ff4757] py-4 text-center">{error}</p>;
  }
  if (!data) return null;

  const shopping = data.shopping;
  const movement = data.movement;
  const showLineShoppingUpgrade = data.entitlement?.features?.line_shopping_detail === false;
  const showMovementUpgrade = movement.reason === 'entitlement';

  return (
    <div className="space-y-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{data.comparisonLabel}</p>
      <p className="text-[11px] text-muted-foreground">{data.lineLabel}</p>

      <section className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 space-y-1">
        <h3 className="text-[11px] font-medium text-white">Selected</h3>
        <p className="text-xs text-white">
          {formatBook(data.selected.sportsbook)} {data.selected.side} {formatLine(data.selected.lineValue)}{' '}
          {formatOdds(data.selected.oddsAmerican)}
        </p>
      </section>

      {shopping.status !== 'ok' ? (
        <p className="text-xs text-muted-foreground">{shopping.message}</p>
      ) : (
        <>
          <section
            data-market-section="range"
            className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 space-y-1"
          >
            <h3 className="text-[11px] font-medium text-white">Market range</h3>
            <p className="text-xs text-muted-foreground">
              {formatLine(shopping.marketMinLine)} – {formatLine(shopping.marketMaxLine)} · {shopping.bookCount}{' '}
              books
            </p>
            {shopping.latestSnapshotAt ? (
              <p className="text-[11px] text-muted-foreground">
                Comparable snapshot {new Date(shopping.latestSnapshotAt).toLocaleString()}
              </p>
            ) : null}
          </section>

          <section
            data-market-section="best-line"
            data-premium-candidate="best-line"
            className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 space-y-1"
          >
            <h3 className="text-[11px] font-medium text-white">Best available line</h3>
            {showLineShoppingUpgrade ? (
              <p className="text-xs text-muted-foreground">
                {UPGRADE_COPY.line_shopping_detail.title}. {UPGRADE_COPY.line_shopping_detail.detail}{' '}
                <span className="text-white/70">Upgrade</span>
              </p>
            ) : shopping.bestAvailableOverLine || shopping.bestAvailableUnderLine ? (
              <>
                {shopping.bestAvailableOverLine ? (
                  <p className="text-xs text-white">
                    Over {formatBook(shopping.bestAvailableOverLine.sportsbook)}{' '}
                    {formatLine(shopping.bestAvailableOverLine.lineValue)}{' '}
                    {formatOdds(shopping.bestAvailableOverLine.oddsAmerican)}
                  </p>
                ) : null}
                {shopping.bestAvailableUnderLine ? (
                  <p className="text-xs text-white">
                    Under {formatBook(shopping.bestAvailableUnderLine.sportsbook)}{' '}
                    {formatLine(shopping.bestAvailableUnderLine.lineValue)}{' '}
                    {formatOdds(shopping.bestAvailableUnderLine.oddsAmerican)}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No comparable best line</p>
            )}
          </section>

          <section
            data-market-section="best-price"
            data-premium-candidate="best-price"
            className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 space-y-1"
          >
            <h3 className="text-[11px] font-medium text-white">Best price at this line</h3>
            {showLineShoppingUpgrade ? (
              <p className="text-xs text-muted-foreground">
                {UPGRADE_COPY.line_shopping_detail.title}.{' '}
                <span className="text-white/70">Upgrade</span>
              </p>
            ) : shopping.bestPriceAtSelectedLine ? (
              <p className="text-xs text-white">
                {formatBook(shopping.bestPriceAtSelectedLine.sportsbook)} {shopping.bestPriceAtSelectedLine.side}{' '}
                {formatLine(shopping.bestPriceAtSelectedLine.lineValue)}{' '}
                {formatOdds(shopping.bestPriceAtSelectedLine.oddsAmerican)}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">No other book at this line</p>
            )}
          </section>
        </>
      )}

      <section
        data-market-section="movement"
        data-premium-candidate="movement"
        className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 space-y-1"
      >
        <h3 className="text-[11px] font-medium text-white">Line moved</h3>
        {movement.status !== 'ok' ? (
          <p className="text-xs text-muted-foreground">
            {showMovementUpgrade ? (
              <>
                {UPGRADE_COPY.market_movement.title}. {UPGRADE_COPY.market_movement.detail}{' '}
                <span className="text-white/70">Upgrade</span>
              </>
            ) : (
              movement.message
            )}
          </p>
        ) : (
          <p className="text-xs text-white">
            Opened {formatLine(movement.openedLine)} → Closed {formatLine(movement.closedLine)}
            <span className="block text-muted-foreground mt-0.5">{formatDelta(movement.delta)}</span>
          </p>
        )}
      </section>
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

  const inner = (
    <div className="flex flex-col h-full min-h-0 rounded-xl border border-white/10 bg-background/80 overflow-hidden">
      <div className="px-3 py-2.5 border-b border-white/5 bg-white/[0.02] flex items-start justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white truncate">
            {selection.playerName ?? `Player ${selection.playerId}`}
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {(selection.propType ?? 'prop').replace(/_/g, ' ')} · Compare books
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 shrink-0"
          aria-label="Close market comparison"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-2.5 sm:p-3 overflow-y-auto flex-1 min-h-0">
        <MarketBody data={data} loading={loading} error={error} />
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
        <div className="absolute inset-y-0 right-0 w-full max-w-md flex flex-col p-2 sm:p-3 border-l border-white/10 bg-background/95 backdrop-blur-md shadow-2xl">
          <div className="flex-1 min-h-0 flex flex-col">{inner}</div>
        </div>
      </div>
    );
  }

  return inner;
}
