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

/**
 * How long before tip the dashboard should already be reading the display snapshot.
 * Matches the collector pre-tip window. This does not change how often the collector calls BDL.
 */
export const SCOREBOARD_REFRESH_LEAD_MS = 15 * 60 * 1000;

export type ScoreboardRefreshGame = {
  polling_state?: string;
  lifecycle?: string;
  scheduled_tip?: string | null;
  stale?: boolean;
};

const IN_PROGRESS = new Set(['live', 'halftime', 'overtime']);

function tipMs(tip: string | null | undefined): number | null {
  if (!tip) return null;
  const parsed = Date.parse(tip);
  return Number.isFinite(parsed) ? parsed : null;
}

function confirmedTerminal(game: ScoreboardRefreshGame): boolean {
  return game.polling_state === 'complete';
}

/** True when this open page should keep reading /api/scoreboard about once a minute. */
export function scoreboardGameNeedsRefresh(game: ScoreboardRefreshGame, now: Date): boolean {
  if (confirmedTerminal(game)) return false;
  if (game.polling_state === 'active' || game.polling_state === 'safety_stopped') return true;
  if (game.lifecycle && IN_PROGRESS.has(game.lifecycle)) return true;
  if (game.stale === true) return true;
  if (game.lifecycle === 'postponed' || game.lifecycle === 'final') return true;
  const tip = tipMs(game.scheduled_tip);
  if (tip == null) return false;
  return now.getTime() >= tip - SCOREBOARD_REFRESH_LEAD_MS;
}

/**
 * One shared delay for the dashboard timer.
 * 60s while a game is soon, live, delayed, or still unconfirmed.
 * Longer only as a single wake-up until the earliest pre-tip window.
 * Null when the slate is empty or every game is confirmed terminal.
 */
export function scoreboardPollDelayMs(
  games: ReadonlyArray<ScoreboardRefreshGame> | null | undefined,
  now: Date = new Date()
): number | null {
  if (!games?.length) return null;
  if (games.some((game) => scoreboardGameNeedsRefresh(game, now))) return SCOREBOARD_CLIENT_REFRESH_MS;
  let wake: number | null = null;
  for (const game of games) {
    if (confirmedTerminal(game)) continue;
    const tip = tipMs(game.scheduled_tip);
    if (tip == null) continue;
    const at = tip - SCOREBOARD_REFRESH_LEAD_MS;
    if (at > now.getTime() && (wake == null || at < wake)) wake = at;
  }
  return wake == null ? null : wake - now.getTime();
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
