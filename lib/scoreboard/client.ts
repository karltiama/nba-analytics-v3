/**
 * Browser reader for GET /api/scoreboard.
 * One shared refresh interval. No provider HTTP from the browser.
 * Sample slates are not loaded here.
 */

import { SCOREBOARD_SCHEMA_VERSION, type ScoreboardResponse } from './contract';

/**
 * Client refresh follows the collector live cadence (about once a minute),
 * not the 15s shared cache on the response.
 */
export const SCOREBOARD_CLIENT_REFRESH_MS = 60_000;

export type ScoreboardFetchOutcome =
  | { status: 'ready'; response: ScoreboardResponse }
  | { status: 'disabled' }
  | { status: 'error'; message: string };

export function scoreboardApiUrl(date: string): string {
  return `/api/scoreboard?date=${encodeURIComponent(date)}`;
}

/** One shared refresh, and only while the collector is still polling a game on this slate. */
export function scoreboardPollDelayMs(
  games: ReadonlyArray<{ polling_state: string }> | null | undefined
): number | null {
  if (!games?.some((game) => game.polling_state === 'active')) return null;
  return SCOREBOARD_CLIENT_REFRESH_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isScoreboardResponse(body: unknown): body is ScoreboardResponse {
  if (!isRecord(body)) return false;
  if (body.schema_version !== SCOREBOARD_SCHEMA_VERSION) return false;
  if (typeof body.date !== 'string' || typeof body.generated_at !== 'string') return false;
  if (typeof body.stale !== 'boolean' || !Array.isArray(body.games)) return false;
  if (!isRecord(body.source)) return false;
  return body.source.provider === 'balldontlie' && body.source.coverage === 'display_only';
}

export function interpretScoreboardPayload(httpStatus: number, body: unknown): ScoreboardFetchOutcome {
  if (httpStatus === 503 && isRecord(body) && body.error === 'scoreboard_unavailable') {
    return { status: 'disabled' };
  }
  if (httpStatus === 200 && isScoreboardResponse(body)) {
    return { status: 'ready', response: body };
  }
  if (httpStatus === 503) {
    return { status: 'error', message: 'Scoreboard is temporarily unavailable.' };
  }
  return { status: 'error', message: 'Could not load the scoreboard.' };
}
