/**
 * Bounded three-leg search. Two-leg pair generation is not used here.
 * A stopped search is not reported as proof that the payout band is empty.
 */

import { americanToDecimal } from '@/lib/betting/odds-utils';
import { combinedAmericanOdds } from '@/lib/parlay-xray/combined-odds';
import { combinedDecimal } from '@/lib/parlay/true-cost';
import type { SideQuote, TwoSidedMarket } from './markets';
import {
  bandMidpointDecimal,
  collapseTripleNearDuplicates,
  decimalDistanceToMidpoint,
  exactLegKey,
  selectTripleShortlist,
  sideIdentity,
  type RankedTriple,
} from './rank';
import {
  QUICK_BUILD_SHORTLIST_CAP,
  QUICK_BUILD_TRIPLE_PROBE_BUDGET,
  QUICK_BUILD_TRIPLE_RETAIN,
  QUICK_BUILD_TRIPLE_SEED_PLAYERS,
  type AmericanOddsRange,
} from './types';

type PricedSide = {
  side: SideQuote;
  decimal: number;
};

export type ThreeLegSearch = {
  triples: RankedTriple[];
  /**
   * False when the player seed or the probe budget stopped the search before
   * every legal triple was checked. That is not evidence the payout band is empty.
   */
  complete: boolean;
  probes: number;
};

export function searchThreeLegCandidates(
  markets: TwoSidedMarket[],
  range: AmericanOddsRange,
  budget = QUICK_BUILD_TRIPLE_PROBE_BUDGET,
): ThreeLegSearch {
  const decimalWindow = americanBandDecimalWindow(range.minAmerican, range.maxAmerican);
  if (decimalWindow == null) return { triples: [], complete: true, probes: 0 };
  const midpoint = bandMidpointDecimal(range);
  const anchor = Math.cbrt(midpoint);
  const byGame = new Map<string, { visit: PricedSide[]; byDecimal: PricedSide[] }>();

  for (const market of markets) {
    for (const side of [market.over, market.under]) {
      const decimal = americanToDecimal(side.oddsAmerican);
      if (decimal == null || decimal <= 1) continue;
      const group = byGame.get(side.gameId) ?? { visit: [], byDecimal: [] };
      group.visit.push({ side, decimal });
      group.byDecimal.push({ side, decimal });
      byGame.set(side.gameId, group);
    }
  }

  const gameIds = [...byGame.keys()].sort();
  for (const gameId of gameIds) {
    const group = byGame.get(gameId)!;
    group.visit.sort((a, b) => (
      Math.abs(a.decimal - anchor) - Math.abs(b.decimal - anchor)
      || sideIdentity(a.side).localeCompare(sideIdentity(b.side))
    ));
    group.byDecimal.sort((a, b) => a.decimal - b.decimal || sideIdentity(a.side).localeCompare(sideIdentity(b.side)));
  }

  const retained: RankedTriple[] = [];
  const seen = new Set<string>();
  let probes = 0;
  let complete = true;

  const consider = (legs: [SideQuote, SideQuote, SideQuote], decimal: number, american: number) => {
    const ordered = legs.slice().sort((a, b) => sideIdentity(a).localeCompare(sideIdentity(b))) as [
      SideQuote,
      SideQuote,
      SideQuote,
    ];
    const id = ordered.map((leg) => sideIdentity(leg)).join('||');
    if (seen.has(id)) return;
    seen.add(id);
    const hit = toRanked(ordered, american, 1 / decimal, midpoint);
    if (retained.length < QUICK_BUILD_TRIPLE_RETAIN) {
      retained.push(hit);
      siftUp(retained, retained.length - 1);
      return;
    }
    const root = retained[0]!;
    if (hit.distanceToMidpoint > root.distanceToMidpoint) return;
    if (hit.distanceToMidpoint === root.distanceToMidpoint && hit.id >= root.id) return;
    retained[0] = hit;
    siftDown(retained, 0);
  };

  const seeds = new Map<string, PricedSide[]>();
  let truncated = false;
  for (const gameId of gameIds) {
    const visit = byGame.get(gameId)!.visit;
    const seeded = seedClosestPlayers(visit, QUICK_BUILD_TRIPLE_SEED_PLAYERS);
    const players = new Set(visit.map((side) => side.side.playerId));
    if (seeded.length < players.size || seeded.length < visit.length) truncated = true;
    seeds.set(gameId, seeded);
  }

  let remainingTriples = 0;
  for (let i = 0; i < gameIds.length; i += 1) {
    for (let j = i + 1; j < gameIds.length; j += 1) {
      for (let k = j + 1; k < gameIds.length; k += 1) remainingTriples += 1;
    }
  }

  for (let i = 0; i < gameIds.length; i += 1) {
    for (let j = i + 1; j < gameIds.length; j += 1) {
      for (let k = j + 1; k < gameIds.length; k += 1) {
        const allowance = Math.ceil((budget - probes) / remainingTriples);
        const limit = probes + allowance;
        let finished = true;
        const first = seeds.get(gameIds[i]!)!;
        const second = seeds.get(gameIds[j]!)!;
        const third = byGame.get(gameIds[k]!)!.byDecimal;
        scan: for (const a of first) {
          for (const b of second) {
            if (a.side.playerId === b.side.playerId) continue;
            const product = a.decimal * b.decimal;
            // Cover every decimal product that can round into the American band.
            // The exact combinedAmericanOdds check remains the inclusive boundary.
            const start = lowerBound(third, decimalWindow.lo / product);
            const end = upperBound(third, decimalWindow.hi / product);
            for (let index = start; index < end; index += 1) {
              if (probes >= limit || probes >= budget) {
                finished = false;
                break scan;
              }
              probes += 1;
              const c = third[index]!;
              if (c.side.playerId === a.side.playerId || c.side.playerId === b.side.playerId) continue;
              const decimal = combinedDecimal([a.side.oddsAmerican, b.side.oddsAmerican, c.side.oddsAmerican]);
              const american = combinedAmericanOdds([a.side.oddsAmerican, b.side.oddsAmerican, c.side.oddsAmerican]);
              if (decimal == null || american == null || american < range.minAmerican || american > range.maxAmerican) continue;
              consider([a.side, b.side, c.side], decimal, american);
            }
          }
        }
        if (!finished || truncated) complete = false;
        remainingTriples -= 1;
      }
    }
  }

  const shortlist = selectTripleShortlist(
    collapseTripleNearDuplicates(retained),
    QUICK_BUILD_SHORTLIST_CAP,
    range,
  );
  return { triples: shortlist, complete, probes };
}

