'use client';

import { useId, useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { subdivisionName, type BettingCountry } from '@/lib/onboarding/regions';
import {
  booksWithOdds,
  groupBooksForRegion,
  type SportsbookEntry,
} from '@/lib/onboarding/sportsbooks';

function commonHeading(country: BettingCountry | null, region: string | null): string {
  if (country === 'CA') return `Common in ${subdivisionName(country, region) ?? 'Canada'}`;
  if (country === 'US') return 'Common in the US';
  return 'Sportsbooks';
}

export function BookPicker({
  country,
  region,
  selected,
  onChange,
}: {
  country: BettingCountry | null;
  region: string | null;
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const groups = useMemo(() => groupBooksForRegion(country, region), [country, region]);

  const q = query.trim().toLowerCase();
  const matches = (b: SportsbookEntry) => !q || b.label.toLowerCase().includes(q);

  const sections = [
    { key: 'common', title: commonHeading(country, region), books: groups.common.filter(matches) },
    {
      key: 'other',
      title: groups.common.length > 0 ? 'Other sportsbooks' : 'Sportsbooks',
      books: groups.other.filter(matches),
    },
    { key: 'prediction', title: 'Prediction markets', books: groups.predictionMarkets.filter(matches) },
  ].filter((s) => s.books.length > 0);

  const toggle = (id: string) => {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  };

  const withOdds = booksWithOdds(selected);
  const missing = selected.length - withOdds.length;

  return (
    <div className="space-y-4">
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          Search sportsbooks
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#4a6366]" aria-hidden />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search books"
          className="w-full min-h-[44px] rounded-xl border border-[#DCE9EA] bg-white pl-9 pr-3 text-sm text-[#063f46] focus:outline-none focus:ring-2 focus:ring-[#55ddb1]"
        />
      </div>

      {sections.length === 0 ? (
        <p className="text-sm text-[#4a6366]">No book matches “{query}”.</p>
      ) : null}

      {sections.map((section) => (
        <fieldset key={section.key}>
          <legend className="text-xs font-semibold uppercase tracking-wide text-[#4a6366] mb-2">
            {section.title}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {section.books.map((book) => {
              const on = selectedSet.has(book.id);
              return (
                <button
                  key={book.id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggle(book.id)}
                  className={cn(
                    'flex min-h-[44px] items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors',
                    on
                      ? 'border-[#075B5C] bg-[#55ddb1]/20'
                      : 'border-[#DCE9EA] bg-white hover:bg-[#f7f9f7]'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                      on ? 'border-[#075B5C] bg-[#075B5C] text-white' : 'border-[#b9cfd1] bg-white'
                    )}
                    aria-hidden
                  >
                    {on ? <Check className="h-3.5 w-3.5" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium text-[#063f46]">{book.label}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      {missing > 0 ? (
        <p className="rounded-xl bg-[#f7f9f7] border border-[#DCE9EA] px-3 py-2.5 text-xs text-[#4a6366]" aria-live="polite">
          Props Explorer doesn&apos;t show Kalshi or Polymarket prices yet.
          {withOdds.length > 0 ? ` We'll compare prices across your other ${withOdds.length === 1 ? 'book' : `${withOdds.length} books`}.` : null}
        </p>
      ) : null}
    </div>
  );
}
