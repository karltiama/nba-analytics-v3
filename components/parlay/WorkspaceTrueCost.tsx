'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SelectedParlayLeg } from '@/lib/parlay/selection';
import type { BookLegQuote } from '@/lib/parlay/true-cost';
import { buildWorkspaceTrueCost, legKeysFromSelected } from '@/lib/parlay/true-cost-presentation';
import {
  buildResearchSnapshotCost,
  RESEARCH_SNAPSHOT_BREAK_EVEN_COPY,
  RESEARCH_SNAPSHOT_COST_COPY,
  shouldRequestCurrentParlayPrices,
  ticketUsesResearchSnapshot,
} from '@/lib/parlay/research-snapshot-cost';
import { TrueCostPanel, type TrueCostPricesStatus } from './TrueCostPanel';

type PricesState = { key: string; status: TrueCostPricesStatus; quotesPerLeg: BookLegQuote[][] | null };

/** Workspace True cost panel: loads current prices for the legs, then renders the price math. */
export function WorkspaceTrueCost({
  legs,
  className,
  layout,
}: {
  legs: SelectedParlayLeg[];
  className?: string;
  layout?: 'wide' | 'rail';
}) {
  const keys = useMemo(() => legKeysFromSelected(legs), [legs]);
  const requestKey = useMemo(() => JSON.stringify(keys), [keys]);
  const requestCurrent = shouldRequestCurrentParlayPrices(legs);
  const [prices, setPrices] = useState<PricesState>({ key: '', status: 'loading', quotesPerLeg: null });

  useEffect(() => {
    if (!requestCurrent) return;
    const requested = JSON.parse(requestKey) as ReturnType<typeof legKeysFromSelected>;
    const controller = new AbortController();
    fetch('/api/betting/parlay-prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legs: requested }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 401) {
          setPrices({ key: requestKey, status: 'signed_out', quotesPerLeg: null });
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { quotesPerLeg?: BookLegQuote[][] };
        const quotes = Array.isArray(data.quotesPerLeg) && data.quotesPerLeg.length === requested.length ? data.quotesPerLeg : null;
        setPrices({ key: requestKey, status: quotes ? 'ready' : 'unavailable', quotesPerLeg: quotes });
      })
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name === 'AbortError') return;
        setPrices({ key: requestKey, status: 'unavailable', quotesPerLeg: null });
      });
    return () => controller.abort();
  }, [requestKey, requestCurrent]);

  const current = prices.key === requestKey ? prices : { key: requestKey, status: 'loading' as const, quotesPerLeg: null };
  const view = useMemo(() => buildWorkspaceTrueCost(legs, current.quotesPerLeg), [legs, current.quotesPerLeg]);

  if (legs.length === 0) return null;
  if (ticketUsesResearchSnapshot(legs)) return <ResearchSnapshotCostView legs={legs} className={className} />;
  return (
    <TrueCostPanel
      view={view}
      pricesStatus={current.status}
      unknownHint={
        current.status === 'loading'
          ? 'Loading the other side from current prices…'
          : 'The other side comes from current prices at the same book and line.'
      }
      className={className}
      layout={layout}
    />
  );
}

function ResearchSnapshotCostView({ legs, className }: { legs: SelectedParlayLeg[]; className?: string }) {
  const cost = buildResearchSnapshotCost(legs);
  return (
    <section className={className ?? 'rounded-2xl border border-[#DCE9EA] bg-white p-4 shadow-sm'} aria-label="True cost">
      <h2 className="type-section-heading text-[#063f46]">True cost</h2>
      <p className="type-metadata mt-1 text-[#063f46]">Research Snapshot</p>
      <ul className="mt-3 space-y-2">
        {cost.legs.map((leg) => (
          <li key={leg.id} className="rounded-xl border border-[#DCE9EA] bg-[#f7f9f7] p-3">
            <p className="type-body text-[#063f46]">{leg.label}</p>
            <p className="type-card-data mt-1 text-[#063f46]">Original observed price {leg.oddsLabel}</p>
            <p className="type-metadata mt-1">Observed {leg.observedLabel}</p>
          </li>
        ))}
      </ul>
      {cost.status === 'known' ? (
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="type-metadata">Calculated combined odds</dt>
            <dd className="type-card-data text-[#063f46]">{cost.combinedOddsLabel}</dd>
          </div>
          <div>
            <dt className="type-metadata">Break-even probability</dt>
            <dd className="type-card-data text-[#063f46]">{cost.breakEvenLabel}</dd>
          </div>
        </dl>
      ) : (
        <p className="type-body mt-3 text-[#9a3412]" role="status">
          These snapshot prices cannot be combined.
        </p>
      )}
      <p className="type-secondary mt-3">{RESEARCH_SNAPSHOT_BREAK_EVEN_COPY}</p>
      <p className="type-secondary mt-2">{RESEARCH_SNAPSHOT_COST_COPY}</p>
    </section>
  );
}
