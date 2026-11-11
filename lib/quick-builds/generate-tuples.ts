/**
 * Bounded four- and five-leg search. Two- and three-leg generators are not used here.
 * A stopped search is not reported as proof that the payout band is empty.
 *
 * Seed metric: for the earlier legs, keep the one side per player closest to
 * midpoint^(1/legCount), then side identity. Four-leg builds seed at most eight
 * players per game. Five-leg builds seed at most six. The last game in each
 * sorted tuple stays the full price window, so a qualifying price on that game
 * is not dropped with the seed.
 *
 * Game tuples are lexicographic on sorted game ids. A slate with more tuples
 * than QUICK_BUILD_TUPLE_VISIT_CAP is visited at evenly spaced combination
 * indexes, so early game ids cannot consume the whole traversal. Each visited
 * tuple gets ceil(remaining probes / remaining tuples). Exact combined-price
 * checks stop at QUICK_BUILD_TUPLE_PROBE_BUDGET. At most QUICK_BUILD_TUPLE_RETAIN
 * candidates are kept, the ones closest to the band midpoint.
 */

import { americanToDecimal } from '@/lib/betting/odds-utils';
import { combinedAmericanOdds } from '@/lib/parlay-xray/combined-odds';
import { combinedDecimal } from '@/lib/parlay/true-cost';
import type { SideQuote, TwoSidedMarket } from './markets';
import {
  bandMidpointDecimal,
  collapseTupleNearDuplicates,
  decimalDistanceToMidpoint,
  exactLegKey,
  selectTupleShortlist,
  sideIdentity,
  type RankedTuple,
} from './rank';
import {
  QUICK_BUILD_FIVE_LEG_SEED_PLAYERS,
  QUICK_BUILD_FOUR_LEG_SEED_PLAYERS,
  QUICK_BUILD_SHORTLIST_CAP,
  QUICK_BUILD_TUPLE_PROBE_BUDGET,
  QUICK_BUILD_TUPLE_RETAIN,
  QUICK_BUILD_TUPLE_VISIT_CAP,
  type AmericanOddsRange,
} from './types';

type PricedSide = {
  side: SideQuote;
  decimal: number;
};

export type TupleSearch = {
  tuples: RankedTuple[];
  /**
   * False when player seeding, tuple subsampling, or the probe budget stopped
   * the search before every legal combination was checked.
   */
  complete: boolean;
  probes: number;
  tuplesVisited: number;
  tuplesAvailable: number;
  retained: number;
};

