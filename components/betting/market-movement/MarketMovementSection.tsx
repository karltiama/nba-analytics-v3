'use client';

import { useEffect, useRef } from 'react';
import { FoundingProUpgradeLink } from '@/components/betting/FoundingProUpgradeLink';
import type { PlayerMarketMovementResponse } from '@/lib/betting/market-movement-api';
import {
  MM_DISCLAIMER_SHORT,
  MM_FREE_TITLE,
  presentPlayerMarketMovement,
  type PresentedBookRow,
  type PresentedConsensus,
  type PresentedMarketMovement,
} from '@/lib/betting/market-movement-present';
import {
  MARKET_MOVEMENT_UPGRADE_CLICKED,
  MARKET_MOVEMENT_VIEWED,
  marketMovementUpgradeClickedProperties,
  marketMovementViewKey,
  marketMovementViewedIfChanged,
} from '@/lib/product-analytics/market-movement-events';
import { trackEvent } from '@/lib/product-analytics/track-event';

function SnapshotColumn({
  heading,
  consensus,
  align,
}: {
  heading: string;
  consensus: PresentedConsensus;
  align: 'start' | 'end';
}) {
  const alignCls = align === 'end' ? 'sm:text-right' : 'sm:text-left';
  return (
    <div className={`flex-1 min-w-0 text-center ${alignCls}`}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{heading}</p>
      <p className="text-lg font-semibold text-white tabular-nums leading-tight mt-0.5">
        {consensus.available ? consensus.medianLabel : '—'}
      </p>
    </div>
  );
}

function SportsbookMovementRow({
  book,
  referenceLabel,
  comparisonLabel,
}: {
  book: PresentedBookRow;
  referenceLabel: string;
  comparisonLabel: string;
}) {
  return (
    <li className="rounded-md bg-white/[0.03] px-2 py-2 space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-white truncate">{book.vendorLabel}</span>
        <span className="text-[11px] text-muted-foreground shrink-0">
          {book.classLabel}
          <span className="sr-only"> — {book.classExplanation}</span>
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
        <p className="text-xs text-white tabular-nums">
          <span className="text-muted-foreground">{referenceLabel} </span>
          {book.referenceQuote}
        </p>
        <p className="text-xs text-white tabular-nums sm:text-right">
          <span className="text-muted-foreground">{comparisonLabel} </span>
          {book.comparisonQuote}
        </p>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {book.lineDeltaLabel ? (
          <span className="text-white tabular-nums">{book.lineDeltaLabel} · </span>
        ) : null}
        {book.classExplanation}
        {book.priceMovementLabel && !book.juiceContext ? (
          <span className="tabular-nums"> · {book.priceMovementLabel}</span>
        ) : null}
      </p>
      {book.juiceContext ? (
        <p className="text-[11px] text-muted-foreground">{book.juiceContext}</p>
      ) : null}
    </li>
  );
}

function MarketMovementBody({ presented }: { presented: PresentedMarketMovement }) {
  if (presented.state === 'empty' || presented.state === 'unsupported') {
    return (
      <>
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Market Movement
        </h3>
        <p className="text-xs text-white">{presented.title}</p>
        <p className="text-[11px] text-muted-foreground">{presented.body}</p>
      </>
    );
  }

  if (presented.state === 'free') {
    return (
      <>
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {presented.title}
        </h3>
        {presented.consensusUnavailable ? (
          <p className="text-xs text-muted-foreground">Close consensus needs at least 2 supported books.</p>
        ) : (
          <>
            <p className="text-lg font-semibold text-white tabular-nums leading-tight">
              {presented.close.medianLabel}
            </p>
            {presented.close.rangeLabel ? (
              <p className="text-[11px] text-muted-foreground tabular-nums">{presented.close.rangeLabel}</p>
            ) : null}
            {presented.acrossLabel ? (
              <p className="text-[11px] text-muted-foreground">{presented.acrossLabel}</p>
            ) : null}
            <p className="text-[11px] text-muted-foreground">{MM_DISCLAIMER_SHORT}</p>
          </>
        )}
        <div className="pt-1 space-y-1.5">
          <p className="text-xs text-muted-foreground">{presented.upgradeTitle}</p>
          <FoundingProUpgradeLink
            className="px-2.5 py-1 text-[11px]"
            onClick={() => {
              trackEvent(MARKET_MOVEMENT_UPGRADE_CLICKED, marketMovementUpgradeClickedProperties());
            }}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {presented.title}
      </h3>
      <p className="sr-only">
        Certified historical movement from {presented.referenceLabel} to {presented.comparisonLabel}.
        Not live current.
      </p>
      {presented.oneBook || presented.consensusUnavailable ? (
        <div>
          <p className="text-xs text-white">{presented.oneBookTitle}</p>
          <p className="text-[11px] text-muted-foreground">{presented.oneBookDetail}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <SnapshotColumn heading={presented.referenceLabel} consensus={presented.reference} align="start" />
            <div
              className="flex flex-row sm:flex-col items-center justify-center shrink-0 gap-1 py-0.5"
              aria-label={
                presented.consensusDeltaLabel
                  ? `Moved ${presented.consensusDeltaLabel} from ${presented.referenceLabel} to ${presented.comparisonLabel}`
                  : `${presented.referenceLabel} to ${presented.comparisonLabel}`
              }
            >
              <span className="text-[11px] text-muted-foreground" aria-hidden>
                →
              </span>
              {presented.consensusDeltaLabel ? (
                <span className="text-lg font-semibold text-white tabular-nums leading-tight">
                  {presented.consensusDeltaLabel}
                </span>
              ) : null}
              <span className="text-[11px] text-muted-foreground hidden sm:inline" aria-hidden>
                →
              </span>
            </div>
            <SnapshotColumn heading={presented.comparisonLabel} consensus={presented.comparison} align="end" />
          </div>
          {presented.acrossLabel ? (
            <p className="text-[11px] text-muted-foreground">{presented.acrossLabel}</p>
          ) : null}
          <p className="text-[11px] text-muted-foreground">{presented.disclaimer}</p>
        </div>
      )}
      {presented.books.length > 0 ? (
        <ul className="space-y-1.5 pt-1" aria-label="Sportsbook movement">
          {presented.books.map((book) => (
            <SportsbookMovementRow
              key={book.vendor}
              book={book}
              referenceLabel={presented.rowReferenceLabel}
              comparisonLabel={presented.rowComparisonLabel}
            />
          ))}
        </ul>
      ) : null}
    </>
  );
}

export function MarketMovementSection({
  marketMovement,
  selectedSide,
}: {
  marketMovement: PlayerMarketMovementResponse;
  selectedSide?: string | null;
}) {
  const presented = presentPlayerMarketMovement(marketMovement, selectedSide);
  const viewKey = marketMovementViewKey(marketMovement);
  const lastViewKey = useRef<string | null>(null);

  useEffect(() => {
    const next = marketMovementViewedIfChanged(lastViewKey.current, marketMovement);
    if (!next) return;
    lastViewKey.current = next.key;
    trackEvent(MARKET_MOVEMENT_VIEWED, next.properties);
  }, [marketMovement, viewKey]);

  return (
    <section
      data-market-section="market-movement"
      data-mm-state={presented.state}
      data-premium-candidate="movement"
      className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 space-y-2"
      aria-label={presented.state === 'free' ? MM_FREE_TITLE : presented.title}
    >
      <MarketMovementBody presented={presented} />
    </section>
  );
}
