/**
 * Dashboard-only view of one stored DraftKings row.
 * The scoreboard payload is a different store and is left unchanged.
 * A shown price is labeled with its observation time. It is not a live quote.
 */

import type { Game } from '@/components/betting/GameCard';
import { twoWayMarketDisplay } from '@/lib/betting/market-probability';
import { checkMarkets } from '@/lib/scoreboard/market';
import type { StoredOddsQuote } from '@/lib/scoreboard/contract';

export const STORED_ODDS_CAPTION_PREFIX = 'DraftKings · observed ';

export const STORED_ODDS_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const STORED_ODDS_SQL = `
SELECT
  c.game_id::text AS game_id,
  c.vendor,
  c.snapshot_at,
  c.home_moneyline,
  c.away_moneyline,
  c.home_spread,
  c.home_spread_odds,
  c.away_spread,
  c.away_spread_odds,
  c.total,
  c.over_odds,
  c.under_odds
FROM analytics.game_odds_current c
JOIN analytics.games g ON g.game_id::text = c.game_id::text
WHERE lower(c.vendor) = 'draftkings'
  AND c.game_id::text = ANY($1::text[])
  AND g.start_time > $2::timestamptz
`;

export type StoredOddsSourceRow = {
  game_id: string;
  vendor: string | null;
  snapshot_at: string | Date | null;
  home_moneyline: unknown;
  away_moneyline: unknown;
  home_spread: unknown;
  home_spread_odds: unknown;
  away_spread: unknown;
  away_spread_odds: unknown;
  total: unknown;
  over_odds: unknown;
  under_odds: unknown;
};

export type StoredOddsPatch = Pick<
  Game,
  | 'homeOdds'
  | 'awayOdds'
  | 'overUnder'
  | 'overOdds'
  | 'underOdds'
  | 'homeImpliedProb'
  | 'awayImpliedProb'
  | 'isFavorite'
  | 'isClose'
  | 'hasOdds'
  | 'marketCaption'
>;

const EMPTY_ODDS = { moneyline: null, spread: null, spreadOdds: null };
const FUTURE_SKEW_MS = 2 * 60 * 1000;

function instantMs(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type EtParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  dayPeriod: string;
};

function etParts(ms: number): EtParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12',
  }).formatToParts(new Date(ms));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    dayPeriod: read('dayPeriod').toUpperCase(),
  };
}

/** Eastern clock time. Independent of the host zone. */
export function formatObservedEt(value: string | Date): string {
  const ms = instantMs(value);
  if (ms == null) return '';
  const parts = etParts(ms);
  if (!parts.hour || !parts.minute || (parts.dayPeriod !== 'AM' && parts.dayPeriod !== 'PM')) return '';
  return `${parts.hour}:${parts.minute} ${parts.dayPeriod} ET`;
}

/** Same-day observations use the clock. An older Eastern date keeps that date so the age stays readable. */
export function observedCaption(snapshotAt: string | Date, now: Date): string {
  const observedMs = instantMs(snapshotAt);
  if (observedMs == null) return '';
  const clock = formatObservedEt(snapshotAt);
  if (!clock) return '';
  const observed = etParts(observedMs);
  const current = etParts(now.getTime());
  const sameDay = observed.year === current.year && observed.month === current.month && observed.day === current.day;
  const when = sameDay ? clock : `${observed.month} ${observed.day}, ${clock}`;
  return `${STORED_ODDS_CAPTION_PREFIX}${when}`;
}

/** Code only. Query text and connection strings stay out of the log. */
export function storedOddsFailureLog(err: unknown): { code: string } {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code)) return { code };
  }
  return { code: 'unknown' };
}

