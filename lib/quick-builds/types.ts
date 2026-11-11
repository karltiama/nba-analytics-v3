/**
 * Isolated Quick Builds candidate contract.
 * Price math only. A timestamp on an input row does not mean the sportsbook
 * will still accept the bet, and combined American odds are not a parlay quote.
 */

import type { CanonicalPropType, PlayerPropV1Vendor } from '@/lib/betting/market-movement';

export const QUICK_BUILD_SHORTLIST_CAP = 5;
export const QUICK_BUILD_MAX_GAMES = 32;
export const QUICK_BUILD_MAX_ATTEMPTS = 256;
export const QUICK_BUILD_MAX_OBSERVATIONS = 4000;
export const QUICK_BUILD_MAX_TWO_SIDED_MARKETS = 2000;

/** Product of the two leg decimals, rounded with the shared American converter. Not a book quote. */
export const QUICK_BUILD_PRICE_NOTICE =
  'Calculated combined odds are the product of the two leg prices. They are not a sportsbook parlay quote.';

/** Product of the three leg decimals, rounded with the shared American converter. Not a book quote. */
export const QUICK_BUILD_THREE_LEG_PRICE_NOTICE =
  'Calculated combined odds are the product of the three leg prices. They are not a sportsbook parlay quote.';

/** Product of the four leg decimals, rounded with the shared American converter. Not a book quote. */
export const QUICK_BUILD_FOUR_LEG_PRICE_NOTICE =
  'Calculated combined odds are the product of the four leg prices. They are not a sportsbook parlay quote.';

/** Product of the five leg decimals, rounded with the shared American converter. Not a book quote. */
export const QUICK_BUILD_FIVE_LEG_PRICE_NOTICE =
  'Calculated combined odds are the product of the five leg prices. They are not a sportsbook parlay quote.';

/** Shown when a three-leg search stops at its work bound after finding candidates. */
export const QUICK_BUILD_SEARCH_BUDGET_NOTE =
  'This shortlist came from a bounded search. More combinations may exist outside the candidates that were kept.';

/** Exact combined-odds checks a three-leg search may perform before it stops. */
export const QUICK_BUILD_TRIPLE_PROBE_BUDGET = 80_000;

/** Closest in-band triples retained for the diversity shortlist. */
export const QUICK_BUILD_TRIPLE_RETAIN = 1_500;

/**
 * One closest side per player, for at most this many players, used for the
 * first two legs of each game triple. The third leg stays the price window
 * over that game's sides, so a qualifying price is not dropped with the seed.
 * Games are ordered by id, and a slate wider than this seed is incomplete.
 */
export const QUICK_BUILD_TRIPLE_SEED_PLAYERS = 12;

/** Exact combined-odds checks a four- or five-leg search may perform before it stops. */
export const QUICK_BUILD_TUPLE_PROBE_BUDGET = 80_000;

/** Closest in-band four- and five-leg candidates retained for the diversity shortlist. */
export const QUICK_BUILD_TUPLE_RETAIN = 1_500;

/**
 * Game tuples visited on a wide slate. Indexes are evenly spaced through the
 * lexicographic combination list, so the traversal itself stays bounded when
 * a 32-game slate has hundreds of thousands of tuples.
 */
export const QUICK_BUILD_TUPLE_VISIT_CAP = 256;

/** One closest side per player on the seeded legs of a four-leg tuple. */
export const QUICK_BUILD_FOUR_LEG_SEED_PLAYERS = 8;

/** One closest side per player on the seeded legs of a five-leg tuple. */
export const QUICK_BUILD_FIVE_LEG_SEED_PLAYERS = 6;

export const QUICK_BUILD_EMPTY_REASONS = [
  'NO_UPCOMING_GAMES',
  'NO_SUCCESSFUL_PULL',
  'NO_ELIGIBLE_MARKETS',
  'NO_CROSS_GAME',
  'NO_PAIRS_IN_BAND',
  'NO_COMBINATIONS_IN_BAND',
  'SEARCH_BUDGET_REACHED',
] as const;
export type QuickBuildEmptyReason = (typeof QUICK_BUILD_EMPTY_REASONS)[number];

