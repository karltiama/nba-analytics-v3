'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SelectedParlayLeg } from '@/lib/parlay/selection';
import type { BookLegQuote } from '@/lib/parlay/true-cost';
import { buildWorkspaceTrueCost, legKeysFromSelected } from '@/lib/parlay/true-cost-presentation';
import { TrueCostPanel, type TrueCostPricesStatus } from './TrueCostPanel';

type PricesState = { key: string; status: TrueCostPricesStatus; quotesPerLeg: BookLegQuote[][] | null };

/** Workspace True cost panel: loads current prices for the legs, then renders the price math. */
export function WorkspaceTrueCost({ legs, className }: { legs: SelectedParlayLeg[]; className?: string }) {
  const keys = useMemo(() => legKeysFromSelected(legs), [legs]);
  const requestKey = useMemo(() => JSON.stringify(keys), [keys]);
  const [prices, setPrices] = useState<PricesState>({ key: '', status: 'loading', quotesPerLeg: null });

  useEffect(() => {
    if (keys.length === 0) return;
    const controller = new AbortController();
    setPrices({ key: requestKey, status: 'loading', quotesPerLeg: null });
    fetch('/api/betting/parlay-prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legs: keys }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 401) {
          setPrices({ key: requestKey, status: 'signed_out', quotesPerLeg: null });
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { quotesPerLeg?: BookLegQuote[][] };
        const quotes = Array.isArray(data.quotesPerLeg) && data.quotesPerLeg.length === keys.length ? data.quotesPerLeg : null;
        setPrices({ key: requestKey, status: quotes ? 'ready' : 'unavailable', quotesPerLeg: quotes });
      })
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name === 'AbortError') return;
        setPrices({ key: requestKey, status: 'unavailable', quotesPerLeg: null });
      });
    return () => controller.abort();
    // requestKey captures the leg identities; keys is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const current = prices.key === requestKey ? prices : { key: requestKey, status: 'loading' as const, quotesPerLeg: null };
  const view = useMemo(() => buildWorkspaceTrueCost(legs, current.quotesPerLeg), [legs, current.quotesPerLeg]);

  if (legs.length === 0) return null;
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
    />
  );
}