export function draftKingsPatch(row: StoredOddsSourceRow, now: Date): StoredOddsPatch | null {
  if ((row.vendor ?? '').trim().toLowerCase() !== 'draftkings') return null;
  const observedMs = instantMs(row.snapshot_at);
  if (observedMs == null || observedMs > now.getTime() + FUTURE_SKEW_MS) return null;
  const observedAt = new Date(observedMs).toISOString();
  const caption = observedCaption(observedAt, now);
  if (!caption) return null;
  const quote: StoredOddsQuote = {
    gameId: String(row.game_id),
    vendor: 'draftkings',
    quoteKind: 'current',
    moneylineHome: num(row.home_moneyline),
    moneylineAway: num(row.away_moneyline),
    spreadHome: num(row.home_spread),
    spreadHomeOdds: num(row.home_spread_odds),
    spreadAway: num(row.away_spread),
    spreadAwayOdds: num(row.away_spread_odds),
    total: num(row.total),
    totalOverOdds: num(row.over_odds),
    totalUnderOdds: num(row.under_odds),
    providerUpdatedAt: observedAt,
    vendorSyncedAt: null,
    openedAt: null,
    firstObservedAt: observedAt,
    observedAt,
    requestId: '',
    withdrawnAt: null,
    withdrawnRequestId: null,
  };
  const checked = checkMarkets(quote);
  if (!checked.moneyline && !checked.spread && !checked.total) return null;
  const display = checked.moneyline ? twoWayMarketDisplay(checked.moneyline.away, checked.moneyline.home) : null;
  return {
    homeOdds: {
      moneyline: checked.moneyline?.home ?? null,
      spread: checked.spread?.home ?? null,
      spreadOdds: checked.spread?.home_odds ?? null,
    },
    awayOdds: {
      moneyline: checked.moneyline?.away ?? null,
      spread: checked.spread?.away ?? null,
      spreadOdds: checked.spread?.away_odds ?? null,
    },
    overUnder: checked.total?.line ?? null,
    overOdds: checked.total?.over_odds ?? null,
    underOdds: checked.total?.under_odds ?? null,
    homeImpliedProb: display?.homePct ?? null,
    awayImpliedProb: display?.awayPct ?? null,
    isFavorite: display?.favorite ?? null,
    isClose: display?.isClose ?? false,
    hasOdds: true,
    marketCaption: caption,
  };
}

function isStoredOddsPatch(value: unknown): value is StoredOddsPatch {
  if (!value || typeof value !== 'object') return false;
  const caption = (value as { marketCaption?: unknown }).marketCaption;
  if (typeof caption !== 'string' || !caption.startsWith(STORED_ODDS_CAPTION_PREFIX)) return false;
  const home = (value as { homeOdds?: unknown }).homeOdds;
  const away = (value as { awayOdds?: unknown }).awayOdds;
  return home != null && typeof home === 'object' && away != null && typeof away === 'object';
}

/** Keep only captioned DraftKings patches from the dashboard response. */
export function parseStoredOddsPayload(body: unknown): Record<string, StoredOddsPatch> {
  if (!body || typeof body !== 'object') return {};
  const odds = (body as { odds?: unknown }).odds;
  if (!odds || typeof odds !== 'object') return {};
  const next: Record<string, StoredOddsPatch> = {};
  for (const [id, value] of Object.entries(odds)) {
    if (isStoredOddsPatch(value)) next[id] = value;
  }
  return next;
}

/** The dashboard slate merge: parse the stored-odds response, then fill pregame cards only. */
export function mergeDashboardStoredOdds(games: readonly Game[], body: unknown): Game[] {
  const patches = parseStoredOddsPayload(body);
  return games.map((game) => applyStoredOdds(game, patches[game.id]));
}

/** Fill a pregame card that has no scoreboard quote. Live, final, and tipped preview cards stay unchanged. */
export function applyStoredOdds(game: Game, patch: StoredOddsPatch | null | undefined): Game {
  if (!patch?.hasOdds) return game;
  if (game.hasOdds) return game;
  if (game.schedulePreview?.tipPassed) return game;
  const phase = game.scoreboard?.phase;
  if (phase === 'live' || phase === 'final') return game;
  return { ...game, ...patch, homeOdds: patch.homeOdds ?? EMPTY_ODDS, awayOdds: patch.awayOdds ?? EMPTY_ODDS };
}
