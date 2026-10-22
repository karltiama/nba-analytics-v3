/**
 * Bounds for the scheduled odds snapshot.
 * The opening-night canary keeps its own gate in canary-limits.ts.
 * This module does not authorize a date, a game, or a provider call by itself.
 */

import {
  etDateOfInstant,
  REGULAR_SEASON_OPEN_ET,
  SERVING_SEASON_PHASES,
  servingDateDecision,
} from './season-eligibility';

export const NORMAL_MAX_PAGES_PER_DATE = 3;

/**
 * Today and tomorrow, each allowed to use the per-date cap.
 * Three pages for the whole invocation is not enough: /v2/odds asks for 100 rows,
 * and two dates that each need two pages would stop on the second date.
 */
export const SCHEDULED_INVOCATION_MAX_PAGES = NORMAL_MAX_PAGES_PER_DATE * 2;

/**
 * Odds-only provider-attempt ceiling for one America/New_York day.
 * request-budget.ts enforces it. The 13-second limiter is not this budget.
 */
export const DAILY_ODDS_REQUEST_CEILING = 60;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export type DatedOddsEvent = {
  date?: string;
  dates?: string[];
};

export type StoredOddsGame = {
  gameId: string;
  season: string | null;
  seasonPhase: string | null;
  startTime: string | null;
};

export function etCalendarDate(now: Date): string {
  return ET_DATE.format(now);
}

export function addCalendarDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map((part) => Number(part));
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Today and tomorrow as America/New_York calendar dates. */
export function scheduledDates(now: Date): [string, string] {
  const today = etCalendarDate(now);
  return [today, addCalendarDays(today, 1)];
}

/**
 * Latest regular-season start-year whose opening night is on or before this Eastern date.
 * 2026-10-20 is season 2026. 2026-10-19 is still season 2025. Unknown dates fail closed.
 */
export function seasonContainingEtDate(ymd: string): string | null {
  if (!YMD.test(ymd)) return null;
  let found: string | null = null;
  for (const [season, open] of Object.entries(REGULAR_SEASON_OPEN_ET)) {
    if (ymd >= open && (found == null || open >= REGULAR_SEASON_OPEN_ET[found])) found = season;
  }
  return found;
}

export function assertNormalLiveLimiter(env: Record<string, string | undefined>): void {
  const expected: Record<string, string> = {
    BDL_RATE_LIMIT_INTERVAL_MS: '13000',
    BDL_RATE_LIMIT_MAX_REQUESTS: '1',
    BDL_RATE_LIMIT_BURST: '1',
    BDL_RATE_LIMIT_MAX_RETRIES: '0',
  };
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => env[key] !== value)
    .map(([key]) => key);
  if (mismatches.length > 0) {
    throw new Error(`odds normal limiter refused: ${mismatches.join(', ')}`);
  }
}

export type NormalDateSelection =
  | { ok: true; dates: string[] }
  | { ok: false; reason: string };

/** Empty or missing dates means the scheduled today/tomorrow pair. Anything else must be inside that pair. */
export function selectNormalDates(event: DatedOddsEvent, now: Date): NormalDateSelection {
  const allowed = scheduledDates(now);
  const hasDates = Array.isArray(event.dates) && event.dates.length > 0;
  if (event.date == null && !hasDates) return { ok: true, dates: [...allowed] };

  const requested = hasDates ? event.dates! : [event.date as string];
  if (requested.length > allowed.length) {
    return { ok: false, reason: 'odds normal path accepts only today and tomorrow' };
  }
  const seen = new Set<string>();
  for (const date of requested) {
    if (!YMD.test(date)) return { ok: false, reason: `invalid odds date ${date}` };
    if (seen.has(date)) return { ok: false, reason: `duplicate odds date ${date}` };
    if (!allowed.includes(date)) return { ok: false, reason: `odds date ${date} is outside today and tomorrow` };
    seen.add(date);
  }
  return { ok: true, dates: requested };
}

export function pageBudgetForDate(perDateLimit: number, remainingInvocationPages: number): number {
  if (!Number.isInteger(perDateLimit) || perDateLimit < 1) return 0;
  if (!Number.isInteger(remainingInvocationPages) || remainingInvocationPages < 1) return 0;
  return Math.min(perDateLimit, remainingInvocationPages);
}

export function isProviderTimeout(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { name?: string; code?: string; timeout?: boolean; message?: string };
  if (candidate.timeout === true) return true;
  if (candidate.name === 'AbortError' || candidate.name === 'TimeoutError') return true;
  if (candidate.code === 'timeout' && !/429/.test(candidate.message ?? '')) return true;
  return /timeout|deadline/i.test(candidate.message ?? '') && !/429/.test(candidate.message ?? '');
}

export function parseOddsNumber(val: string | null | undefined): number | null {
  if (val == null || val === '') return null;
  const parsed = Number.parseFloat(val);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A missing or older observation must not replace the current row. Equal timestamps are already stored. */
export function shouldReplaceCurrent(
  existingSnapshotAt: string | Date | null,
  incomingSnapshotAt: string
): boolean {
  const incomingMs = Date.parse(incomingSnapshotAt);
  if (!Number.isFinite(incomingMs)) return false;
  if (existingSnapshotAt == null) return true;
  const existingMs = existingSnapshotAt instanceof Date
    ? existingSnapshotAt.getTime()
    : Date.parse(existingSnapshotAt);
  if (!Number.isFinite(existingMs)) return true;
  return incomingMs > existingMs;
}

/**
 * fetchBdlLive throws on a finished 429 instead of returning the response.
 * That throw is one attempt when retries are 0. It is not a transport timeout.
 */
export function providerThrowToPage(
  err: unknown
): { ok: false; status: 429 } | { timeout: true; message: string } | null {
  const message = err instanceof Error ? err.message : '';
  if (/429/.test(message)) return { ok: false, status: 429 };
  if (isProviderTimeout(err)) return { timeout: true, message: message || 'odds provider timeout' };
  return null;
}

export function httpFailure(status: number): 'UNAUTHORIZED' | 'FORBIDDEN' | 'RATE_LIMITED' | 'PROVIDER_ERROR' {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 429) return 'RATE_LIMITED';
  return 'PROVIDER_ERROR';
}