/**
 * Inclusive American bounds, compared as numbers (−200 is less than −110).
 * +125 is inside both Balanced and Higher Payout when those ranges are requested separately.
 * The decimal midpoint of the band is a ranking heuristic, not a probability or an edge.
 */
export const QUICK_BUILD_PRESETS = {
  higher_hit_chance: { minAmerican: -200, maxAmerican: -110 },
  balanced: { minAmerican: -110, maxAmerican: 125 },
  higher_payout: { minAmerican: 125, maxAmerican: 200 },
} as const;
export type QuickBuildPresetName = keyof typeof QUICK_BUILD_PRESETS;

/** Inclusive American bounds for optional three-leg builds. Separate from the two-leg presets. */
export const QUICK_BUILD_THREE_LEG_PRESETS = {
  shorter_payout: { minAmerican: 200, maxAmerican: 399 },
  midrange: { minAmerican: 400, maxAmerican: 699 },
  longer_payout: { minAmerican: 700, maxAmerican: 999 },
} as const;
export type QuickBuildThreeLegPresetName = keyof typeof QUICK_BUILD_THREE_LEG_PRESETS;

/** Inclusive American bounds for optional four-leg builds. Not a three-leg preset. */
export const QUICK_BUILD_FOUR_LEG_PRESETS = {
  four_shorter: { minAmerican: 800, maxAmerican: 999 },
  four_middle: { minAmerican: 1000, maxAmerican: 1399 },
  four_longer: { minAmerican: 1400, maxAmerican: 1699 },
} as const;
export type QuickBuildFourLegPresetName = keyof typeof QUICK_BUILD_FOUR_LEG_PRESETS;

/** Inclusive American bounds for optional five-leg builds. Not a four-leg preset. */
export const QUICK_BUILD_FIVE_LEG_PRESETS = {
  five_shorter: { minAmerican: 1600, maxAmerican: 1999 },
  five_middle: { minAmerican: 2000, maxAmerican: 2599 },
  five_longer: { minAmerican: 2600, maxAmerican: 3499 },
} as const;
export type QuickBuildFiveLegPresetName = keyof typeof QUICK_BUILD_FIVE_LEG_PRESETS;

export type AmericanOddsRange = {
  minAmerican: number;
  maxAmerican: number;
};

export type QuickBuildEligibilityMode = 'research_snapshot' | 'recently_observed';

/**
 * research_snapshot: latest complete success may be used, and a later failed or
 * zero-row attempt is reported on the game instead of being treated as proof
 * that the older board is still current.
 * recently_observed: that later attempt blocks the game, and each row must fall
 * inside maxObservationAgeMs of asOf.
 */
export type QuickBuildPolicy = {
  mode: QuickBuildEligibilityMode;
  /** Instant the caller is asking about. The engine does not read the clock. */
  asOf: string;
  maxObservationAgeMs?: number;
};

export type QuickBuildGameInput = {
  gameId: string;
  startTime: string;
  status?: string | null;
};

export type PullAttemptStatus = 'started' | 'success' | 'error';

export type GamePullAttempt = {
  pullRunId: string;
  gameId: string;
  status: PullAttemptStatus;
  rowsStored: number;
  completedAt: string | null;
  /** RESPONSE_RECEIVED when this attempt's stored rows use the observation clock. */
  observationClock: 'RESPONSE_RECEIVED' | null;
};

export type MarketObservationInput = {
  playerId: string;
  gameId: string;
  market: string;
  side: string;
  line: number | string;
  sportsbook: string;
  oddsAmerican: number | null;
  pullRunId: string;
  observedAt: string | null;
  observationClock: 'RESPONSE_RECEIVED' | null;
};

export type QuickBuildRequest = {
  sportsbook: string;
  range: AmericanOddsRange;
  policy: QuickBuildPolicy;
  games: QuickBuildGameInput[];
  attempts: GamePullAttempt[];
  observations: MarketObservationInput[];
  /** Omitted means two legs. Three, four, and five legs use their own generators. */
  legCount?: 2 | 3 | 4 | 5;
};

export type BlockingAttemptKind = 'failed' | 'zero_row' | 'invalid_clock' | 'in_progress' | 'incomplete';

export type BlockingAttempt = {
  pullRunId: string;
  status: PullAttemptStatus;
  rowsStored: number;
  kind: BlockingAttemptKind;
};

