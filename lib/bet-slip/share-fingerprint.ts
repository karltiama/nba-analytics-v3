/**
 * Fingerprint for share-URL reuse within a client session.
 *
 * Distinct from selectionKey:
 * - selectionKey = sportsbook-independent selection identity
 * - shareFingerprint = immutable shared *payload* identity (includes frozen book + odds)
 *
 * Changing selected sportsbook or odds creates a new share snapshot even when
 * selectionKey is unchanged — so Copy/Share never reuses a stale historical price.
 *
 * Leg order does not matter: tokens are sorted.
 */

import type { CanonicalBetLeg } from './types';

function oddsToken(odds: number | null | undefined): string {
  if (odds == null || !Number.isFinite(odds)) return '';
  return String(odds);
}

function bookToken(book: string | null | undefined): string {
  return (book ?? '').trim().toLowerCase();
}

/** One leg's contribution to the share payload fingerprint. */
export function shareLegFingerprintToken(leg: CanonicalBetLeg): string {
  return [
    leg.selectionKey,
    bookToken(leg.selectedSportsbook),
    oddsToken(leg.selectedOdds),
  ].join('~');
}

export function shareSlipFingerprint(legs: ReadonlyArray<CanonicalBetLeg>): string {
  return legs
    .map(shareLegFingerprintToken)
    .slice()
    .sort()
    .join('::');
}
