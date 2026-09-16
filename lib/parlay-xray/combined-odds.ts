import { americanToDecimal } from '@/lib/betting/odds-utils';
import { formatAmericanOdds } from '@/lib/betting/market-movement-format';
import type { ExtractedParlayLeg } from './types';

export function decimalToAmerican(decimal: number): number | null {
  if (!Number.isFinite(decimal) || decimal <= 1) return null;
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

/**
 * Combined American odds from per-leg American prices.
 * Returns null when any leg is missing a finite, non-zero price.
 * Does not invent a total from a subset of legs.
 */
export function combinedAmericanOdds(odds: Array<number | null | undefined>): number | null {
  if (odds.length === 0) return null;
  let product = 1;
  for (const american of odds) {
    if (american == null || !Number.isFinite(american) || american === 0) return null;
    const dec = americanToDecimal(american);
    if (dec == null || dec <= 1) return null;
    product *= dec;
  }
  return decimalToAmerican(product);
}

export function knownLegOdds(legs: ExtractedParlayLeg[]): Array<number | null> {
  return legs.map((leg) =>
    leg.oddsAmerican.status === 'known' && leg.oddsAmerican.value != null ? leg.oddsAmerican.value : null
  );
}

export function formatCombinedOddsLabel(odds: number | null): string | null {
  if (odds == null) return null;
  return formatAmericanOdds(odds);
}
