/**
 * Quick Builds candidate engine. Pure: no React, database, HTTP, or clock reads.
 */

import { canonicalizeSportsbook } from '@/lib/parlay-xray/resolution/sportsbook';
import { isPlayerPropV1Vendor, type PlayerPropV1Vendor } from '@/lib/betting/market-movement';
import { selectEligibleObservations } from './eligibility';
import { generateBandPairs } from './generate';
import { searchThreeLegCandidates } from './generate-triples';
import { searchTupleCandidates } from './generate-tuples';
import { buildTwoSidedMarkets } from './markets';
import { emptyQuickBuildResult, presentBuilds, presentTriples, presentTuples } from './present';
import { collapseNearDuplicates, selectShortlist } from './rank';
import {
  QUICK_BUILD_PRESETS,
  QUICK_BUILD_SHORTLIST_CAP,
  QuickBuildInputError,
  type AmericanOddsRange,
  type QuickBuildEmptyReason,
  type QuickBuildPresetName,
  type QuickBuildRequest,
  type QuickBuildResult,
} from './types';

export {
  QUICK_BUILD_EMPTY_REASONS,
  QUICK_BUILD_MAX_ATTEMPTS,
  QUICK_BUILD_MAX_GAMES,
  QUICK_BUILD_MAX_OBSERVATIONS,
  QUICK_BUILD_MAX_TWO_SIDED_MARKETS,
  QUICK_BUILD_PRESETS,
  QUICK_BUILD_PRICE_NOTICE,
  QUICK_BUILD_SEARCH_BUDGET_NOTE,
  QUICK_BUILD_SHORTLIST_CAP,
  QUICK_BUILD_THREE_LEG_PRESETS,
  QUICK_BUILD_THREE_LEG_PRICE_NOTICE,
  QUICK_BUILD_TRIPLE_PROBE_BUDGET,
  QUICK_BUILD_TRIPLE_RETAIN,
  QuickBuildInputError,
} from './types';
export type {
  AmericanOddsRange,
  BlockingAttempt,
  GameEligibility,
  GamePullAttempt,
  MarketObservationInput,
  QuickBuild,
  QuickBuildEligibilityMode,
  QuickBuildEmptyReason,
  QuickBuildGameInput,
  QuickBuildLeg,
  QuickBuildPolicy,
  QuickBuildPresetName,
  QuickBuildThreeLegPresetName,
  QuickBuildRequest,
  QuickBuildResult,
} from './types';

export function presetRange(name: QuickBuildPresetName): AmericanOddsRange {
  const range = QUICK_BUILD_PRESETS[name];
  return { minAmerican: range.minAmerican, maxAmerican: range.maxAmerican };
}

function requireRange(range: AmericanOddsRange): AmericanOddsRange {
  if (range == null || typeof range !== 'object') {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'range is required');
  }
  if (!Number.isFinite(range.minAmerican) || !Number.isFinite(range.maxAmerican)) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'range bounds must be finite');
  }
  if (range.minAmerican > range.maxAmerican) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'range minAmerican is above maxAmerican');
  }
  return { minAmerican: range.minAmerican, maxAmerican: range.maxAmerican };
}

function requireSportsbook(raw: string): PlayerPropV1Vendor {
  const book = canonicalizeSportsbook(raw);
  if (!book || !isPlayerPropV1Vendor(book.vendor)) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'sportsbook is not a supported parlay book');
  }
  return book.vendor;
}

function assertRequest(input: QuickBuildRequest): void {
  if (input == null || typeof input !== 'object') {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'request is required');
  }
  if (!Array.isArray(input.games) || !Array.isArray(input.attempts) || !Array.isArray(input.observations)) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'games, attempts, and observations must be arrays');
  }
}

export function generateQuickBuilds(input: QuickBuildRequest): QuickBuildResult {
  assertRequest(input);
  if (input.legCount === 3) return generateThreeLegQuickBuilds(input);
  if (input.legCount === 4 || input.legCount === 5) return generateTupleQuickBuilds(input, input.legCount);
  if (input.legCount != null && input.legCount !== 2) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'leg count must be 2, 3, 4, or 5');
  }
  const sportsbook = requireSportsbook(input.sportsbook);
  const range = requireRange(input.range);
  const selected = selectEligibleObservations({
    policy: input.policy,
    games: input.games,
    attempts: input.attempts,
    observations: input.observations,
  });

  const base = {
    sportsbook,
    range,
    policy: input.policy,
    games: selected.games,
  };

  if (selected.upcomingCount === 0) {
    return emptyQuickBuildResult({ ...base, reason: 'NO_UPCOMING_GAMES' });
  }
  const contributing = selected.games.filter((game) => game.eligiblePullRunId != null);
  if (contributing.length === 0) {
    return emptyQuickBuildResult({ ...base, reason: 'NO_SUCCESSFUL_PULL' });
  }

  const markets = buildTwoSidedMarkets({
    observations: selected.observations,
    sportsbook,
    asOfMs: selected.asOfMs,
  });
  if (markets.length === 0) {
    return emptyQuickBuildResult({ ...base, reason: 'NO_ELIGIBLE_MARKETS' });
  }
  const gameIds = new Set(markets.map((market) => market.over.gameId));
  if (gameIds.size < 2) {
    return emptyQuickBuildResult({ ...base, reason: 'NO_CROSS_GAME' });
  }

  const legal = markets.filter((market, index) =>
    markets.some(
      (other, otherIndex) =>
        otherIndex !== index &&
        other.over.gameId !== market.over.gameId &&
        other.over.playerId !== market.over.playerId
    )
  );
  if (legal.length === 0) {
    return emptyQuickBuildResult({ ...base, reason: 'NO_ELIGIBLE_MARKETS' });
  }

  const band = generateBandPairs(legal, range);
  if (band.length === 0) {
    return emptyQuickBuildResult({ ...base, reason: 'NO_PAIRS_IN_BAND' });
  }

  const shortlist = selectShortlist(collapseNearDuplicates(band), QUICK_BUILD_SHORTLIST_CAP, range);
  if (shortlist.length === 0) {
    return emptyQuickBuildResult({ ...base, reason: 'NO_PAIRS_IN_BAND' satisfies QuickBuildEmptyReason });
  }
  return presentBuilds({ ...base, builds: shortlist });
}