export type GameEligibilityRejection =
  | 'NOT_UPCOMING'
  | 'NO_COMPLETE_PULL'
  | 'NEWER_UNSUCCESSFUL_ATTEMPT'
  | 'STALE_OBSERVATION';

export type GameEligibility = {
  gameId: string;
  upcoming: boolean;
  /** Set only when this game's rows may enter the generator. */
  eligiblePullRunId: string | null;
  rejection: GameEligibilityRejection | null;
  /**
   * A later attempt that is not a complete success. Present for both policies.
   * recently_observed refuses the game. research_snapshot still uses the older
   * complete pull and does not treat this attempt as a fresh board.
   */
  newerUnsuccessfulAttempt: BlockingAttempt | null;
  stalePullRunId: string | null;
};

export type QuickBuildLeg = {
  playerId: string;
  gameId: string;
  market: CanonicalPropType;
  side: 'over' | 'under';
  line: number;
  sportsbook: PlayerPropV1Vendor;
  oddsAmerican: number;
  oppositeAmerican: number;
  /** Two-sided no-vig estimate for this leg only. Not a joint parlay probability. */
  noVigProbability: number;
  pullRunId: string;
  observedAt: string;
  ageMs: number;
};

type QuickBuildCommon = {
  id: string;
  combinedAmerican: number;
  /** 1 / combined decimal at the calculated payout. Not a model hit rate. */
  breakEvenProbability: number;
  /** Absolute decimal-odds distance from the decimal midpoint of the requested band. Not a probability. */
  distanceToMidpoint: number;
  oldestObservedAt: string;
  newestObservedAt: string;
  maxAgeMs: number;
};

export type QuickBuild =
  | (QuickBuildCommon & { legs: [QuickBuildLeg, QuickBuildLeg] })
  | (QuickBuildCommon & { legs: [QuickBuildLeg, QuickBuildLeg, QuickBuildLeg] })
  | (QuickBuildCommon & { legs: [QuickBuildLeg, QuickBuildLeg, QuickBuildLeg, QuickBuildLeg] })
  | (QuickBuildCommon & { legs: [QuickBuildLeg, QuickBuildLeg, QuickBuildLeg, QuickBuildLeg, QuickBuildLeg] });

export type QuickBuildResult = {
  status: 'ok' | 'empty';
  emptyReason: QuickBuildEmptyReason | null;
  sportsbook: PlayerPropV1Vendor | null;
  range: AmericanOddsRange | null;
  policy: QuickBuildPolicy | null;
  priceNotice:
    | typeof QUICK_BUILD_PRICE_NOTICE
    | typeof QUICK_BUILD_THREE_LEG_PRICE_NOTICE
    | typeof QUICK_BUILD_FOUR_LEG_PRICE_NOTICE
    | typeof QUICK_BUILD_FIVE_LEG_PRICE_NOTICE;
  games: GameEligibility[];
  builds: QuickBuild[];
  /**
   * Three-, four-, and five-leg searches. False means seeding, tuple coverage,
   * or the work bound stopped the search before every legal combination was
   * assessed. Absent on two-leg results.
   */
  searchComplete?: boolean;
  /**
   * Local measurement for the four- and five-leg generator. Removed before the
   * API response is returned.
   */
  searchStats?: {
    probes: number;
    candidates: number;
    tuplesVisited: number;
    tuplesAvailable: number;
  };
};

export class QuickBuildInputError extends Error {
  readonly code:
    | 'MALFORMED_INPUT'
    | 'LIMIT_EXCEEDED'
    | 'INELIGIBLE_GAME'
    | 'NEED_TWO_GAMES'
    | 'NEED_THREE_GAMES'
    | 'NEED_FOUR_GAMES'
    | 'NEED_FIVE_GAMES';

  constructor(
    code:
      | 'MALFORMED_INPUT'
      | 'LIMIT_EXCEEDED'
      | 'INELIGIBLE_GAME'
      | 'NEED_TWO_GAMES'
      | 'NEED_THREE_GAMES'
      | 'NEED_FOUR_GAMES'
      | 'NEED_FIVE_GAMES',
    message: string,
  ) {
    super(message);
    this.name = 'QuickBuildInputError';
    this.code = code;
  }
}
