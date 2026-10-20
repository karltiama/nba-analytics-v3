/**
 * Dashboard read of one stored DraftKings row in analytics.game_odds_current.
 * The scoreboard payload is a different store and is left unchanged.
 *
 * fresh means the current row was written recently. It is not a live quote,
 * not a sportsbook handoff, and not proof that DraftKings has verified the price.
 * storedAt is updated_at, the last database write. snapshotAt is the pipeline
 * snapshot clock (provider time when the writer had one, otherwise transform time).
 * providerUpdatedAt stays null: this table does not keep a separate provider clock.
 */

import type { Game } from '@/components/betting/GameCard';
import { twoWayMarketDisplay } from '@/lib/betting/market-probability';
import { checkMarkets } from '@/lib/scoreboard/market';
import type { StoredOddsQuote } from '@/lib/scoreboard/contract';

export const STORED_ODDS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A recently written row. Not a provider refresh interval. */
export const STORED_ODDS_FRESH_MS = 45 * 60 * 1000;

/** Clocks this far ahead of the read are invalid. */
export const STORED_ODDS_FUTURE_SKEW_MS = 2 * 60 * 1000;

export const STORED_ODDS_CACHE_CONTROL = 'no-store';

export const STORED_ODDS_FRESH_MARK = 'Recently saved';