function toRanked(
  legs: [SideQuote, SideQuote, SideQuote],
  combinedAmerican: number,
  breakEvenProbability: number,
  midpoint: number,
): RankedTriple {
  const nearKey = legs.map((leg) => `${leg.playerId}|${leg.market}|${leg.side}`).sort().join('||');
  const games = legs.map((leg) => leg.gameId).sort();
  const lines = legs.map((leg) => leg.line).sort((a, b) => a - b);
  return {
    id: legs.map((leg) => exactLegKey(leg)).sort().join('||'),
    legs,
    combinedAmerican,
    breakEvenProbability,
    distanceToMidpoint: decimalDistanceToMidpoint(combinedAmerican, midpoint),
    nearKey,
    gameSet: games.join('|'),
    tieKey: [lines.join(','), ...legs.map((leg) => sideIdentity(leg))].join('||'),
  };
}

/**
 * Decimal products that round to an American price inside the inclusive band.
 * Positive and negative prices use the same rounding as decimalToAmerican.
 */
function americanBandDecimalWindow(minAmerican: number, maxAmerican: number): { lo: number; hi: number } | null {
  const low = americanRoundingInterval(minAmerican);
  const high = americanRoundingInterval(maxAmerican);
  if (low == null || high == null || !(low.lo < high.hi)) return null;
  return { lo: low.lo, hi: high.hi };
}

function americanRoundingInterval(american: number): { lo: number; hi: number } | null {
  if (!Number.isInteger(american)) return null;
  if (american >= 100) {
    return { lo: 1 + (american - 0.5) / 100, hi: 1 + (american + 0.5) / 100 };
  }
  if (american <= -101) {
    return { lo: 1 - 100 / (american - 0.5), hi: 1 - 100 / (american + 0.5) };
  }
  return null;
}

/**
 * Visit order is closest decimal to the band's geometric mean, then side identity.
 * One side per player keeps the bound from being filled by one player's markets.
 */
function seedClosestPlayers(sides: readonly PricedSide[], limit: number): PricedSide[] {
  const picked: PricedSide[] = [];
  const seen = new Set<string>();
  for (const side of sides) {
    if (seen.has(side.side.playerId)) continue;
    seen.add(side.side.playerId);
    picked.push(side);
    if (picked.length >= limit) break;
  }
  return picked;
}

function lowerBound(sides: readonly PricedSide[], decimal: number): number {
  let lo = 0;
  let hi = sides.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sides[mid]!.decimal < decimal) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(sides: readonly PricedSide[], decimal: number): number {
  let lo = 0;
  let hi = sides.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sides[mid]!.decimal <= decimal) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function worse(a: RankedTriple, b: RankedTriple): boolean {
  if (a.distanceToMidpoint !== b.distanceToMidpoint) return a.distanceToMidpoint > b.distanceToMidpoint;
  return a.id > b.id;
}

function siftUp(heap: RankedTriple[], index: number) {
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (!worse(heap[index]!, heap[parent]!)) break;
    [heap[parent], heap[index]] = [heap[index]!, heap[parent]!];
    index = parent;
  }
}

function siftDown(heap: RankedTriple[], index: number) {
  for (;;) {
    const left = index * 2 + 1;
    const right = left + 1;
    let largest = index;
    if (left < heap.length && worse(heap[left]!, heap[largest]!)) largest = left;
    if (right < heap.length && worse(heap[right]!, heap[largest]!)) largest = right;
    if (largest === index) break;
    [heap[largest], heap[index]] = [heap[index]!, heap[largest]!];
    index = largest;
  }
}
