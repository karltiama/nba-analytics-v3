/**
 * Shortlist ranking. Closeness to the band midpoint is a diversity heuristic.
 * It is not a win probability, an edge, or a fair price.
 */

import { americanToDecimal } from '@/lib/betting/odds-utils';
import { QUICK_BUILD_SHORTLIST_CAP, QuickBuildInputError, type AmericanOddsRange } from './types';
import type { SideQuote } from './markets';

export type RankedPair = {
  id: string;
  legs: [SideQuote, SideQuote];
  combinedAmerican: number;
  breakEvenProbability: number;
  distanceToMidpoint: number;
  nearKey: string;
  playerPair: string;
  gamePair: string;
  tieKey: string;
};

/**
 * Midpoint of the band in decimal odds.
 * American odds are not a linear payout scale. Averaging −110 and +125
 * produces +7.5, which is not a price, and it stretches distance across
 * the gap between −100 and +100.
 */
export function bandMidpointDecimal(range: AmericanOddsRange): number {
  const low = americanToDecimal(range.minAmerican);
  const high = americanToDecimal(range.maxAmerican);
  if (low == null || high == null || low <= 1 || high <= 1) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'range bounds are not American odds');
  }
  return (low + high) / 2;
}

/** Absolute decimal-odds distance from the displayed combined price to the band midpoint. */
export function decimalDistanceToMidpoint(american: number, midpointDecimal: number): number {
  const decimal = americanToDecimal(american);
  if (decimal == null || decimal <= 1 || !Number.isFinite(midpointDecimal)) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'combined odds have no decimal distance');
  }
  return Math.abs(decimal - midpointDecimal);
}

export function sideIdentity(leg: SideQuote): string {
  return [leg.playerId, leg.gameId, leg.market, leg.side, String(leg.line), leg.sportsbook, leg.pullRunId].join('|');
}

export function pairIdentity(a: SideQuote, b: SideQuote): string {
  return [sideIdentity(a), sideIdentity(b)].sort().join('||');
}

function comparePairs(a: RankedPair, b: RankedPair): number {
  if (a.distanceToMidpoint !== b.distanceToMidpoint) return a.distanceToMidpoint - b.distanceToMidpoint;
  if (a.combinedAmerican !== b.combinedAmerican) return a.combinedAmerican - b.combinedAmerican;
  if (a.tieKey !== b.tieKey) return a.tieKey < b.tieKey ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** One representative per player/market/side pair. Alternate lines stay until this step. */
export function collapseNearDuplicates(pairs: RankedPair[]): RankedPair[] {
  const groups = new Map<string, RankedPair>();
  const sorted = pairs.slice().sort(comparePairs);
  for (const pair of sorted) {
    if (!groups.has(pair.nearKey)) groups.set(pair.nearKey, pair);
  }
  return [...groups.values()].sort(comparePairs);
}

/**
 * Up to five builds. First prefer a new player pair and a new game pair,
 * then a new player pair, then a new game pair, then rank order.
 */
export function selectShortlist(pairs: RankedPair[], cap = QUICK_BUILD_SHORTLIST_CAP): RankedPair[] {
  const sorted = pairs.slice().sort(comparePairs);
  const selected: RankedPair[] = [];
  const used = new Set<string>();
  const players = new Set<string>();
  const games = new Set<string>();

  const take = (allow: (pair: RankedPair) => boolean) => {
    for (const pair of sorted) {
      if (selected.length >= cap) return;
      if (used.has(pair.id) || !allow(pair)) continue;
      selected.push(pair);
      used.add(pair.id);
      players.add(pair.playerPair);
      games.add(pair.gamePair);
    }
  };

  take((pair) => !players.has(pair.playerPair) && !games.has(pair.gamePair));
  take((pair) => !players.has(pair.playerPair));
  take((pair) => !games.has(pair.gamePair));
  take(() => true);
  return selected;
}
