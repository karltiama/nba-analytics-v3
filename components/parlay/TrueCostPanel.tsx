import type { ReactNode } from 'react';
import { Calculator, Info } from 'lucide-react';
import { formatAmericanOdds } from '@/lib/betting/market-movement-format';
import {
  formatDollars,
  formatPercent,
  profitPer100,
  TRUE_COST_UNKNOWN_COPY,
  type BestBookResult,
  type TrueCostLeg,
} from '@/lib/parlay/true-cost';
import {
  HEAVY_FAVORITE_NOTE,
  TRUE_COST_DISCLAIMER,
  TRUE_COST_INDEPENDENCE_NOTE,
  type TrueCostView,
} from '@/lib/parlay/true-cost-presentation';
import { cn } from '@/lib/utils';

export type TrueCostPricesStatus = 'loading' | 'ready' | 'unavailable' | 'signed_out' | 'not_applicable';

function odds(value: number | null | undefined): string {
  return value == null ? '—' : formatAmericanOdds(value);
}

function Stat({ label, value, hint, tone = 'default' }: { label: string; value: string; hint?: string; tone?: 'default' | 'cost' }) {
  return (
    <div className="min-w-0 rounded-xl border border-[#DCE9EA] bg-[#f7f9f7] px-3 py-2.5">
      <dt className="type-metadata">{label}</dt>
      <dd className={cn('type-card-data mt-0.5', tone === 'cost' ? 'text-[#9a3412]' : 'text-[#063f46]')}>{value}</dd>
      {hint ? <p className="type-metadata mt-0.5">{hint}</p> : null}
    </div>
  );
}

function legFairCell(leg: TrueCostLeg): { noVig: string; hold: string; legCost: string } {
  if (leg.fair.status !== 'known') return { noVig: 'Unknown', hold: 'Unknown', legCost: 'Unknown' };
  return {
    noVig: formatPercent(leg.fair.probability),
    hold: formatPercent(leg.fair.hold),
    legCost: formatPercent(leg.fair.houseEdge),
  };
}

