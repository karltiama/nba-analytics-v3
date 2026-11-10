/**
 * Display-oriented result. Does not rank and does not invent prices.
 */

import {
  QUICK_BUILD_PRICE_NOTICE,
  type AmericanOddsRange,
  type GameEligibility,
  type QuickBuild,
  type QuickBuildEmptyReason,
  type QuickBuildPolicy,
  type QuickBuildResult,
} from './types';
import type { PlayerPropV1Vendor } from '@/lib/betting/market-movement';
import type { RankedPair } from './rank';
import type { SideQuote } from './markets';

export function emptyQuickBuildResult(input: {
  sportsbook: PlayerPropV1Vendor | null;
  range: AmericanOddsRange | null;
  policy: QuickBuildPolicy | null;
  games: GameEligibility[];
  reason: QuickBuildEmptyReason;
}): QuickBuildResult {
  return {
    status: 'empty',
    emptyReason: input.reason,
    sportsbook: input.sportsbook,
    range: input.range,
    policy: input.policy,
    priceNotice: QUICK_BUILD_PRICE_NOTICE,
    games: input.games,
    builds: [],
  };
}

function toLeg(quote: SideQuote): QuickBuild['legs'][number] {
  return {
    playerId: quote.playerId,
    gameId: quote.gameId,
    market: quote.market,
    side: quote.side,
    line: quote.line,
    sportsbook: quote.sportsbook,
    oddsAmerican: quote.oddsAmerican,
    oppositeAmerican: quote.oppositeAmerican,
    noVigProbability: quote.noVigProbability,
    pullRunId: quote.pullRunId,
    observedAt: quote.observedAt,
    ageMs: quote.ageMs,
  };
}

export function presentBuilds(input: {
  sportsbook: PlayerPropV1Vendor;
  range: AmericanOddsRange;
  policy: QuickBuildPolicy;
  games: GameEligibility[];
  builds: RankedPair[];
}): QuickBuildResult {
  const builds: QuickBuild[] = input.builds.map((pair) => {
    const legs = pair.legs.map(toLeg) as QuickBuild['legs'];
    const times = legs.map((leg) => leg.observedAt).slice().sort();
    return {
      id: pair.id,
      legs,
      combinedAmerican: pair.combinedAmerican,
      breakEvenProbability: pair.breakEvenProbability,
      distanceToMidpoint: pair.distanceToMidpoint,
      oldestObservedAt: times[0]!,
      newestObservedAt: times[times.length - 1]!,
      maxAgeMs: Math.max(legs[0].ageMs, legs[1].ageMs),
    };
  });
  return {
    status: builds.length === 0 ? 'empty' : 'ok',
    emptyReason: builds.length === 0 ? 'NO_PAIRS_IN_BAND' : null,
    sportsbook: input.sportsbook,
    range: input.range,
    policy: input.policy,
    priceNotice: QUICK_BUILD_PRICE_NOTICE,
    games: input.games,
    builds,
  };
}