export function searchTupleCandidates(
  markets: TwoSidedMarket[],
  range: AmericanOddsRange,
  legCount: 4 | 5,
  budget = QUICK_BUILD_TUPLE_PROBE_BUDGET,
): TupleSearch {
  const decimalWindow = americanBandDecimalWindow(range.minAmerican, range.maxAmerican);
  if (decimalWindow == null) {
    return { tuples: [], complete: true, probes: 0, tuplesVisited: 0, tuplesAvailable: 0, retained: 0 };
  }
  const midpoint = bandMidpointDecimal(range);
  const anchor = midpoint ** (1 / legCount);
  const seedLimit = legCount === 4 ? QUICK_BUILD_FOUR_LEG_SEED_PLAYERS : QUICK_BUILD_FIVE_LEG_SEED_PLAYERS;
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

  const retained: RankedTuple[] = [];
  const seen = new Set<string>();
  const consider = (legs: SideQuote[], decimal: number, american: number) => {
    const distance = decimalDistanceToMidpoint(american, midpoint);
    if (retained.length >= QUICK_BUILD_TUPLE_RETAIN && distance > retained[0]!.distanceToMidpoint) return;
    const ordered = legs.slice().sort((a, b) => sideIdentity(a).localeCompare(sideIdentity(b)));
    const id = ordered.map((leg) => sideIdentity(leg)).join('||');
    if (seen.has(id)) return;
    seen.add(id);
    const hit = toRanked(ordered, american, 1 / decimal, midpoint);
    if (retained.length < QUICK_BUILD_TUPLE_RETAIN) {
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
    const seeded = seedClosestPlayers(visit, seedLimit);
    const players = new Set(visit.map((side) => side.side.playerId));
    if (seeded.length < players.size || seeded.length < visit.length) truncated = true;
    seeds.set(gameId, seeded);
  }

  const available = combinationCount(gameIds.length, legCount);
  const indexes = visitIndexes(available, QUICK_BUILD_TUPLE_VISIT_CAP);
  let probes = 0;
  let visited = 0;
  let complete = !truncated && indexes.length === available;
  let remaining = indexes.length;
  const chosen: PricedSide[] = [];
  const players = new Set<string>();
  const prices = Array.from({ length: legCount }, () => 0);
  const scratch: SideQuote[] = Array.from({ length: legCount });

  for (const index of indexes) {
    if (probes >= budget) {
      complete = false;
      break;
    }
    visited += 1;
    const positions = combinationAt(gameIds.length, legCount, index);
    const tupleGames = positions.map((position) => gameIds[position]!);
    const allowance = Math.max(1, Math.ceil((budget - probes) / remaining));
    const limit = Math.min(budget, probes + allowance);
    let finished = true;
    const last = byGame.get(tupleGames[legCount - 1]!)!.byDecimal;

    const walk = (depth: number, product: number) => {
      if (!finished) return;
      if (depth === legCount - 1) {
        const start = lowerBound(last, decimalWindow.lo / product);
        const end = upperBound(last, decimalWindow.hi / product);
        for (let cursor = start; cursor < end; cursor += 1) {
          const priced = last[cursor]!;
          if (players.has(priced.side.playerId)) continue;
          if (probes >= limit || probes >= budget) {
            finished = false;
            return;
          }
          probes += 1;
          for (let slot = 0; slot < legCount - 1; slot += 1) {
            const side = chosen[slot]!.side;
            scratch[slot] = side;
            prices[slot] = side.oddsAmerican;
          }
          scratch[legCount - 1] = priced.side;
          prices[legCount - 1] = priced.side.oddsAmerican;
          const decimal = combinedDecimal(prices);
          const american = combinedAmericanOdds(prices);
          if (decimal == null || american == null || american < range.minAmerican || american > range.maxAmerican) continue;
          consider(scratch, decimal, american);
        }
        return;
      }
      const group = seeds.get(tupleGames[depth]!)!;
      for (const priced of group) {
        if (players.has(priced.side.playerId)) continue;
        players.add(priced.side.playerId);
        chosen[depth] = priced;
        walk(depth + 1, product * priced.decimal);
        players.delete(priced.side.playerId);
        if (!finished) return;
      }
    };

    walk(0, 1);
    if (!finished) complete = false;
    remaining -= 1;
  }

  const shortlist = selectTupleShortlist(
    collapseTupleNearDuplicates(retained),
    QUICK_BUILD_SHORTLIST_CAP,
    range,
  );
  return {
    tuples: shortlist,
    complete,
    probes,
    tuplesVisited: visited,
    tuplesAvailable: available,
    retained: retained.length,
  };
}

function toRanked(
  legs: SideQuote[],
  combinedAmerican: number,
  breakEvenProbability: number,
  midpoint: number,
): RankedTuple {
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

/** Lexicographic combination count. Capped inputs stay inside exact integer range. */
export function combinationCount(gameCount: number, legCount: number): number {
  if (legCount < 0 || gameCount < legCount) return 0;
  return binomial(gameCount, legCount);
}

function visitIndexes(total: number, cap: number): number[] {
  if (total <= 0) return [];
  if (total <= cap) return Array.from({ length: total }, (_, index) => index);
  const indexes: number[] = [];
  for (let slot = 0; slot < cap; slot += 1) indexes.push(Math.floor((slot * total) / cap));
  return indexes;
}

function combinationAt(gameCount: number, legCount: number, index: number): number[] {
  const chosen: number[] = [];
  let remaining = index;
  let start = 0;
  for (let left = legCount; left > 0; left -= 1) {
    for (let cursor = start; cursor <= gameCount - left; cursor += 1) {
      const count = binomial(gameCount - cursor - 1, left - 1);
      if (remaining < count) {
        chosen.push(cursor);
        start = cursor + 1;
        break;
      }
      remaining -= count;
    }
  }
  return chosen;
}

function binomial(n: number, k: number): number {
  if (k < 0 || n < 0 || k > n) return 0;
  const width = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= width; index += 1) {
    result = (result * (n - width + index)) / index;
  }
  return result;
}

function worse(a: RankedTuple, b: RankedTuple): boolean {
  if (a.distanceToMidpoint !== b.distanceToMidpoint) return a.distanceToMidpoint > b.distanceToMidpoint;
  return a.id > b.id;
}

function siftUp(heap: RankedTuple[], index: number) {
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (!worse(heap[index]!, heap[parent]!)) break;
    [heap[parent], heap[index]] = [heap[index]!, heap[parent]!];
    index = parent;
  }
}

function siftDown(heap: RankedTuple[], index: number) {
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