export function TrueCostPanel({
  view,
  pricesStatus,
  unknownHint,
  className,
}: {
  view: TrueCostView;
  pricesStatus: TrueCostPricesStatus;
  /** Shown when fair odds are unknown, e.g. how to get the other side's price. */
  unknownHint?: string;
  className?: string;
}) {
  const { result, bestBook, linkedLegs } = view;
  const { book, fair } = result;
  const labels = new Map(view.legs.map((leg) => [leg.id, leg]));

  const houseEdge = fair.status === 'known' ? fair.houseEdge : null;
  const lossPer100 = houseEdge != null ? houseEdge * 100 : null;

  return (
    <section
      className={cn('rounded-2xl border border-[#DCE9EA] bg-white p-3 shadow-sm sm:p-4', className)}
      aria-labelledby="true-cost-heading"
      data-testid="true-cost-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#e7f8ef] text-[#0f6b45]" aria-hidden>
            <Calculator className="h-3.5 w-3.5" />
          </span>
          <h2 id="true-cost-heading" className="type-section-heading text-[#063f46]">
            True cost
          </h2>
        </div>
        <p className="type-badge rounded-full border border-[#DCE9EA] px-2 py-0.5 text-[#4a6366]">{TRUE_COST_DISCLAIMER}</p>
      </div>
      <p className="type-secondary mt-1">
        What the book pays for this parlay compared with the payout at no-vig prices.
      </p>

      {book.status !== 'known' ? (
        <p className="type-body mt-3 text-cc-secondary" role="status">
          {TRUE_COST_UNKNOWN_COPY[book.reason]}
        </p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat
              label="Net profit on $100"
              value={formatDollars(profitPer100(book.decimal))}
              hint={`${odds(book.american)} · break-even ${formatPercent(book.breakEvenHitRate)} · total return ${formatDollars(profitPer100(book.decimal) + 100)}`}
            />
            <Stat
              label="Fair net profit on $100"
              value={fair.status === 'known' ? formatDollars(profitPer100(fair.decimal)) : 'Unknown'}
              hint={
                fair.status === 'known'
                  ? `${odds(fair.american)} · fair chance ${formatPercent(fair.probability)}`
                  : 'Needs both sides of every leg'
              }
            />
            <Stat
              label="House edge"
              value={houseEdge != null ? formatPercent(houseEdge) : 'Unknown'}
              hint="1 − fair chance × book payout"
              tone={houseEdge != null && houseEdge > 0 ? 'cost' : 'default'}
            />
            <Stat
              label={lossPer100 != null && lossPer100 < 0 ? 'Expected gain per $100' : 'Expected loss per $100'}
              value={lossPer100 != null ? formatDollars(Math.abs(lossPer100)) : 'Unknown'}
              hint="Average over many bets at fair prices"
              tone={lossPer100 != null && lossPer100 > 0 ? 'cost' : 'default'}
            />
          </dl>
          {fair.status !== 'known' ? (
            <p className="type-secondary mt-2" role="status">
              {TRUE_COST_UNKNOWN_COPY[fair.reason]}
              {fair.legIds.length > 0
                ? ` Missing: ${fair.legIds.map((id) => labels.get(id)?.label ?? id).join('; ')}.`
                : ''}
              {unknownHint ? ` ${unknownHint}` : ''}
            </p>
          ) : null}
        </>
      )}

      {result.legs.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <h3 className="type-metadata mb-1 uppercase tracking-wide">Vig by leg</h3>
          <table className="w-full min-w-[34rem] text-left">
            <thead>
              <tr className="type-metadata">
                <th className="py-1 pr-2 font-medium">Leg</th>
                <th className="py-1 pr-2 font-medium">Price</th>
                <th className="py-1 pr-2 font-medium">Other side</th>
                <th className="py-1 pr-2 font-medium">No-vig chance</th>
                <th className="py-1 pr-2 font-medium">Market hold</th>
                <th className="py-1 font-medium">Leg cost</th>
              </tr>
            </thead>
            <tbody>
              {result.legs.map((leg) => {
                const cell = legFairCell(leg);
                const meta = labels.get(leg.id);
                return (
                  <tr key={leg.id} className="border-t border-[#DCE9EA] align-top" data-testid="true-cost-leg">
                    <td className="type-table-data py-1.5 pr-2 text-[#063f46]">
                      {meta?.label ?? leg.id}
                      {meta?.bookLabel ? <span className="type-metadata block">{meta.bookLabel}</span> : null}
                      {leg.heavyFavorite ? (
                        <span className="type-badge mt-0.5 inline-block rounded-full border border-amber-200 bg-[#fff8ee] px-2 py-0.5 text-[#9a3412]">
                          {HEAVY_FAVORITE_NOTE}
                        </span>
                      ) : null}
                    </td>
                    <td className="type-table-data py-1.5 pr-2">{odds(leg.priceAmerican)}</td>
                    <td className="type-table-data py-1.5 pr-2">{leg.oppositeAmerican != null ? odds(leg.oppositeAmerican) : 'Unknown'}</td>
                    <td className="type-table-data py-1.5 pr-2">{cell.noVig}</td>
                    <td className="type-table-data py-1.5 pr-2">{cell.hold}</td>
                    <td className="type-table-data py-1.5">{cell.legCost}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="type-metadata mt-1">
            Market hold is both sides’ implied chances minus 100%. Leg cost is 1 − no-vig chance × leg payout.
          </p>
        </div>
      ) : null}

      <BestBookSection bestBook={bestBook} pricesStatus={pricesStatus} />

      {linkedLegs ? (
        <p className="type-secondary mt-3 flex gap-2 rounded-xl border border-amber-200 bg-[#fff8ee] p-3" role="note">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#b45309]" aria-hidden />
          <span>{TRUE_COST_INDEPENDENCE_NOTE}</span>
        </p>
      ) : (
        <p className="type-metadata mt-3">Fair odds assume the legs are independent.</p>
      )}
    </section>
  );
}

function BestBookSection({
  bestBook,
  pricesStatus,
}: {
  bestBook: BestBookResult | null;
  pricesStatus: TrueCostPricesStatus;
}) {
  if (pricesStatus === 'not_applicable') return null;

  let body: ReactNode;
  if (pricesStatus === 'loading') {
    body = <p className="type-secondary">Loading current prices…</p>;
  } else if (pricesStatus === 'signed_out') {
    body = <p className="type-secondary">Sign in to load current prices from other books.</p>;
  } else if (pricesStatus === 'unavailable' || bestBook == null) {
    body = <p className="type-secondary">Current prices are unavailable for these legs.</p>;
  } else if (bestBook.status !== 'known') {
    body = (
      <p className="type-secondary">
        {bestBook.reason === 'NO_BOOK_PRICES_EVERY_LEG'
          ? 'No single book has a current price on every leg at these lines.'
          : 'Add legs to compare books.'}
      </p>
    );
  } else {
    const { best, current, books, houseEdgeDifference } = bestBook;
    const sameAsCurrent = current != null && current.vendor === best.vendor;
    body = (
      <>
        <p className="type-body text-[#063f46]">
          {sameAsCurrent
            ? `${best.displayName} has the best combined price of ${books.length} book${books.length === 1 ? '' : 's'} with every leg.`
            : `Best combined price: ${best.displayName} at ${odds(best.american)}.`}
          {!sameAsCurrent && houseEdgeDifference != null
            ? ` House edge ${formatPercent(Math.abs(houseEdgeDifference))} ${houseEdgeDifference >= 0 ? 'lower' : 'higher'} than your book.`
            : ''}
          {!sameAsCurrent && best.extraPayoutPer100 != null && best.extraPayoutPer100 > 0
            ? ` ${formatDollars(best.extraPayoutPer100)} more net profit on $100.`
            : ''}
        </p>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr className="type-metadata">
              <th className="py-1 pr-2 font-medium">Book</th>
              <th className="py-1 pr-2 font-medium">Parlay odds</th>
              <th className="py-1 pr-2 font-medium">Net profit on $100</th>
              <th className="py-1 font-medium">House edge</th>
            </tr>
          </thead>
          <tbody>
            {books.map((b) => (
              <tr key={b.vendor} className="border-t border-[#DCE9EA]" data-testid="true-cost-book">
                <td className="type-table-data py-1.5 pr-2 text-[#063f46]">
                  {b.displayName}
                  {current?.vendor === b.vendor ? <span className="type-metadata"> · your book</span> : null}
                </td>
                <td className="type-table-data py-1.5 pr-2">{odds(b.american)}</td>
                <td className="type-table-data py-1.5 pr-2">{formatDollars(profitPer100(b.decimal))}</td>
                <td className="type-table-data py-1.5">{b.houseEdge != null ? formatPercent(b.houseEdge) : 'Unknown'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-[#DCE9EA] p-3">
      <h3 className="type-metadata mb-1 uppercase tracking-wide">Same parlay at one book</h3>
      {body}
        <p className="type-metadata mt-1">
        A parlay is placed at one book, so this compares whole parlays per book using current prices.
        Net profit is winnings only. Total return is that profit plus the $100 stake.
      </p>
    </div>
  );
}
