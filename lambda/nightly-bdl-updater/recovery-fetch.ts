/**
 * Page caps for a recovery invoke. A cursor that is still set after the last
 * allowed page is an incomplete box, not a successful short page.
 */

import { parseBdlMaxRetries } from './bdl-live-rate-limit';
import { providerSeasonTypesForWindow } from './season-eligibility';
import {
  RECOVERY_CANARY_HTTP_ATTEMPT_CEILING,
  RECOVERY_MAX_GAMES_PAGES,
  RECOVERY_MAX_STATS_PAGES,
  RECOVERY_PAGE_SIZE,
  RECOVERY_STATS_BATCH_SIZE,
  recoveryRetryLimit,
  type RecoveryPlan,
} from './recovery-plan';

export class RecoveryFetchError extends Error {
  constructor(
    message: string,
    readonly reason: string
  ) {
    super(message);
    this.name = 'RecoveryFetchError';
  }
}

export type AttemptBudget = {
  attempts: number;
  maxAttempts: number;
};

export function chargeAttempt(budget: AttemptBudget): void {
  if (budget.attempts >= budget.maxAttempts) {
    throw new RecoveryFetchError('Recovery request budget exhausted', 'request_budget');
  }
  budget.attempts += 1;
}

/** Limiter 429 allowance. Invalid values fail closed. This does not raise the limiter. */
export function recoveryRateLimitRetries(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = parseBdlMaxRetries(env.BDL_RATE_LIMIT_MAX_RETRIES);
  if (parsed.error) throw new RecoveryFetchError(parsed.error, 'rate_limit_config');
  return parsed.value;
}

/**
 * Worst-case HTTP calls: each logical fetchWithRetry entry may be repeated by the
 * limiter once per allowed 429. This is an upper bound, not a count of calls made.
 */
export function recoveryHttpAttemptCeiling(logicalMax: number, rateLimitRetries: number): number {
  return logicalMax * (1 + rateLimitRetries);
}

/** Strict canary mode can only lower the ceiling. It never grants more HTTP attempts. */
export function recoveryInvocationHttpCeiling(logicalMax: number, rateLimitRetries: number, strict: boolean): number {
  const full = recoveryHttpAttemptCeiling(logicalMax, rateLimitRetries);
  if (!strict) return full;
  return Math.min(full, RECOVERY_CANARY_HTTP_ATTEMPT_CEILING);
}

export function statsBatches(gameIds: readonly number[], size = RECOVERY_STATS_BATCH_SIZE): number[][] {
  const batches: number[][] = [];
  for (let index = 0; index < gameIds.length; index += size) {
    batches.push(gameIds.slice(index, index + size));
  }
  return batches;
}

export function recoveryGamesUrl(
  baseUrl: string,
  plan: RecoveryPlan,
  seasonType: string,
  cursor: number | null
): string {
  const params = new URLSearchParams({
    start_date: plan.startDate,
    end_date: plan.endDate,
    'seasons[]': String(plan.seasonStartYear),
    season_type: seasonType,
    per_page: String(RECOVERY_PAGE_SIZE),
  });
  if (cursor != null) params.set('cursor', String(cursor));
  return `${baseUrl}/games?${params.toString()}`;
}

export function recoveryStatsUrl(baseUrl: string, gameIds: readonly number[], cursor: number | null): string {
  const params = new URLSearchParams();
  for (const id of gameIds) params.append('game_ids[]', String(id));
  params.set('per_page', String(RECOVERY_PAGE_SIZE));
  if (cursor != null) params.set('cursor', String(cursor));
  return `${baseUrl}/stats?${params.toString()}`;
}

type FetchPage = (
  url: string,
  retries: number,
  onAttempt: () => void,
  onHttpAttempt: (event: { status: number | 'error' }) => void,
  beforeHttpAttempt: () => void
) => Promise<Response>;

