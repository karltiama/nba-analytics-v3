/**
 * Free-tier vs paid bookmaker access notes (The Odds API documentation).
 * Source: https://the-odds-api.com/sports-odds-data/bookmaker-apis.html
 * ("Only available on paid subscriptions" for williamhill_us / fanatics).
 */

import type { SportsbookHandoffProvider } from '@/lib/sportsbook-handoff/types';
import type { AccessLimitation } from './types';

/**
 * Documented paid-only US bookmakers for The Odds API (the-odds-api.com).
 * Distinct from any similarly named third-party odds sites.
 */
export const ODDS_API_DOCUMENTED_PAID_BOOKS: ReadonlySet<SportsbookHandoffProvider> = new Set([
  'caesars',
  'fanatics',
]);

export function documentedAccessLimitation(
  sportsbook: SportsbookHandoffProvider
): AccessLimitation {
  if (ODDS_API_DOCUMENTED_PAID_BOOKS.has(sportsbook)) return 'PAID_ACCESS_REQUIRED';
  return 'UNCONFIRMED';
}

/**
 * Combine documentation with live observation.
 * Seeing the book on a free key upgrades UNCONFIRMED → FREE_KEY_OBSERVED.
 * Paid-documented books stay PAID_ACCESS_REQUIRED even if somehow present
 * (would be anomalous / plan change — note via observedBook).
 */
export function resolveAccessLimitation(input: {
  sportsbook: SportsbookHandoffProvider;
  bookObservedOnThisKey: boolean;
}): AccessLimitation {
  const documented = documentedAccessLimitation(input.sportsbook);
  if (documented === 'PAID_ACCESS_REQUIRED') {
    return 'PAID_ACCESS_REQUIRED';
  }
  if (input.bookObservedOnThisKey) return 'FREE_KEY_OBSERVED';
  return 'UNCONFIRMED';
}
