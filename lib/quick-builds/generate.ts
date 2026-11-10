/**
 * Two-leg cross-game pairs at one book, then an inclusive American band.
 * Alternate lines stay in the pool until ranking.
 */

import { combinedAmericanOdds } from '@/lib/parlay-xray/combined-odds';
import { combinedDecimal } from '@/lib/parlay/true-cost';
import type { AmericanOddsRange } from './types';
import { bandMidpointDecimal, decimalDistanceToMidpoint, type RankedPair, pairIdentity, sideIdentity } from './rank';
import type { SideQuote, TwoSidedMarket } from './markets';

function inRange(american: number, range: AmericanOddsRange): boolean {
  return american >= range.minAmerican && american <= range.maxAmerican;
}

export function generateBandPairs(markets: TwoSidedMarket[], range: AmericanOddsRange): RankedPair[] {
  const midpoint = bandMidpointDecimal(range);
  const seen = new Set<string>();
  const pairs: RankedPair[] = [];

  for (let i = 0; i < markets.length; i += 1) {
    for (let j = i + 1; j < markets.length; j += 1) {
      const left = markets[i]!;
      const right = markets[j]!;
      if (left.over.gameId === right.over.gameId) continue;
      if (left.over.playerId === right.over.playerId) continue;
      const sides: Array<['over' | 'under', 'over' | 'under']> = [
        ['over', 'over'],
        ['over', 'under'],
        ['under', 'over'],
        ['under', 'under'],
      ];
      for (const [leftSide, rightSide] of sides) {
        const a = left[leftSide];
        const b = right[rightSide];
        const decimal = combinedDecimal([a.oddsAmerican, b.oddsAmerican]);
        const american = combinedAmericanOdds([a.oddsAmerican, b.oddsAmerican]);
        if (decimal == null || american == null || !inRange(american, range)) continue;
        const ordered = [a, b].slice().sort(compareSides) as [SideQuote, SideQuote];
        const id = pairIdentity(ordered[0], ordered[1]);
        if (seen.has(id)) continue;
        seen.add(id);
        pairs.push(toRanked(ordered, american, 1 / decimal, midpoint));
      }
    }
  }

  return pairs;
}

function compareSides(a: SideQuote, b: SideQuote): number {
  return sideIdentity(a).localeCompare(sideIdentity(b));
}

function toRanked(
  legs: [SideQuote, SideQuote],
  combinedAmerican: number,
  breakEvenProbability: number,
  midpoint: number
): RankedPair {
  const [a, b] = legs;
  const nearParts = [a, b].map((leg) => `${leg.playerId}|${leg.market}|${leg.side}`).sort();
  const players = [a.playerId, b.playerId].slice().sort();
  const games = [a.gameId, b.gameId].slice().sort();
  const lines = [a.line, b.line].slice().sort((x, y) => x - y);
  return {
    id: pairIdentity(a, b),
    legs,
    combinedAmerican,
    breakEvenProbability,
    distanceToMidpoint: decimalDistanceToMidpoint(combinedAmerican, midpoint),
    nearKey: nearParts.join('||'),
    playerPair: players.join('|'),
    gamePair: games.join('|'),
    tieKey: [lines.join(','), sideIdentity(a), sideIdentity(b)].join('||'),
  };
}
