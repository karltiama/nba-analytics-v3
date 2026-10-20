/**
 * Opening-night odds canary limits.
 * The exact {"dates":["2026-10-20"]} event always uses the page cap.
 * ODDS_CANARY_ONLY=1 also rejects every other event. A normal snapshot event keeps the existing writer.
 */

export const ODDS_CANARY_ONLY_ENV = 'ODDS_CANARY_ONLY';
export const OPENING_NIGHT_ODDS_DATE = '2026-10-20';
export const OPENING_NIGHT_ODDS_MAX_PAGES = 3;
export const OPENING_NIGHT_GAME_IDS = ['21717855', '21717856', '21717857'] as const;

const CANARY_EVENT_ERROR = 'odds canary accepts only {"dates":["2026-10-20"]}';

export type OddsInvocation = {
  date?: string;
  dates?: string[];
  time?: string;
};

export function isOddsCanaryOnly(env: Record<string, string | undefined>): boolean {
  return env[ODDS_CANARY_ONLY_ENV] === '1';
}

export function isOpeningNightCanaryEvent(event: OddsInvocation): boolean {
  return event.date == null
    && Array.isArray(event.dates)
    && event.dates.length === 1
    && event.dates[0] === OPENING_NIGHT_ODDS_DATE;
}

/** The only event the thawed canary may fetch. */
export function assertCanaryEvent(event: OddsInvocation): [typeof OPENING_NIGHT_ODDS_DATE] {
  const dates = event.dates;
  if (
    event.date != null
    || !Array.isArray(dates)
    || dates.length !== 1
    || dates[0] !== OPENING_NIGHT_ODDS_DATE
  ) {
    throw new Error(CANARY_EVENT_ERROR);
  }
  return [OPENING_NIGHT_ODDS_DATE];
}

/**
 * Canary pacing shares the scoreboard token bucket.
 * A faster interval or a retry would change that bucket, so the canary refuses the call.
 */
export function assertCanaryLimiter(env: Record<string, string | undefined>): void {
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
    throw new Error(`odds canary limiter refused: ${mismatches.join(', ')}`);
  }
}

export class OddsPageCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OddsPageCapError';
  }
}

/**
 * Called before each provider request.
 * pagesCompleted is how many pages were already received. nextCursor is the cursor for the next page.
 */
export function oddsPageDecision(
  pagesCompleted: number,
  nextCursor: number | null,
  maxPages: number | undefined
): 'continue' | 'stop' | 'cap' {
  if (pagesCompleted === 0) return 'continue';
  if (nextCursor == null) return 'stop';
  if (maxPages != null && pagesCompleted >= maxPages) return 'cap';
  return 'continue';
}

export function assertCanaryGames(gameIds: readonly number[]): void {
  const allowed = new Set<string>(OPENING_NIGHT_GAME_IDS);
  const unexpected = [...new Set(gameIds.map((id) => String(id)))].filter((id) => !allowed.has(id));
  if (unexpected.length > 0) {
    throw new Error(`odds canary rejected unexpected game ids: ${unexpected.join(',')}`);
  }
}