function generateThreeLegQuickBuilds(input: QuickBuildRequest): QuickBuildResult {
  const sportsbook = requireSportsbook(input.sportsbook);
  const range = requireRange(input.range);
  const selected = selectEligibleObservations({
    policy: input.policy,
    games: input.games,
    attempts: input.attempts,
    observations: input.observations,
  });
  const base = {
    sportsbook,
    range,
    policy: input.policy,
    games: selected.games,
  };
  if (selected.upcomingCount === 0) {
    return emptyQuickBuildResult({ ...base, reason: 'NO_UPCOMING_GAMES', legCount: 3 });
  }
  const contributing = selected.games.filter((game) => game.eligiblePullRunId != null);
  if (contributing.length === 0) {
    return emptyQuickBuildResult({ ...base, reason: 'NO_SUCCESSFUL_PULL', legCount: 3 });
  }
  const markets = buildTwoSidedMarkets({
    observations: selected.observations,
    sportsbook,
    asOfMs: selected.asOfMs,
  });
  if (markets.length === 0) {
    return emptyQuickBuildResult({ ...base, reason: 'NO_ELIGIBLE_MARKETS', legCount: 3 });
  }
  const gameIds = new Set(markets.map((market) => market.over.gameId));
  if (gameIds.size < 3) {
    return emptyQuickBuildResult({ ...base, reason: 'NO_CROSS_GAME', legCount: 3 });
  }
  const search = searchThreeLegCandidates(markets, range);
  if (search.triples.length === 0) {
    return emptyQuickBuildResult({
      ...base,
      reason: search.complete ? 'NO_COMBINATIONS_IN_BAND' : 'SEARCH_BUDGET_REACHED',
      legCount: 3,
      searchComplete: search.complete,
    });
  }
  return presentTriples({ ...base, builds: search.triples, searchComplete: search.complete });
}

function generateTupleQuickBuilds(input: QuickBuildRequest, legCount: 4 | 5): QuickBuildResult {
  const sportsbook = requireSportsbook(input.sportsbook);
  const range = requireRange(input.range);
  const selected = selectEligibleObservations({
    policy: input.policy,
    games: input.games,
    attempts: input.attempts,
    observations: input.observations,
  });
  const base = {
    sportsbook,
    range,
    policy: input.policy,
    games: selected.games,
  };
  if (selected.upcomingCount === 0) {
    return emptyQuickBuildResult({ ...base, reason: 'NO_UPCOMING_GAMES', legCount });
  }
  const contributing = selected.games.filter((game) => game.eligiblePullRunId != null);
  if (contributing.length === 0) {
    return emptyQuickBuildResult({ ...base, reason: 'NO_SUCCESSFUL_PULL', legCount });
  }
  const markets = buildTwoSidedMarkets({
    observations: selected.observations,
    sportsbook,
    asOfMs: selected.asOfMs,
  });
  if (markets.length === 0) {
    return emptyQuickBuildResult({ ...base, reason: 'NO_ELIGIBLE_MARKETS', legCount });
  }
  const gameIds = new Set(markets.map((market) => market.over.gameId));
  if (gameIds.size < legCount) {
    return emptyQuickBuildResult({ ...base, reason: 'NO_CROSS_GAME', legCount });
  }
  const search = searchTupleCandidates(markets, range, legCount);
  const searchStats = {
    probes: search.probes,
    candidates: search.retained,
    tuplesVisited: search.tuplesVisited,
    tuplesAvailable: search.tuplesAvailable,
  };
  if (search.tuples.length === 0) {
    return {
      ...emptyQuickBuildResult({
        ...base,
        reason: search.complete ? 'NO_COMBINATIONS_IN_BAND' : 'SEARCH_BUDGET_REACHED',
        legCount,
        searchComplete: search.complete,
      }),
      searchStats,
    };
  }
  return {
    ...presentTuples({ ...base, builds: search.tuples, legCount, searchComplete: search.complete }),
    searchStats,
  };
}