export function assessOddsGames(input: {
  queriedDate: string;
  rows: readonly { game_id: number; vendor: string; updated_at?: string | null }[];
  games: readonly StoredOddsGame[];
}): { ok: true } | { ok: false; reason: string } {
  const seen = new Set<string>();
  for (const row of input.rows) {
    const key = `${row.game_id}:${row.vendor}`;
    if (seen.has(key)) return { ok: false, reason: `duplicate game vendor ${key}` };
    seen.add(key);
    if (row.updated_at == null || row.updated_at === '') {
      return { ok: false, reason: `missing observation time for ${row.game_id}` };
    }
  }

  const expectedSeason = seasonContainingEtDate(input.queriedDate);
  if (!expectedSeason) return { ok: false, reason: 'season_open_unknown' };
  const byId = new Map(input.games.map((game) => [game.gameId, game]));
  for (const row of input.rows) {
    const game = byId.get(String(row.game_id));
    if (!game) return { ok: false, reason: `unknown game ${row.game_id}` };
    if (game.season !== expectedSeason) return { ok: false, reason: `season ${game.season ?? 'null'}` };
    const phase = game.seasonPhase == null ? '' : game.seasonPhase.trim();
    if (phase !== '' && !SERVING_SEASON_PHASES.has(phase)) {
      return { ok: false, reason: `phase ${phase}` };
    }
    const tipDate = etDateOfInstant(game.startTime);
    if (tipDate !== input.queriedDate) return { ok: false, reason: `tip date ${tipDate ?? 'null'}` };
    if (phase === '') {
      const fence = servingDateDecision(game.season, tipDate);
      if (!fence.eligible) return { ok: false, reason: fence.reason };
    }
  }
  return { ok: true };
}

export type DateClassification =
  | 'COMPLETE'
  | 'PROVIDER_EMPTY'
  | 'INCOMPLETE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'IDENTITY'
  | 'RAW_PERSISTENCE'
  | 'HISTORY_PERSISTENCE'
  | 'CURRENT_PERSISTENCE'
  | 'MOVEMENT_PERSISTENCE'
  | 'BUDGET_EXHAUSTED'
  | 'BUDGET_UNAVAILABLE'
  | 'CLAIM_UNAVAILABLE'
  | 'SKIPPED'
  | 'STALE';

const HARD_FAILURE: ReadonlySet<DateClassification> = new Set([
  'UNAUTHORIZED',
  'FORBIDDEN',
  'RATE_LIMITED',
  'TIMEOUT',
  'PROVIDER_ERROR',
  'IDENTITY',
  'RAW_PERSISTENCE',
  'HISTORY_PERSISTENCE',
  'CURRENT_PERSISTENCE',
  'MOVEMENT_PERSISTENCE',
  'BUDGET_EXHAUSTED',
  'BUDGET_UNAVAILABLE',
  'CLAIM_UNAVAILABLE',
]);

export function summarizeClassifications(classifications: readonly DateClassification[]): {
  success: boolean;
  status: 'COMPLETE' | 'PROVIDER_EMPTY' | 'INCOMPLETE' | 'PARTIAL' | 'FAILED' | 'SKIPPED' | 'NO_DUE_WORK' | 'STALE' | 'BUDGET_EXHAUSTED' | 'BUDGET_UNAVAILABLE' | 'CLAIM_UNAVAILABLE';
} {
  if (classifications.length === 0) return { success: false, status: 'FAILED' };
  const work = classifications.filter((item) => item !== 'SKIPPED' && item !== 'STALE');
  if (work.length === 0) {
    return classifications.every((item) => item === 'STALE')
      ? { success: false, status: 'STALE' }
      : { success: false, status: 'SKIPPED' };
  }
  if (work.every((item) => item === 'BUDGET_EXHAUSTED')) return { success: false, status: 'BUDGET_EXHAUSTED' };
  if (work.every((item) => item === 'BUDGET_UNAVAILABLE')) return { success: false, status: 'BUDGET_UNAVAILABLE' };
  if (work.every((item) => item === 'CLAIM_UNAVAILABLE')) return { success: false, status: 'CLAIM_UNAVAILABLE' };
  classifications = work;
  const incomplete = classifications.some((item) => item === 'INCOMPLETE');
  const failed = classifications.some((item) => HARD_FAILURE.has(item));
  const complete = classifications.some((item) => item === 'COMPLETE');
  const onlyEmpty = classifications.every((item) => item === 'PROVIDER_EMPTY');
  const publishable = classifications.every((item) => item === 'COMPLETE' || item === 'PROVIDER_EMPTY');
  if (onlyEmpty) return { success: true, status: 'PROVIDER_EMPTY' };
  if (publishable) return { success: true, status: 'COMPLETE' };
  if ((incomplete || failed) && complete) return { success: false, status: 'PARTIAL' };
  if (incomplete && !failed) return { success: false, status: 'INCOMPLETE' };
  return { success: false, status: 'FAILED' };
}