export const STORED_ODDS_SQL = `
SELECT
  c.game_id::text AS game_id,
  c.vendor,
  c.snapshot_at,
  c.updated_at,
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
  updated_at: string | Date | null;
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

export type StoredOddsStatus = 'fresh' | 'stale';

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
  | 'oddsFreshness'
> & {
  status: StoredOddsStatus;
  storedAt: string;
  snapshotAt: string;
  providerUpdatedAt: null;
  incomplete: boolean;
};

export type StoredOddsClassification =
  | { outcome: 'quote'; patch: StoredOddsPatch }
  | { outcome: 'withheld' }
  | { outcome: 'unavailable' };

const EMPTY_ODDS = { moneyline: null, spread: null, spreadOdds: null };
const FALSE_FRESHNESS_CLAIM = /live|synced|provider updated|guaranteed/i;

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
export function formatStoredEt(value: string | Date): string {
  const ms = instantMs(value);
  if (ms == null) return '';
  const parts = etParts(ms);
  if (!parts.hour || !parts.minute || (parts.dayPeriod !== 'AM' && parts.dayPeriod !== 'PM')) return '';
  return `${parts.hour}:${parts.minute} ${parts.dayPeriod} ET`;
}

function storedWhen(storedAt: string, now: Date, alwaysDate: boolean): string {
  const storedMs = instantMs(storedAt);
  if (storedMs == null) return '';
  const clock = formatStoredEt(storedAt);
  if (!clock) return '';
  const stored = etParts(storedMs);
  const current = etParts(now.getTime());
  const sameDay = stored.year === current.year && stored.month === current.month && stored.day === current.day;
  if (!alwaysDate && sameDay) return clock;
  return `${stored.month} ${stored.day}, ${clock}`;
}

/**
 * Fresh captions name the write time and say the row was recently saved.
 * Stale captions always include the Eastern date and the word Stale.
 */
export function storedOddsCaption(status: StoredOddsStatus, storedAt: string, now: Date): string {
  const when = storedWhen(storedAt, now, status === 'stale');
  if (!when) return '';
  if (status === 'stale') return `DraftKings · Stale · stored ${when}`;
  return `DraftKings · stored ${when} · ${STORED_ODDS_FRESH_MARK}`;
}

export function isStoredOddsCaption(caption: string, status?: StoredOddsStatus): boolean {
  if (!caption || FALSE_FRESHNESS_CLAIM.test(caption)) return false;
  if (status === 'stale') return caption.startsWith('DraftKings · Stale · stored ');
  if (status === 'fresh') {
    return caption.startsWith('DraftKings · stored ') && caption.endsWith(` · ${STORED_ODDS_FRESH_MARK}`);
  }
  return (
    (caption.startsWith('DraftKings · stored ') && caption.endsWith(` · ${STORED_ODDS_FRESH_MARK}`)) ||
    caption.startsWith('DraftKings · Stale · stored ')
  );
}

/** Code only. Query text and connection strings stay out of the log. */
export function storedOddsFailureLog(err: unknown): { code: string } {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code)) return { code };
  }
  return { code: 'unknown' };
}

function clockStatus(storedMs: number | null, snapshotMs: number | null, nowMs: number): StoredOddsStatus | 'unknown' {
  if (storedMs == null || snapshotMs == null) return 'unknown';
  if (storedMs > nowMs + STORED_ODDS_FUTURE_SKEW_MS) return 'unknown';
  if (snapshotMs > nowMs + STORED_ODDS_FUTURE_SKEW_MS) return 'unknown';
  const age = Math.max(0, nowMs - storedMs);
  return age <= STORED_ODDS_FRESH_MS ? 'fresh' : 'stale';
}

/** A pregame card may receive a stored quote. Live, final, and tipped preview cards may not. */
export function acceptsStoredOdds(game: Pick<Game, 'schedulePreview' | 'scoreboard'>): boolean {
  if (game.schedulePreview?.tipPassed) return false;
  const phase = game.scoreboard?.phase;
  return phase !== 'live' && phase !== 'final';
}

export function classifyStoredOddsRow(row: StoredOddsSourceRow, now: Date): StoredOddsClassification {
  if ((row.vendor ?? '').trim().toLowerCase() !== 'draftkings') return { outcome: 'unavailable' };
  const gameId = String(row.game_id ?? '').trim();
  if (!gameId) return { outcome: 'unavailable' };
  const nowMs = now.getTime();
  const status = clockStatus(instantMs(row.updated_at), instantMs(row.snapshot_at), nowMs);
  if (status === 'unknown') return { outcome: 'withheld' };
  const storedMs = instantMs(row.updated_at)!;
  const snapshotMs = instantMs(row.snapshot_at)!;
  const storedAt = new Date(storedMs).toISOString();
  const snapshotAt = new Date(snapshotMs).toISOString();
  const caption = storedOddsCaption(status, storedAt, now);
  if (!isStoredOddsCaption(caption, status)) return { outcome: 'withheld' };
  const quote: StoredOddsQuote = {
    gameId,
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
    providerUpdatedAt: null,
    vendorSyncedAt: null,
    openedAt: null,
    firstObservedAt: storedAt,
    observedAt: storedAt,
    requestId: '',
    withdrawnAt: null,
    withdrawnRequestId: null,
  };
  const checked = checkMarkets(quote);
  if (!checked.moneyline && !checked.spread && !checked.total) return { outcome: 'unavailable' };
  const display = checked.moneyline ? twoWayMarketDisplay(checked.moneyline.away, checked.moneyline.home) : null;
  const incomplete = !(
    checked.moneyline &&
    checked.spread &&
    checked.spread.home_odds != null &&
    checked.spread.away_odds != null &&
    checked.total &&
    checked.total.over_odds != null &&
    checked.total.under_odds != null
  );
  return {
    outcome: 'quote',
    patch: {
      status,
      storedAt,
      snapshotAt,
      providerUpdatedAt: null,
      incomplete,
      oddsFreshness: status,
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
    },
  };
}

/** Quote patch only. Withheld and unavailable rows return null. */
export function draftKingsPatch(row: StoredOddsSourceRow, now: Date): StoredOddsPatch | null {
  const result = classifyStoredOddsRow(row, now);
  return result.outcome === 'quote' ? result.patch : null;
}

export function collectStoredOdds(
  rows: readonly StoredOddsSourceRow[],
  now: Date
): { odds: Record<string, StoredOddsPatch>; withheld: Record<string, 'unknown'> } {
  const odds: Record<string, StoredOddsPatch> = {};
  const withheld: Record<string, 'unknown'> = {};
  for (const row of rows) {
    const id = String(row.game_id ?? '').trim();
    const result = classifyStoredOddsRow(row, now);
    if (!id) continue;
    if (result.outcome === 'quote') {
      delete withheld[id];
      odds[id] = result.patch;
    } else if (result.outcome === 'withheld') {
      delete odds[id];
      withheld[id] = 'unknown';
    } else {
      delete odds[id];
      delete withheld[id];
    }
  }
  return { odds, withheld };
}

export function storedOddsResponseBody(
  asOf: Date,
  collected: { odds: Record<string, StoredOddsPatch>; withheld: Record<string, 'unknown'> }
): { asOf: string; odds: Record<string, StoredOddsPatch>; withheld: Record<string, 'unknown'> } {
  return { asOf: asOf.toISOString(), odds: collected.odds, withheld: collected.withheld };
}

function isStoredOddsPatch(value: unknown): value is StoredOddsPatch {
  if (!value || typeof value !== 'object') return false;
  const row = value as StoredOddsPatch;
  if (row.status !== 'fresh' && row.status !== 'stale') return false;
  if (row.oddsFreshness !== row.status) return false;
  if (row.providerUpdatedAt !== null) return false;
  if (typeof row.incomplete !== 'boolean') return false;
  if (typeof row.storedAt !== 'string' || instantMs(row.storedAt) == null) return false;
  if (typeof row.snapshotAt !== 'string' || instantMs(row.snapshotAt) == null) return false;
  if (typeof row.marketCaption !== 'string' || !isStoredOddsCaption(row.marketCaption, row.status)) return false;
  if (row.hasOdds !== true) return false;
  if (!row.homeOdds || typeof row.homeOdds !== 'object' || !row.awayOdds || typeof row.awayOdds !== 'object') return false;
  return true;
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

/** Non-OK HTTP responses clear the overlay. The refresh session clears genuine network failures separately. */
export function storedOddsMapFromResponse(ok: boolean, body: unknown): Record<string, StoredOddsPatch> {
  if (!ok) return {};
  return parseStoredOddsPayload(body);
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
  if (!acceptsStoredOdds(game)) return game;
  const { status, ...card } = patch;
  void status;
  return { ...game, ...card, homeOdds: card.homeOdds ?? EMPTY_ODDS, awayOdds: card.awayOdds ?? EMPTY_ODDS };
}
