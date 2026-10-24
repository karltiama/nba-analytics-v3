/**
 * Browser reader for GET /api/scoreboard.
 * One shared refresh interval. No provider HTTP from the browser.
 * Sample slates are not loaded here.
 */

import type { ScoreboardCoverage } from './coverage';
import { SCOREBOARD_SCHEMA_VERSION, type ScoreboardResponse } from './contract';

/**
 * Client refresh follows the collector live cadence (about once a minute),
 * not the 15s shared cache on the response.
 */
export const SCOREBOARD_CLIENT_REFRESH_MS = 60_000;

export type ScoreboardErrorReason = 'store_unavailable' | 'http' | 'network' | 'invalid_payload';

export type ScoreboardFetchOutcome =
  | { status: 'ready'; response: ScoreboardResponse; coverage: ScoreboardCoverage }
  | { status: 'disabled' }
  | { status: 'error'; message: string; reason: ScoreboardErrorReason };

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
  market?: unknown;
};

/**
 * While a card shows a sportsbook quote, re-read at least this often so the quote and its
 * "synced" caption are replaced or dropped well inside the 20-minute fresh window.
 */
export const SCOREBOARD_MARKET_REFRESH_MS = 5 * 60_000;

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
  const delay = wake == null ? null : wake - now.getTime();
  const showsMarket = games.some((game) => !confirmedTerminal(game) && game.lifecycle === 'scheduled' && game.market != null);
  if (showsMarket) return delay == null ? SCOREBOARD_MARKET_REFRESH_MS : Math.min(delay, SCOREBOARD_MARKET_REFRESH_MS);
  return delay;
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

const UNKNOWN_COVERAGE: ScoreboardCoverage = { state: 'unknown', last_games_request_at: null };

/** A missing or unreadable coverage field is an older or partial payload, not a failed scoreboard. */
export function readScoreboardCoverage(body: unknown): ScoreboardCoverage {
  if (!isRecord(body) || !isRecord(body.coverage)) return UNKNOWN_COVERAGE;
  const state = body.coverage.state;
  const at = body.coverage.last_games_request_at;
  if (state !== 'covered' && state !== 'not_collected' && state !== 'unknown') return UNKNOWN_COVERAGE;
  if (at != null && typeof at !== 'string') return UNKNOWN_COVERAGE;
  return { state, last_games_request_at: at ?? null };
}

export function interpretScoreboardPayload(httpStatus: number, body: unknown): ScoreboardFetchOutcome {
  if (httpStatus === 503 && isRecord(body) && body.error === 'scoreboard_unavailable') {
    return { status: 'disabled' };
  }
  if (httpStatus === 200 && isScoreboardResponse(body)) {
    return { status: 'ready', response: body, coverage: readScoreboardCoverage(body) };
  }
  if (httpStatus === 503 && isRecord(body) && body.error === 'scoreboard_store_unavailable') {
    return { status: 'error', message: 'Scoreboard is temporarily unavailable.', reason: 'store_unavailable' };
  }
  if (httpStatus === 503) {
    return { status: 'error', message: 'Scoreboard is temporarily unavailable.', reason: 'http' };
  }
  if (httpStatus === 200) {
    return { status: 'error', message: 'Could not load the scoreboard.', reason: 'invalid_payload' };
  }
  return { status: 'error', message: 'Could not load the scoreboard.', reason: 'http' };
}

export type { ScoreboardCoverage } from './coverage';
