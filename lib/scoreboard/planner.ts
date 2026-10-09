/**
 * Time-aware scoreboard polling plan. Pure: decides which BDL requests one tick may make.
 *
 * One /v1/games request (per enabled season type) covers every game in the ET window; one
 * /v1/box_scores/live request covers every live game. The scheduler ticks every minute, and most
 * ticks make no request.
 *
 * Polling never stops at a fixed time after tip. A game stops only when:
 *   - a terminal lifecycle (final / postponed / canceled) is confirmed by two observations, or
 *   - the stale safeguard fires: nothing about the game changed for SAFETY_NO_CHANGE_MS, or
 *   - the absolute ceiling fires: ABSOLUTE_CEILING_MS after scheduled tip.
 * Delays, halftime and overtime keep producing changes, so they keep the game active; the cadence
 * only backs off while a game is quiet.
 */

import { shiftEtYmd, etYmd } from '@/lib/games/status-sync-query';
import type { ScoreboardPollingState, StoredScoreboardGame } from './contract';
import { IN_GAME, isTerminalLifecycle } from './normalize';

export const SCOREBOARD_POLICY = {
  /** Games request cadence when no game is in its window (schedule discovery). */
  DISCOVERY_INTERVAL_MS: 3 * 60 * 60 * 1000,
  /** A game enters its polling window this long before scheduled tip. */
  PRE_TIP_WINDOW_MS: 15 * 60 * 1000,
  /** Cadence while a game is in progress and changing. */
  LIVE_INTERVAL_MS: 60 * 1000,
  /** No change for this long while live (timeouts, halftime, reviews) → back off. */
  QUIET_AFTER_MS: 10 * 60 * 1000,
  QUIET_INTERVAL_MS: 2 * 60 * 1000,
  /** No change for this long → slow cadence; the API marks the game stale. */
  STALE_AFTER_MS: 30 * 60 * 1000,
  STALE_INTERVAL_MS: 5 * 60 * 1000,
  /** Scheduled game past tip with no start yet (delay): poll every 2 minutes. */
  DELAYED_INTERVAL_MS: 2 * 60 * 1000,
  /** Bounded safeguards. */
  SAFETY_NO_CHANGE_MS: 6 * 60 * 60 * 1000,
  ABSOLUTE_CEILING_MS: 16 * 60 * 60 * 1000,
  /** Terminal state must be seen this many times before polling stops. */
  TERMINAL_CONFIRMATIONS: 2,
  /** Live box-score attempts after final, to capture final player lines. */
  MAX_FINAL_BOX_ATTEMPTS: 3,
} as const;

export type ScoreboardTickPlan = {
  gamesRequest: { startDate: string; endDate: string; reason: string } | null;
  boxRequest: { reason: string } | null;
  reason: string;
};

