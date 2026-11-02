/**
 * Display-only sportsbook quotes for Today's Games. Pure: no I/O, no provider calls.
 *
 * Collector side: provider odds rows → StoredOddsQuote (exact game id, field-level quarantine).
 * Serve side: stored quotes → at most one vendor's current pre-game quote per scheduled game.
 * Never a consensus, never an opening quote shown as current, never a model probability or EV.
 */

import { rawImpliedProbFromMoneyline } from '@/lib/betting/market-probability';
import { etYmd, shiftEtYmd } from '@/lib/games/status-sync-query';
import type { ScoreboardMarket, StoredOddsQuote, StoredScoreboardGame } from './contract';

/**
 * Collection runs every 15th scheduler tick (1-minute ticks). Intervals are 30 s short of the nominal
 * value so invocation start jitter cannot push a due attempt to the following tick. A healthy quote is
 * about 15 minutes old when replaced; FRESH_MS leaves margin for that. One failed attempt is retried
 * after 5 minutes and may show as delayed; anything older is stale and is not shown.
 */
export const SCOREBOARD_ODDS_POLICY = {
  INTERVAL_MS: 15 * 60_000 - 30_000,
  RETRY_AFTER_FAILURE_MS: 5 * 60_000 - 30_000,
  FRESH_MS: 20 * 60_000,
  DELAYED_MS: 35 * 60_000,
  /** A vendor row this far behind the same vendor's newest sync in one acquisition is not current. */
  VENDOR_LAG_MS: 10 * 60_000,
  /** Two full NBA slates (15 + 15): today and tomorrow are covered in one request. */
  MAX_GAMES_PER_REQUEST: 30,
  MAX_PAGES: 3,
  /**
   * A page starts only this soon after the tick began. A page costs at most 20 s limiter wait plus
   * 15 s HTTP timeout, so the step ends before the 55 s Lambda timeout instead of being killed by it.
   */
  PAGE_START_DEADLINE_MS: 15_000,
  /** Two-way book (sum of raw implied probabilities): at least a fair book (1.0) and at most this. */
  MAX_BOOK: 1.25,
  /** A dead-even moneyline cannot sit beside a spread this large; the moneyline is the suspect field. */
  EVEN_MONEYLINE_MAX_SPREAD: 3,
} as const;

/** Sportsbooks shown, in preference order. Prediction markets and unlisted books are never shown. */
export const MARKET_VENDOR_ORDER = ['draftkings', 'fanduel', 'caesars', 'betmgm', 'betrivers', 'betway'] as const;
const VENDOR_LABEL: Record<string, string> = {
  draftkings: 'DraftKings',
  fanduel: 'FanDuel',
  caesars: 'Caesars',
  betmgm: 'BetMGM',
  betrivers: 'BetRivers',
  betway: 'Betway',
};

const VENDOR_TOKEN = /^[a-z0-9_]{1,40}$/;

/** Plain decimal strings only ("-4", "+4.5", "220.0"); no hex, exponent or empty-string coercion. */
const DECIMAL_STRING = /^[+-]?\d+(\.\d+)?$/;

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || !DECIMAL_STRING.test(v.trim())) return null;
  return Number(v.trim());
}

/** American price: integer with |price| ≥ 100. +100 and −100 are both valid even-money prices. */
export function americanPrice(v: unknown): number | null {
  const n = toNumber(v);
  if (n == null || !Number.isInteger(n) || Math.abs(n) < 100 || Math.abs(n) > 100_000) return null;
  return n;
}

