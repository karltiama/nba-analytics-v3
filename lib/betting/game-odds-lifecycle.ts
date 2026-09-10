/**
 * Game-market lifecycle for live BDL odds (not player props).
 *
 * Product labels:
 *   First Observed — earliest line Court Context captured from this sportsbook
 *                    through the provider feed. Not automatically "Opening Line".
 *   Current        — latest valid observed market state.
 *   Close          — last certified pre-tip snapshot (design; scheduler not in 13D).
 *
 * Grain: game + vendor + market. Books are independent. Partial markets are valid.
 * Historical Opening Snapshot (game_odds_market_movement) is a separate dataset.
 */

export const GAME_ODDS_MARKETS = ['moneyline', 'spread', 'total'] as const;
export type GameOddsMarket = (typeof GAME_ODDS_MARKETS)[number];

export type GameOddsQuote = {
  gameId: string;
  vendor: string;
  market: GameOddsMarket;
  /** American moneyline home / away. Null if that side is missing. */
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  homeSpread: number | null;
  awaySpread: number | null;
  homeSpreadOdds: number | null;
  awaySpreadOdds: number | null;
  total: number | null;
  overOdds: number | null;
  underOdds: number | null;
  /** Upstream market timestamp when the provider sent one. */
  providerUpdatedAt: string | null;
  /** When Court Context actually captured this observation. */
  observedAt: string;
};

export type BookMarketState = {
  firstObserved: GameOddsQuote;
  current: GameOddsQuote;
  /** Frozen pre-tip close; null until a future Close job certifies it. */
  close: GameOddsQuote | null;
};

export type LifecycleAction =
  | 'first_observed'
  | 'current_update'
  | 'unchanged'
  | 'skipped_unknown_game'
  | 'skipped_malformed'
  | 'skipped_empty';

export type ApplyObservationResult = {
  action: LifecycleAction;
  key: string;
  state: BookMarketState | null;
};