const tipMs = (g: StoredScoreboardGame): number | null => {
  const t = g.scheduledTip ? Date.parse(g.scheduledTip) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** Time since the game last changed, counted from no earlier than scheduled tip. */
function quietMs(g: StoredScoreboardGame, t: number): number {
  const tip = tipMs(g);
  return t - Math.max(Date.parse(g.lastChangedAt), tip ?? -Infinity);
}

/** Next polling state for a game after its latest observation. Terminal states are sticky. */
export function nextPollingState(g: StoredScoreboardGame, now: Date): ScoreboardPollingState {
  if (g.pollingState === 'complete' || g.pollingState === 'safety_stopped') return g.pollingState;
  const t = now.getTime();
  if (isTerminalLifecycle(g.lifecycle) && g.terminalConfirmations >= SCOREBOARD_POLICY.TERMINAL_CONFIRMATIONS) {
    const boxDone =
      g.lifecycle !== 'final' ||
      g.boxCompleteness === 'verified_final' ||
      g.finalBoxAttempts >= SCOREBOARD_POLICY.MAX_FINAL_BOX_ATTEMPTS;
    if (boxDone) return 'complete';
  }
  const tip = tipMs(g);
  const sinceChange = quietMs(g, t);
  const startedOrDue = IN_GAME.has(g.lifecycle) || (tip != null && t >= tip - SCOREBOARD_POLICY.PRE_TIP_WINDOW_MS);
  if (startedOrDue) {
    if (sinceChange >= SCOREBOARD_POLICY.SAFETY_NO_CHANGE_MS) return 'safety_stopped';
    if (tip != null && t - tip >= SCOREBOARD_POLICY.ABSOLUTE_CEILING_MS) return 'safety_stopped';
    return 'active';
  }
  if (tip == null && !isTerminalLifecycle(g.lifecycle)) {
    // No usable tip time: treat as active so it is observed, with the same safeguards.
    return sinceChange >= SCOREBOARD_POLICY.SAFETY_NO_CHANGE_MS ? 'safety_stopped' : 'active';
  }
  return isTerminalLifecycle(g.lifecycle) ? 'active' : 'pending';
}

/** How often an active game wants a fresh /games observation. */
export function activeCadenceMs(g: StoredScoreboardGame, now: Date): number {
  const t = now.getTime();
  const sinceChange = quietMs(g, t);
  if (isTerminalLifecycle(g.lifecycle)) return SCOREBOARD_POLICY.LIVE_INTERVAL_MS;
  if (IN_GAME.has(g.lifecycle) || g.lifecycle === 'unknown') {
    if (sinceChange >= SCOREBOARD_POLICY.STALE_AFTER_MS) return SCOREBOARD_POLICY.STALE_INTERVAL_MS;
    if (sinceChange >= SCOREBOARD_POLICY.QUIET_AFTER_MS) return SCOREBOARD_POLICY.QUIET_INTERVAL_MS;
    return SCOREBOARD_POLICY.LIVE_INTERVAL_MS;
  }
  const tip = tipMs(g);
  if (tip != null && t >= tip) {
    return sinceChange >= SCOREBOARD_POLICY.STALE_AFTER_MS
      ? SCOREBOARD_POLICY.STALE_INTERVAL_MS
      : SCOREBOARD_POLICY.DELAYED_INTERVAL_MS;
  }
  return SCOREBOARD_POLICY.LIVE_INTERVAL_MS;
}

export function needsLiveBox(g: StoredScoreboardGame): boolean {
  if (g.pollingState !== 'active') return false;
  if (IN_GAME.has(g.lifecycle)) return true;
  return (
    g.lifecycle === 'final' &&
    g.boxCompleteness !== 'verified_final' &&
    g.finalBoxAttempts < SCOREBOARD_POLICY.MAX_FINAL_BOX_ATTEMPTS
  );
}

/**
 * Decide this tick's requests from stored state only (no provider call to decide).
 * `games` are the stored rows for the season type; `lastGamesRequestAt` is the last /games request
 * for that season type, whether or not it returned games.
 */
export function planScoreboardTick(input: {
  now: Date;
  games: StoredScoreboardGame[];
  lastGamesRequestAt: string | null;
}): ScoreboardTickPlan {
  const { now } = input;
  const t = now.getTime();
  const today = etYmd(now);
  const tomorrow = shiftEtYmd(today, 1);
  const states = input.games.map((g) => ({ g, state: nextPollingState(g, now) }));
  const active = states.filter((s) => s.state === 'active').map((s) => s.g);

  const lastGames = input.lastGamesRequestAt ? Date.parse(input.lastGamesRequestAt) : null;
  const sinceGames = lastGames == null ? Infinity : t - lastGames;

  // Upcoming pending games whose window has opened since the last observation.
  const windowOpened = states.some(({ g, state }) => {
    const tip = tipMs(g);
    return state === 'pending' && tip != null && t >= tip - SCOREBOARD_POLICY.PRE_TIP_WINDOW_MS;
  });

  let gamesReason: string | null = null;
  if (lastGames == null) gamesReason = 'first_discovery';
  else if (active.some((g) => sinceGames >= activeCadenceMs(g, now))) gamesReason = 'active_game_due';
  else if (windowOpened) gamesReason = 'tip_window_opened';
  else if (active.length === 0 && sinceGames >= SCOREBOARD_POLICY.DISCOVERY_INTERVAL_MS) gamesReason = 'discovery_due';

  // Keep yesterday in the window while any of its games is still active (late tips cross midnight ET).
  const startDate = active.some((g) => g.etDate < today) ? shiftEtYmd(today, -1) : today;
  const gamesRequest = gamesReason ? { startDate, endDate: tomorrow, reason: gamesReason } : null;

  const boxDue = active.some((g) => needsLiveBox({ ...g, pollingState: 'active' }));
  // The box request only follows a games request, so player lines always pair with a fresh game state.
  const boxRequest = gamesRequest && boxDue ? { reason: 'game_in_progress_or_final_box_pending' } : null;

  const reason = gamesRequest
    ? gamesRequest.reason
    : active.length > 0
      ? 'active_games_not_due'
      : input.games.length === 0
        ? 'no_games_discovery_not_due'
        : 'no_active_games';
  return { gamesRequest, boxRequest, reason };
}