/** Whole- or half-point line within [min, max]: −4, 4.5, 220 and 220.5 pass; 220.25 does not. */
function halfPointLine(v: unknown, min: number, max: number): number | null {
  const n = toNumber(v);
  if (n == null || n < min || n > max || !Number.isInteger(n * 2)) return null;
  return n;
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export type OddsNormalizeResult = {
  quotes: StoredOddsQuote[];
  rejected: Array<{ gameId: string | null; vendor: string | null; reason: string }>;
  /** Present but malformed price/line fields stored as null. */
  quarantinedFields: number;
};

const PRICE_FIELDS = [
  ['moneyline_home_odds', 'moneylineHome'],
  ['moneyline_away_odds', 'moneylineAway'],
  ['spread_home_odds', 'spreadHomeOdds'],
  ['spread_away_odds', 'spreadAwayOdds'],
  ['total_over_odds', 'totalOverOdds'],
  ['total_under_odds', 'totalUnderOdds'],
] as const;
const LINE_FIELDS = [
  ['spread_home_value', 'spreadHome', -60, 60],
  ['spread_away_value', 'spreadAway', -60, 60],
  ['total_value', 'total', 100, 400],
] as const;

/**
 * Provider rows from one acquisition (all pages, each with its own request id) → current quotes for eligible games only.
 * A row for a game outside `eligibleGameIds` is dropped, so odds can never add a game or a season type.
 */
export function normalizeOddsRows(
  pages: Array<{ rows: unknown[]; requestId: string }>,
  ctx: { eligibleGameIds: ReadonlySet<string>; observedAt: string }
): OddsNormalizeResult {
  const rejected: OddsNormalizeResult['rejected'] = [];
  const byKey = new Map<string, StoredOddsQuote>();
  let quarantinedFields = 0;
  for (const { rows, requestId } of pages) for (const raw of rows) {
    if (typeof raw !== 'object' || raw == null || Array.isArray(raw)) {
      rejected.push({ gameId: null, vendor: null, reason: 'not_an_object' });
      continue;
    }
    const r = raw as Record<string, unknown>;
    const idNum = toNumber(r.game_id);
    const gameId = idNum != null && Number.isInteger(idNum) && idNum > 0 ? String(idNum) : null;
    const vendor = typeof r.vendor === 'string' ? r.vendor.trim().toLowerCase() : null;
    if (!gameId) {
      rejected.push({ gameId: null, vendor, reason: 'invalid_game_id' });
      continue;
    }
    if (!ctx.eligibleGameIds.has(gameId)) {
      rejected.push({ gameId, vendor, reason: 'not_eligible_game' });
      continue;
    }
    if (!vendor || !VENDOR_TOKEN.test(vendor)) {
      rejected.push({ gameId, vendor, reason: 'invalid_vendor' });
      continue;
    }
    const q: StoredOddsQuote = {
      gameId,
      vendor,
      quoteKind: 'current',
      moneylineHome: null,
      moneylineAway: null,
      spreadHome: null,
      spreadHomeOdds: null,
      spreadAway: null,
      spreadAwayOdds: null,
      total: null,
      totalOverOdds: null,
      totalUnderOdds: null,
      providerUpdatedAt: isoOrNull(r.updated_at),
      vendorSyncedAt: null,
      openedAt: null,
      firstObservedAt: ctx.observedAt,
      observedAt: ctx.observedAt,
      requestId,
      withdrawnAt: null,
      withdrawnRequestId: null,
    };
    for (const [src, dst] of PRICE_FIELDS) {
      q[dst] = americanPrice(r[src]);
      if (q[dst] == null && r[src] != null && r[src] !== '') quarantinedFields += 1;
    }
    for (const [src, dst, min, max] of LINE_FIELDS) {
      q[dst] = halfPointLine(r[src], min, max);
      if (q[dst] == null && r[src] != null && r[src] !== '') quarantinedFields += 1;
    }
    const key = `${gameId}::${vendor}`;
    const prev = byKey.get(key);
    if (prev) {
      rejected.push({ gameId, vendor, reason: 'duplicate_vendor_row' });
      const prevAt = prev.providerUpdatedAt ? Date.parse(prev.providerUpdatedAt) : -Infinity;
      const nextAt = q.providerUpdatedAt ? Date.parse(q.providerUpdatedAt) : -Infinity;
      if (nextAt <= prevAt) continue;
    }
    byKey.set(key, q);
  }
  const quotes = [...byKey.values()];
  const newestByVendor = new Map<string, number>();
  for (const q of quotes) {
    if (!q.providerUpdatedAt) continue;
    const t = Date.parse(q.providerUpdatedAt);
    newestByVendor.set(q.vendor, Math.max(newestByVendor.get(q.vendor) ?? -Infinity, t));
  }
  for (const q of quotes) {
    const t = newestByVendor.get(q.vendor);
    q.vendorSyncedAt = t == null ? null : new Date(t).toISOString();
  }
  quotes.sort((a, b) => a.gameId.localeCompare(b.gameId) || a.vendor.localeCompare(b.vendor));
  return { quotes, rejected, quarantinedFields };
}

const tipMs = (g: Pick<StoredScoreboardGame, 'scheduledTip'>): number | null => {
  const t = g.scheduledTip ? Date.parse(g.scheduledTip) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** Games that may receive a current pre-game quote: scheduled, tip in the future, today or tomorrow (ET). */
export function oddsEligibleGames(games: StoredScoreboardGame[], now: Date): StoredScoreboardGame[] {
  const today = etYmd(now);
  const tomorrow = shiftEtYmd(today, 1);
  return games
    .filter((g) => {
      const tip = tipMs(g);
      return (
        g.lifecycle === 'scheduled' &&
        g.pollingState !== 'complete' &&
        g.pollingState !== 'safety_stopped' &&
        tip != null &&
        tip > now.getTime() &&
        g.etDate >= today &&
        g.etDate <= tomorrow
      );
    })
    .sort((a, b) => (tipMs(a) ?? 0) - (tipMs(b) ?? 0) || a.gameId.localeCompare(b.gameId));
}

export type OddsAttemptState = { lastAttemptAt: string; lastOutcome: 'started' | 'success' | 'failed' } | null;

/** Whether an odds acquisition is due. A failure retries after 5 minutes, never on the next tick. */
export function oddsDue(state: OddsAttemptState, now: Date): boolean {
  if (!state) return true;
  const since = now.getTime() - Date.parse(state.lastAttemptAt);
  if (!Number.isFinite(since)) return true;
  const wait = state.lastOutcome === 'failed' ? SCOREBOARD_ODDS_POLICY.RETRY_AFTER_FAILURE_MS : SCOREBOARD_ODDS_POLICY.INTERVAL_MS;
  return since >= wait;
}

const BOOK_EPSILON = 1e-9;

/**
 * Both sides of one book's two-way market. Fair (sum 1.0, e.g. +100/−100) up to MAX_BOOK. Below 1.0
 * one book would be offering an arbitrage against itself, which no sportsbook quotes.
 */
function validPair(a: number | null, b: number | null): boolean {
  const pa = rawImpliedProbFromMoneyline(a);
  const pb = rawImpliedProbFromMoneyline(b);
  if (pa == null || pb == null) return false;
  const book = pa + pb;
  return book >= 1 - BOOK_EPSILON && book <= SCOREBOARD_ODDS_POLICY.MAX_BOOK;
}

/** Favorite by implied probability, not by the raw American number (−100 and +100 are the same price). */
function moneylineFavorite(home: number, away: number): 'home' | 'away' | null {
  const ph = rawImpliedProbFromMoneyline(home)!;
  const pa = rawImpliedProbFromMoneyline(away)!;
  if (Math.abs(ph - pa) < BOOK_EPSILON) return null;
  return ph > pa ? 'home' : 'away';
}

type CheckedMarkets = Pick<ScoreboardMarket, 'moneyline' | 'spread' | 'total'>;

/**
 * Each market is validated on its own; a bad field blanks only that market. Prices are never
 * rejected for their value alone (+100 is a valid even-money price); only the pair and its
 * agreement with the other markets of the same row are judged. Prediction-market vendors, the only
 * placeholder source seen, are excluded by vendor identity in selectMarket.
 * Moneyline: both sides, a book in [1.0, MAX_BOOK]. A dead-even moneyline next to a spread of
 * EVEN_MONEYLINE_MAX_SPREAD points or more contradicts its own row and is dropped.
 * Spread: both sides, mirrored, and not favoring the moneyline underdog. Prices kept only as a valid pair.
 * Total: a whole- or half-point line in range. Over/under prices kept only as a valid pair.
 */
export function checkMarkets(input: StoredOddsQuote): CheckedMarkets {
  const q = {
    moneylineHome: americanPrice(input.moneylineHome),
    moneylineAway: americanPrice(input.moneylineAway),
    spreadHome: halfPointLine(input.spreadHome, -60, 60),
    spreadAway: halfPointLine(input.spreadAway, -60, 60),
    spreadHomeOdds: americanPrice(input.spreadHomeOdds),
    spreadAwayOdds: americanPrice(input.spreadAwayOdds),
    total: halfPointLine(input.total, 100, 400),
    totalOverOdds: americanPrice(input.totalOverOdds),
    totalUnderOdds: americanPrice(input.totalUnderOdds),
  };
  let moneyline =
    q.moneylineHome != null && q.moneylineAway != null && validPair(q.moneylineHome, q.moneylineAway)
      ? { home: q.moneylineHome, away: q.moneylineAway }
      : null;
  const mirrored = q.spreadHome != null && q.spreadAway != null && q.spreadHome === -q.spreadAway;
  const mlFav = moneyline ? moneylineFavorite(moneyline.home, moneyline.away) : null;
  if (moneyline && mlFav == null && mirrored && Math.abs(q.spreadHome!) >= SCOREBOARD_ODDS_POLICY.EVEN_MONEYLINE_MAX_SPREAD) {
    moneyline = null;
  }
  let spread: CheckedMarkets['spread'] = null;
  if (mirrored && q.spreadHome != null && q.spreadAway != null) {
    const spreadFav = q.spreadHome < 0 ? 'home' : q.spreadHome > 0 ? 'away' : null;
    if (!(spreadFav && mlFav && moneyline && spreadFav !== mlFav)) {
      const pricesOk = validPair(q.spreadHomeOdds, q.spreadAwayOdds);
      spread = {
        home: q.spreadHome,
        away: q.spreadAway,
        home_odds: pricesOk ? q.spreadHomeOdds : null,
        away_odds: pricesOk ? q.spreadAwayOdds : null,
      };
    }
  }
  const total =
    q.total != null
      ? (() => {
          const pricesOk = validPair(q.totalOverOdds, q.totalUnderOdds);
          return { line: q.total, over_odds: pricesOk ? q.totalOverOdds : null, under_odds: pricesOk ? q.totalUnderOdds : null };
        })()
      : null;
  return { moneyline, spread, total };
}

export type MarketSelection =
  | { status: 'fresh' | 'delayed'; market: ScoreboardMarket }
  | { status: 'unavailable' | 'stale' | 'not_pregame'; market: null; reason: string };

/**
 * One vendor's current pre-game quote for one scheduled game, or a reason there is none.
 * Order: fresher class first, then a vendor with all three markets, then more valid markets,
 * then MARKET_VENDOR_ORDER. Markets are never combined across vendors.
 */
export function selectMarket(input: {
  game: Pick<StoredScoreboardGame, 'gameId' | 'lifecycle' | 'scheduledTip'>;
  quotes: StoredOddsQuote[];
  now: Date;
  /** True when the scoreboard game row itself is stale; its scheduled status is then unconfirmed. */
  gameStale?: boolean;
}): MarketSelection {
  const { game, now } = input;
  const t = now.getTime();
  if (game.lifecycle !== 'scheduled') return { status: 'not_pregame', market: null, reason: `lifecycle ${game.lifecycle}` };
  const tip = tipMs(game);
  if (tip != null && t >= tip) return { status: 'not_pregame', market: null, reason: 'past_scheduled_tip' };
  if (input.gameStale) return { status: 'not_pregame', market: null, reason: 'game_status_stale' };

  const candidates: Array<{ q: StoredOddsQuote; checked: CheckedMarkets; count: number; fresh: boolean }> = [];
  let sawStale = false;
  for (const q of input.quotes) {
    if (String(q.gameId) !== game.gameId || q.quoteKind !== 'current' || q.withdrawnAt != null) continue;
    const rank = (MARKET_VENDOR_ORDER as readonly string[]).indexOf(q.vendor);
    if (rank < 0) continue;
    const observed = Date.parse(q.observedAt);
    if (!Number.isFinite(observed) || observed > t) continue;
    if (tip != null && observed >= tip) continue;
    if (q.providerUpdatedAt && q.vendorSyncedAt) {
      const lag = Date.parse(q.vendorSyncedAt) - Date.parse(q.providerUpdatedAt);
      if (lag > SCOREBOARD_ODDS_POLICY.VENDOR_LAG_MS) continue;
    }
    const checked = checkMarkets(q);
    const count = Number(checked.moneyline != null) + Number(checked.spread != null) + Number(checked.total != null);
    if (count === 0) continue;
    const synced = q.providerUpdatedAt ? Date.parse(q.providerUpdatedAt) : observed;
    const age = t - Math.min(observed, synced);
    if (age > SCOREBOARD_ODDS_POLICY.DELAYED_MS) {
      sawStale = true;
      continue;
    }
    candidates.push({ q, checked, count, fresh: age <= SCOREBOARD_ODDS_POLICY.FRESH_MS });
  }
  if (candidates.length === 0) {
    return sawStale
      ? { status: 'stale', market: null, reason: 'quote_older_than_delayed_window' }
      : { status: 'unavailable', market: null, reason: 'no_verified_current_quote' };
  }
  const order = (v: string) => (MARKET_VENDOR_ORDER as readonly string[]).indexOf(v);
  candidates.sort(
    (a, b) =>
      Number(b.fresh) - Number(a.fresh) ||
      Number(b.count === 3) - Number(a.count === 3) ||
      b.count - a.count ||
      order(a.q.vendor) - order(b.q.vendor)
  );
  const { q, checked, fresh } = candidates[0];
  return {
    status: fresh ? 'fresh' : 'delayed',
    market: {
      kind: 'current_pregame',
      vendor: q.vendor,
      vendor_label: VENDOR_LABEL[q.vendor] ?? q.vendor,
      freshness: fresh ? 'fresh' : 'delayed',
      provider_updated_at: q.providerUpdatedAt,
      observed_at: q.observedAt,
      ...checked,
    },
  };
}

/** "DraftKings · BDL synced 3m ago". Sync time, measured against the response time; never a line-move time. */
export function marketSourceCaption(market: ScoreboardMarket | null | undefined, nowMs: number): string | null {
  if (!market) return null;
  // Without a provider sync time there is no BDL sync age to state; collection time is not one.
  const at = market.provider_updated_at ? Date.parse(market.provider_updated_at) : NaN;
  if (!Number.isFinite(at) || !Number.isFinite(nowMs)) return market.vendor_label;
  const minutes = Math.max(0, Math.floor((nowMs - at) / 60_000));
  return `${market.vendor_label} · BDL synced ${minutes < 1 ? 'just now' : `${minutes}m ago`}`;
}