export function gameOddsMarketKey(gameId: string, vendor: string, market: GameOddsMarket): string {
  return `${gameId}::${vendor}::${market}`;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parseOptionalNumeric(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

/** A market is persistable when at least one side/line the market needs is present. */
export function isUsableGameOddsQuote(quote: GameOddsQuote): boolean {
  if (!quote.gameId.trim() || !quote.vendor.trim()) return false;
  if (quote.market === 'moneyline') {
    return isFiniteNumber(quote.homeMoneyline) || isFiniteNumber(quote.awayMoneyline);
  }
  if (quote.market === 'spread') {
    return isFiniteNumber(quote.homeSpread) || isFiniteNumber(quote.awaySpread);
  }
  return isFiniteNumber(quote.total);
}

export function isMalformedGameOddsQuote(quote: GameOddsQuote): boolean {
  if (!quote.gameId.trim() || !quote.vendor.trim()) return true;
  if (quote.market === 'moneyline') {
    const homeBad = quote.homeMoneyline != null && !isFiniteNumber(quote.homeMoneyline);
    const awayBad = quote.awayMoneyline != null && !isFiniteNumber(quote.awayMoneyline);
    return homeBad || awayBad;
  }
  if (quote.market === 'spread') {
    const lineBad =
      (quote.homeSpread != null && !isFiniteNumber(quote.homeSpread)) ||
      (quote.awaySpread != null && !isFiniteNumber(quote.awaySpread));
    return lineBad;
  }
  return quote.total != null && !isFiniteNumber(quote.total);
}

function sameCurrent(a: GameOddsQuote, b: GameOddsQuote): boolean {
  return (
    a.homeMoneyline === b.homeMoneyline &&
    a.awayMoneyline === b.awayMoneyline &&
    a.homeSpread === b.homeSpread &&
    a.awaySpread === b.awaySpread &&
    a.homeSpreadOdds === b.homeSpreadOdds &&
    a.awaySpreadOdds === b.awaySpreadOdds &&
    a.total === b.total &&
    a.overOdds === b.overOdds &&
    a.underOdds === b.underOdds
  );
}

/**
 * Apply one observation. First Observed is immutable. Current tracks the latest
 * usable quote. Close is never overwritten by a Current poll.
 */
export function applyGameOddsObservation(
  store: Map<string, BookMarketState>,
  quote: GameOddsQuote,
  opts?: { knownGameIds?: Set<string> }
): ApplyObservationResult {
  const key = gameOddsMarketKey(quote.gameId, quote.vendor, quote.market);

  if (opts?.knownGameIds && !opts.knownGameIds.has(quote.gameId)) {
    return { action: 'skipped_unknown_game', key, state: null };
  }
  if (isMalformedGameOddsQuote(quote)) {
    return { action: 'skipped_malformed', key, state: null };
  }
  if (!isUsableGameOddsQuote(quote)) {
    return { action: 'skipped_empty', key, state: null };
  }

  const existing = store.get(key);
  if (!existing) {
    const state: BookMarketState = {
      firstObserved: quote,
      current: quote,
      close: null,
    };
    store.set(key, state);
    return { action: 'first_observed', key, state };
  }

  if (sameCurrent(existing.current, quote)) {
    return { action: 'unchanged', key, state: existing };
  }

  const next: BookMarketState = {
    firstObserved: existing.firstObserved,
    current: quote,
    close: existing.close,
  };
  store.set(key, next);
  return { action: 'current_update', key, state: next };
}

/** Future Close job: freeze last current only when the game is still pre-tip. */
export function certifyGameOddsClose(
  store: Map<string, BookMarketState>,
  key: string,
  args: { gameStatus: string; tipTime: string | Date | null; now: Date }
): { ok: boolean; reason: string } {
  const state = store.get(key);
  if (!state) return { ok: false, reason: 'no_market' };
  if (state.close) return { ok: false, reason: 'already_closed' };

  const status = args.gameStatus.trim().toLowerCase();
  if (status === 'in progress' || status === 'final') {
    return { ok: false, reason: 'game_already_started_or_final' };
  }
  if (args.tipTime) {
    const tip = args.tipTime instanceof Date ? args.tipTime : new Date(args.tipTime);
    if (!Number.isNaN(tip.getTime()) && args.now.getTime() >= tip.getTime()) {
      return { ok: false, reason: 'at_or_past_tip' };
    }
  }

  state.close = state.current;
  store.set(key, state);
  return { ok: true, reason: 'closed' };
}

export function firstObservedLabel(): 'First Observed' {
  return 'First Observed';
}

export type SportsbookCoverageClass = 'MULTI_BOOK_READY' | 'SINGLE_BOOK_ONLY' | 'NO_CURRENT_MARKET';

export function classifySportsbookCoverage(vendorsWithUsableMarket: Iterable<string>): SportsbookCoverageClass {
  const n = new Set(Array.from(vendorsWithUsableMarket).map((v) => v.trim()).filter(Boolean)).size;
  if (n <= 0) return 'NO_CURRENT_MARKET';
  if (n === 1) return 'SINGLE_BOOK_ONLY';
  return 'MULTI_BOOK_READY';
}

export function estimateInjuriesOddsRequestBudget(args: {
  injuryPagesPerPull: number;
  injuryPullsPerDay: number;
  oddsRequestsPerCycle: number;
  oddsCyclesPerDay: number;
  intervalMs: number;
}): {
  injuryRequestsPerDay: number;
  oddsRequestsPerDay: number;
  totalRequestsPerDay: number;
  elapsedMsAtSafetyRate: number;
} {
  const injuryRequestsPerDay = Math.max(0, args.injuryPagesPerPull) * Math.max(0, args.injuryPullsPerDay);
  const oddsRequestsPerDay = Math.max(0, args.oddsRequestsPerCycle) * Math.max(0, args.oddsCyclesPerDay);
  const totalRequestsPerDay = injuryRequestsPerDay + oddsRequestsPerDay;
  return {
    injuryRequestsPerDay,
    oddsRequestsPerDay,
    totalRequestsPerDay,
    elapsedMsAtSafetyRate: totalRequestsPerDay * Math.max(0, args.intervalMs),
  };
}