async function fetchCursorPages(input: {
  firstUrl: string;
  nextUrl: (cursor: number) => string;
  fetchPage: FetchPage;
  maxPages: number;
  retries: number;
  onAttempt: () => void;
  onHttpAttempt: (event: { status: number | 'error' }) => void;
  beforeHttpAttempt: () => void;
  label: string;
}): Promise<{ rows: unknown[]; pages: number }> {
  const rows: unknown[] = [];
  let url = input.firstUrl;
  const seenCursors = new Set<number>();
  for (let page = 1; page <= input.maxPages; page += 1) {
    const response = await input.fetchPage(
      url,
      input.retries,
      input.onAttempt,
      input.onHttpAttempt,
      input.beforeHttpAttempt
    );
    if (!response.ok) {
      throw new RecoveryFetchError(`${input.label} API returned ${response.status}`, 'http');
    }
    const json = (await response.json()) as { data?: unknown; meta?: { next_cursor?: unknown } };
    if (!Array.isArray(json.data)) {
      throw new RecoveryFetchError(`${input.label} response did not include a page of rows`, 'truncated');
    }
    rows.push(...json.data);
    const next = json.meta?.next_cursor;
    if (next == null) return { rows, pages: page };
    if (typeof next !== 'number' || !Number.isSafeInteger(next) || next <= 0 || seenCursors.has(next)) {
      throw new RecoveryFetchError(`${input.label} pagination cursor is not usable`, 'cursor_repeat');
    }
    if (page === input.maxPages) {
      throw new RecoveryFetchError(`${input.label} page budget exhausted with next_cursor still set`, 'truncated');
    }
    seenCursors.add(next);
    url = input.nextUrl(next);
  }
  throw new RecoveryFetchError(`${input.label} page budget exhausted`, 'truncated');
}

export async function fetchRecoveryGames(input: {
  baseUrl: string;
  plan: RecoveryPlan;
  fetchPage: FetchPage;
  retries: number;
  onAttempt: () => void;
  onHttpAttempt: (event: { status: number | 'error' }) => void;
  beforeHttpAttempt: () => void;
}): Promise<{ games: unknown[]; pages: number; seasonTypes: string[] }> {
  const seasonTypes = providerSeasonTypesForWindow(input.plan.seasonStartYear, input.plan.endDate);
  const games: unknown[] = [];
  let pages = 0;
  for (const seasonType of seasonTypes) {
    const fetched = await fetchCursorPages({
      firstUrl: recoveryGamesUrl(input.baseUrl, input.plan, seasonType, null),
      nextUrl: (cursor) => recoveryGamesUrl(input.baseUrl, input.plan, seasonType, cursor),
      fetchPage: input.fetchPage,
      maxPages: RECOVERY_MAX_GAMES_PAGES,
      retries: input.retries,
      onAttempt: input.onAttempt,
      onHttpAttempt: input.onHttpAttempt,
      beforeHttpAttempt: input.beforeHttpAttempt,
      label: 'Games',
    });
    games.push(...fetched.rows);
    pages += fetched.pages;
  }
  return { games, pages, seasonTypes };
}

export async function fetchRecoveryStats(input: {
  baseUrl: string;
  gameIds: readonly number[];
  fetchPage: FetchPage;
  retries: number;
  onAttempt: () => void;
  onHttpAttempt: (event: { status: number | 'error' }) => void;
  beforeHttpAttempt: () => void;
  sleep: (ms: number) => Promise<void>;
  requestDelayMs: number;
}): Promise<{ lines: unknown[]; pages: number }> {
  const lines: unknown[] = [];
  let pages = 0;
  const batches = statsBatches(input.gameIds);
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const allowed = new Set(batch);
    const fetched = await fetchCursorPages({
      firstUrl: recoveryStatsUrl(input.baseUrl, batch, null),
      nextUrl: (cursor) => recoveryStatsUrl(input.baseUrl, batch, cursor),
      fetchPage: input.fetchPage,
      maxPages: RECOVERY_MAX_STATS_PAGES,
      retries: input.retries,
      onAttempt: input.onAttempt,
      onHttpAttempt: input.onHttpAttempt,
      beforeHttpAttempt: input.beforeHttpAttempt,
      label: 'Stats',
    });
    for (const line of fetched.rows) {
      const gameId = (line as { game?: { id?: unknown } })?.game?.id;
      if (typeof gameId !== 'number' || !allowed.has(gameId)) {
        throw new RecoveryFetchError('Stats page included a game outside the allowlist', 'unexpected_stat_game');
      }
    }
    lines.push(...fetched.rows);
    pages += fetched.pages;
    if (index + 1 < batches.length) await input.sleep(input.requestDelayMs);
  }
  return { lines, pages };
}

export function cappedRecoveryRetries(maxRetries: number): number {
  return recoveryRetryLimit(maxRetries);
}
