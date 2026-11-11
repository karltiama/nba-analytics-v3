/**
 * Display-oriented result. Does not rank and does not invent prices.
 */

import {
  QUICK_BUILD_FIVE_LEG_PRICE_NOTICE,
  QUICK_BUILD_FOUR_LEG_PRICE_NOTICE,
  QUICK_BUILD_PRICE_NOTICE,
  QUICK_BUILD_THREE_LEG_PRICE_NOTICE,
  type AmericanOddsRange,
  type GameEligibility,
  type QuickBuild,
  type QuickBuildEmptyReason,
  type QuickBuildLeg,
  type QuickBuildPolicy,
  type QuickBuildResult,
} from './types';
import type { PlayerPropV1Vendor } from '@/lib/betting/market-movement';
import type { RankedPair, RankedTriple, RankedTuple } from './rank';
import type { SideQuote } from './markets';

export function emptyQuickBuildResult(input: {
  sportsbook: PlayerPropV1Vendor | null;
  range: AmericanOddsRange | null;
  policy: QuickBuildPolicy | null;
  games: GameEligibility[];
  reason: QuickBuildEmptyReason;
  legCount?: 2 | 3 | 4 | 5;
  searchComplete?: boolean;
}): QuickBuildResult {
  const extended = input.legCount === 3 || input.legCount === 4 || input.legCount === 5;
  return {
    status: 'empty',
    emptyReason: input.reason,
    sportsbook: input.sportsbook,
    range: input.range,
    policy: input.policy,
    priceNotice: priceNoticeFor(input.legCount ?? 2),
    games: input.games,
    builds: [],
    ...(extended ? { searchComplete: input.searchComplete !== false } : {}),
  };
}

function priceNoticeFor(legCount: 2 | 3 | 4 | 5): QuickBuildResult['priceNotice'] {
  if (legCount === 5) return QUICK_BUILD_FIVE_LEG_PRICE_NOTICE;
  if (legCount === 4) return QUICK_BUILD_FOUR_LEG_PRICE_NOTICE;
  if (legCount === 3) return QUICK_BUILD_THREE_LEG_PRICE_NOTICE;
  return QUICK_BUILD_PRICE_NOTICE;
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
    const legs = pair.legs.map(toLeg) as [QuickBuildLeg, QuickBuildLeg];
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

export function presentTriples(input: {
  sportsbook: PlayerPropV1Vendor;
  range: AmericanOddsRange;
  policy: QuickBuildPolicy;
  games: GameEligibility[];
  builds: RankedTriple[];
  searchComplete: boolean;
}): QuickBuildResult {
  const builds: QuickBuild[] = input.builds.map((triple) => {
    const legs = triple.legs.map(toLeg) as [QuickBuildLeg, QuickBuildLeg, QuickBuildLeg];
    const times = legs.map((leg) => leg.observedAt).slice().sort();
    return {
      id: triple.id,
      legs,
      combinedAmerican: triple.combinedAmerican,
      breakEvenProbability: triple.breakEvenProbability,
      distanceToMidpoint: triple.distanceToMidpoint,
      oldestObservedAt: times[0]!,
      newestObservedAt: times[times.length - 1]!,
      maxAgeMs: Math.max(...legs.map((leg) => leg.ageMs)),
    };
  });
  return {
    status: 'ok',
    emptyReason: null,
    sportsbook: input.sportsbook,
    range: input.range,
    policy: input.policy,
    priceNotice: QUICK_BUILD_THREE_LEG_PRICE_NOTICE,
    games: input.games,
    builds,
    searchComplete: input.searchComplete,
  };
}

export function presentTuples(input: {
  sportsbook: PlayerPropV1Vendor;
  range: AmericanOddsRange;
  policy: QuickBuildPolicy;
  games: GameEligibility[];
  builds: RankedTuple[];
  legCount: 4 | 5;
  searchComplete: boolean;
}): QuickBuildResult {
  const builds: QuickBuild[] = input.builds.map((tuple) => {
    const legs = tuple.legs.map(toLeg);
    const times = legs.map((leg) => leg.observedAt).slice().sort();
    const build = {
      id: tuple.id,
      legs: asQuickBuildLegs(legs, input.legCount),
      combinedAmerican: tuple.combinedAmerican,
      breakEvenProbability: tuple.breakEvenProbability,
      distanceToMidpoint: tuple.distanceToMidpoint,
      oldestObservedAt: times[0]!,
      newestObservedAt: times[times.length - 1]!,
      maxAgeMs: Math.max(...legs.map((leg) => leg.ageMs)),
    };
    return build as QuickBuild;
  });
  return {
    status: 'ok',
    emptyReason: null,
    sportsbook: input.sportsbook,
    range: input.range,
    policy: input.policy,
    priceNotice: priceNoticeFor(input.legCount),
    games: input.games,
    builds,
    searchComplete: input.searchComplete,
  };
}

function asQuickBuildLegs(legs: QuickBuildLeg[], legCount: 4 | 5): QuickBuild['legs'] {
  if (legCount === 4) return [legs[0]!, legs[1]!, legs[2]!, legs[3]!];
  return [legs[0]!, legs[1]!, legs[2]!, legs[3]!, legs[4]!];
}
