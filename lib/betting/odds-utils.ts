/**
 * Odds conversion helpers for American <-> decimal and implied probability.
 * Used by API and transform logic; mirrors analytics.american_to_decimal / american_to_implied_prob in SQL.
 */

/**
 * American odds -> decimal odds.
 * Positive: decimal = 1 + (odds / 100). Negative: decimal = 1 + (100 / |odds|).
 */
export function americanToDecimal(oddsAmerican: number): number | null {
  if (oddsAmerican > 0) return 1 + oddsAmerican / 100;
  if (oddsAmerican < 0) return 1 + 100 / Math.abs(oddsAmerican);
  return null;
}

/**
 * American odds -> implied probability.
 * Negative: implied = |odds| / (|odds| + 100). Positive: implied = 100 / (odds + 100).
 */
export function americanToImpliedProb(oddsAmerican: number): number | null {
  if (oddsAmerican <= 0) return Math.abs(oddsAmerican) / (Math.abs(oddsAmerican) + 100);
  if (oddsAmerican > 0) return 100 / (oddsAmerican + 100);
  return null;
}
