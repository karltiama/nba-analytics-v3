/**
 * Date-level pregame schedule. One due game makes the Eastern date due.
 * The provider call is date-scoped, so the planner does not fetch once per game.
 * Windows are candidates. They are not a production schedule by themselves.
 */

import { SERVING_SEASON_PHASES, etDateOfInstant, servingDateDecision } from './season-eligibility';
import { etCalendarDate, seasonContainingEtDate } from './normal-path';

export const STALE_EVENT_MS = 15 * 60 * 1000;

export type OddsWindowId = 'discovery' | 'six_hour' | 'two_hour' | 't60' | 't15';

export type PlannedGame = {
  gameId: string;
  season: string | null;
  seasonPhase: string | null;
  startTime: string | null;
  latestSnapshotAt: string | null;
};

export type DatePlan = {
  due: boolean;
  windowId: OddsWindowId | null;
  reason: string;
  dueGameIds: string[];
};

const RANK: Record<OddsWindowId, number> = {
  t15: 0,
  t60: 1,
  two_hour: 2,
  six_hour: 3,
  discovery: 4,
};

export function eventIsStale(eventTime: string | undefined, now: Date, staleAfterMs = STALE_EVENT_MS): boolean {
  if (eventTime == null || eventTime === '') return false;
  const ms = Date.parse(eventTime);
  if (!Number.isFinite(ms)) return true;
  return now.getTime() - ms > staleAfterMs;
}

function snapshotAgeMs(snapshotAt: string | null, nowMs: number): number | null {
  if (snapshotAt == null || snapshotAt === '') return null;
  const ms = Date.parse(snapshotAt);
  if (!Number.isFinite(ms)) return null;
  return nowMs - ms;
}

function windowFor(minutesBeforeTip: number): OddsWindowId | 'post_tip' {
  if (minutesBeforeTip <= 0) return 'post_tip';
  if (minutesBeforeTip <= 20) return 't15';
  if (minutesBeforeTip <= 75) return 't60';
  if (minutesBeforeTip <= 360) return 'two_hour';
  if (minutesBeforeTip <= 1440) return 'six_hour';
  return 'discovery';
}

function snapshotInWindow(snapshotAt: string | null, tipMs: number, startBeforeTipMs: number, endBeforeTipMs: number): boolean {
  if (snapshotAt == null) return false;
  const ms = Date.parse(snapshotAt);
  if (!Number.isFinite(ms)) return false;
  return ms >= tipMs - startBeforeTipMs && ms < tipMs - endBeforeTipMs;
}

function gameIsEligible(game: PlannedGame, etDate: string): boolean {
  const phase = game.seasonPhase == null ? '' : game.seasonPhase.trim();
  if (phase !== '' && !SERVING_SEASON_PHASES.has(phase)) return false;
  const tipDate = etDateOfInstant(game.startTime);
  if (tipDate !== etDate) return false;
  const season = game.season ?? seasonContainingEtDate(etDate);
  if (phase === '') {
    return servingDateDecision(season, tipDate).eligible;
  }
  return servingDateDecision(season, etDate).eligible;
}

function gameDecision(game: PlannedGame, etDate: string, nowMs: number): { due: boolean; windowId: OddsWindowId | null; reason: string } {
  const phase = game.seasonPhase == null ? '' : game.seasonPhase.trim();
  if (phase !== '' && !SERVING_SEASON_PHASES.has(phase)) return { due: false, windowId: null, reason: 'not_serving' };
  const tipMs = Date.parse(game.startTime ?? '');
  if (!Number.isFinite(tipMs)) return { due: false, windowId: null, reason: 'unverified_tip' };
  if (!gameIsEligible(game, etDate)) return { due: false, windowId: null, reason: 'not_serving' };
  const minutes = (tipMs - nowMs) / 60_000;
  const windowId = windowFor(minutes);
  if (windowId === 'post_tip') return { due: false, windowId: null, reason: 'post_tip' };
  if (windowId === 't15') {
    const due = !snapshotInWindow(game.latestSnapshotAt, tipMs, 20 * 60_000, 0);
    return { due, windowId, reason: due ? 'due' : 'already_snapshotted' };
  }
  if (windowId === 't60') {
    const due = !snapshotInWindow(game.latestSnapshotAt, tipMs, 75 * 60_000, 20 * 60_000);
    return { due, windowId, reason: due ? 'due' : 'already_snapshotted' };
  }
  const maxAge = windowId === 'two_hour' ? 120 * 60_000 : windowId === 'six_hour' ? 360 * 60_000 : 1440 * 60_000;
  const age = snapshotAgeMs(game.latestSnapshotAt, nowMs);
  const due = age == null || age >= maxAge;
  return { due, windowId, reason: due ? 'due' : 'already_snapshotted' };
}

export function planDate(input: {
  etDate: string;
  now: Date;
  games: readonly PlannedGame[];
  eventTime?: string;
}): DatePlan {
  const today = etCalendarDate(input.now);
  if (eventIsStale(input.eventTime, input.now)) {
    return { due: false, windowId: null, reason: 'stale_event', dueGameIds: [] };
  }
  if (input.etDate < today) {
    return { due: false, windowId: null, reason: 'historical', dueGameIds: [] };
  }
  const decisions = input.games.map((game) => ({ gameId: game.gameId, ...gameDecision(game, input.etDate, input.now.getTime()) }));
  const due = decisions.filter((decision) => decision.due && decision.windowId != null);
  if (due.length === 0) {
    return {
      due: false,
      windowId: null,
      reason: decisions[0]?.reason ?? 'no_eligible_games',
      dueGameIds: [],
    };
  }
  const windowId = due.reduce((best, decision) => (
    RANK[decision.windowId as OddsWindowId] < RANK[best] ? decision.windowId as OddsWindowId : best
  ), due[0].windowId as OddsWindowId);
  return { due: true, windowId, reason: 'due', dueGameIds: due.map((decision) => decision.gameId) };
}
