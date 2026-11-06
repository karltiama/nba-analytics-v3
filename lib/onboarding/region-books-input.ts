import { z } from 'zod';
import { BETTING_COUNTRIES, isValidSubdivision, type BettingCountry } from './regions';
import { normalizeBookIds } from './sportsbooks';

/** Request fields shared by PUT /api/user/settings and POST /api/user/onboarding. */
export const regionBooksFields = {
  bettingCountry: z.enum(BETTING_COUNTRIES).nullable().optional(),
  bettingRegion: z.string().regex(/^[A-Z]{2}$/).nullable().optional(),
  sportsbooks: z.array(z.string().max(40)).max(64).optional(),
};

export type RegionBooksInput = {
  bettingCountry?: BettingCountry | null;
  bettingRegion?: string | null;
  sportsbooks?: string[];
};

export type RegionBooksValues = {
  /** null = leave the stored country (and region) unchanged. */
  bettingCountry: BettingCountry | null;
  bettingRegion: string | null;
  /** null = leave stored books unchanged; [] = the user picked none. */
  sportsbooks: string[] | null;
};

export type RegionBooksResult = { ok: true; values: RegionBooksValues } | { ok: false; error: string };

/**
 * Region is stored only together with its country, so changing country clears a stale region.
 * Unknown book ids are dropped rather than rejected (the catalog can shrink between deploys).
 */
export function resolveRegionBooks(input: RegionBooksInput): RegionBooksResult {
  const country = input.bettingCountry ?? null;
  const region = input.bettingRegion ?? null;
  if (region && !country) {
    return { ok: false, error: 'bettingRegion requires bettingCountry' };
  }
  if (region && !isValidSubdivision(country, region)) {
    return { ok: false, error: 'bettingRegion is not in bettingCountry' };
  }
  return {
    ok: true,
    values: {
      bettingCountry: country,
      bettingRegion: country === 'OTHER' ? null : region,
      sportsbooks: input.sportsbooks === undefined ? null : normalizeBookIds(input.sportsbooks),
    },
  };
}

/** SET clauses for an upsert whose EXCLUDED row carries betting_country/betting_region/sportsbooks. */
export const REGION_BOOKS_UPSERT_SET = `
         betting_country = COALESCE(EXCLUDED.betting_country, public.user_settings.betting_country),
         betting_region = CASE WHEN EXCLUDED.betting_country IS NOT NULL
                               THEN EXCLUDED.betting_region
                               ELSE public.user_settings.betting_region END,
         sportsbooks = COALESCE(EXCLUDED.sportsbooks, public.user_settings.sportsbooks)`;
