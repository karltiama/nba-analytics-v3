'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';
import {
  BETTING_COUNTRIES,
  COUNTRY_LABELS,
  subdivisionLabel,
  subdivisionsFor,
  type BettingCountry,
} from '@/lib/onboarding/regions';

export type RegionValue = { country: BettingCountry | null; region: string | null };

export function RegionFields({
  value,
  onChange,
}: {
  value: RegionValue;
  onChange: (next: RegionValue) => void;
}) {
  const selectId = useId();
  const subdivisions = subdivisionsFor(value.country);

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Country">
        {BETTING_COUNTRIES.map((country) => {
          const selected = value.country === country;
          return (
            <button
              key={country}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange({ country, region: selected ? value.region : null })}
              className={cn(
                'min-h-[44px] rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors',
                selected
                  ? 'border-[#075B5C] bg-[#55ddb1]/20 text-[#063f46]'
                  : 'border-[#DCE9EA] bg-white text-[#063f46] hover:bg-[#f7f9f7]'
              )}
            >
              {COUNTRY_LABELS[country]}
            </button>
          );
        })}
      </div>

      {subdivisions.length > 0 ? (
        <div>
          <label htmlFor={selectId} className="block text-sm font-medium text-[#063f46] mb-1.5">
            {subdivisionLabel(value.country)}
          </label>
          <select
            id={selectId}
            value={value.region ?? ''}
            onChange={(e) => onChange({ country: value.country, region: e.target.value || null })}
            className="w-full min-h-[44px] rounded-xl border border-[#DCE9EA] bg-white px-3 text-sm text-[#063f46] focus:outline-none focus:ring-2 focus:ring-[#55ddb1]"
          >
            <option value="">Choose one</option>
            {subdivisions.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}
