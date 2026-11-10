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

/**
 * How far, in decimal odds, a candidate may sit beyond the best pair and still
 * be promoted for variety.
 *
 * The allowance is one eighth of the preset's decimal-odds width, which is one
 * quarter of the distance from the midpoint to either edge. Balanced is about
 * 0.043 decimal (near +108 to +112). A pair farther away stays in price order
 * and is not pulled forward just to change the player or the market.
 */
export function diversityQualitySlack(range: AmericanOddsRange): number {
  const low = americanToDecimal(range.minAmerican);
  const high = americanToDecimal(range.maxAmerican);
  if (low == null || high == null || !(high > low)) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'range bounds are not American odds');
  }
  return (high - low) / 8;
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

/** Canonical offered leg. Display names are not part of the identity. */
export function exactLegKey(leg: SideQuote): string {
  return [leg.playerId, leg.gameId, leg.market, leg.side, String(leg.line)].join('|');
}

/**
 * Up to five builds from the existing price ranking.
 *
 * Pairs within diversityQualitySlack of the best distance are the competitive
 * window. Inside that window, rank order still breaks ties, and each pass gives
 * way only when a later pass can still fill the card:
 * a new exact leg, a new player, a new market, then a new game pair.
 * Pairs outside the window are not promoted. They fill a remaining slot only
 * in the original price order, so a much worse payout match cannot jump a
 * closer one for variety.
 */
export function selectShortlist(
  pairs: RankedPair[],
  cap = QUICK_BUILD_SHORTLIST_CAP,
  range?: AmericanOddsRange,
): RankedPair[] {
  const sorted = pairs.slice().sort(comparePairs);
  if (sorted.length === 0 || cap <= 0) return [];
  const best = sorted[0]!.distanceToMidpoint;
  const limit = range == null ? Number.POSITIVE_INFINITY : best + diversityQualitySlack(range);
  const competitive: RankedPair[] = [];
  const remainder: RankedPair[] = [];
  for (const pair of sorted) {
    if (pair.distanceToMidpoint <= limit + 1e-9) competitive.push(pair);
    else remainder.push(pair);
  }

  const selected: RankedPair[] = [];
  const used = new Set<string>();
  const exactLegs = new Set<string>();
  const players = new Set<string>();
  const markets = new Set<string>();
  const gamePairs = new Set<string>();

  const freshExact = (pair: RankedPair) =>
    !exactLegs.has(exactLegKey(pair.legs[0])) && !exactLegs.has(exactLegKey(pair.legs[1]));
  const freshPlayers = (pair: RankedPair) =>
    !players.has(pair.legs[0].playerId) && !players.has(pair.legs[1].playerId);
  const addsMarket = (pair: RankedPair) =>
    !markets.has(pair.legs[0].market) || !markets.has(pair.legs[1].market);
  const freshGames = (pair: RankedPair) => !gamePairs.has(pair.gamePair);

  const take = (pool: readonly RankedPair[], allow: (pair: RankedPair) => boolean) => {
    for (const pair of pool) {
      if (selected.length >= cap) return;
      if (used.has(pair.id) || !allow(pair)) continue;
      selected.push(pair);
      used.add(pair.id);
      exactLegs.add(exactLegKey(pair.legs[0]));
      exactLegs.add(exactLegKey(pair.legs[1]));
      players.add(pair.legs[0].playerId);
      players.add(pair.legs[1].playerId);
      markets.add(pair.legs[0].market);
      markets.add(pair.legs[1].market);
      gamePairs.add(pair.gamePair);
    }
  };

  take(competitive, (pair) => freshExact(pair) && freshPlayers(pair) && addsMarket(pair) && freshGames(pair));
  take(competitive, (pair) => freshExact(pair) && freshPlayers(pair) && addsMarket(pair));
  take(competitive, (pair) => freshExact(pair) && freshPlayers(pair) && freshGames(pair));
  take(competitive, (pair) => freshExact(pair) && freshPlayers(pair));
  take(competitive, (pair) => freshExact(pair) && addsMarket(pair));
  take(competitive, (pair) => freshExact(pair));
  take(competitive, () => true);
  take(remainder, () => true);
  return selected;
}
