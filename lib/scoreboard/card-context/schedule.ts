/**
 * Rest and back-to-back copy for one pregame card.
 * Pure: no database, no clock except the ET dates the caller already resolved.
 *
 * A rest or back-to-back claim needs one verified previous Final regular-season or IST game.
 * Preseason is ignored. Anything else on a more recent date blocks the claim.
 */

import { REGULAR_SEASON_OPEN_ET } from '@/lib/games/season-eligibility';
import { shiftEtYmd } from '@/lib/games/status-sync-query';

export const SCHEDULE_UNAVAILABLE_TEXT = 'Schedule context unavailable.';

const COUNTED_PHASES = new Set(['REGULAR', 'IST']);
/** A missing prior row is a season opener only this many ET days after opening night, inclusive. */
export const OPENER_WINDOW_ET_DAYS = 7;

function withinOpenerWindow(gameEtDate: string, season: string): boolean {
  const open = REGULAR_SEASON_OPEN_ET[season];
  if (!open) return false;
  const days = etDayDiff(gameEtDate, open);
  return days != null && days >= 0 && days <= OPENER_WINDOW_ET_DAYS;
}

export type ScheduleGameRow = {
  etDate: string;
  seasonPhase: string | null;
  status: string | null;
  homeTeamId: string;
  awayTeamId: string;
};

export type ScheduleLine = {
  status: 'ready' | 'unavailable';
  text: string;
};

type TeamFact =
  | { kind: 'unavailable' }
  | { kind: 'opener' }
  | { kind: 'rest'; daysRest: number; thirdInFour: boolean };

/** Calendar date in America/New_York. Late West Coast tips land on the next ET date. */
export function etDateFromInstant(instant: Date): string | null {
  if (Number.isNaN(instant.getTime())) return null;
  const ymd = instant.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

/** Whole ET calendar days from earlier to later. Anchored at 17:00 UTC so DST does not change the count. */
export function etDayDiff(later: string, earlier: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(later) || !/^\d{4}-\d{2}-\d{2}$/.test(earlier)) return null;
  const start = Date.parse(`${earlier}T17:00:00.000Z`);
  const end = Date.parse(`${later}T17:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 86_400_000);
}

function isPreseason(phase: string | null): boolean {
  return (phase ?? '').trim().toUpperCase() === 'PRESEASON';
}

function countedPhase(phase: string | null): boolean {
  return COUNTED_PHASES.has((phase ?? '').trim().toUpperCase());
}

export function deriveTeamSchedule(input: {
  teamId: string;
  gameEtDate: string;
  /** Season start year, used only to decide whether an empty history is opening week. */
  season: string;
  /** null: this game was not uniquely matched, or the prior-game read failed. */
  games: ScheduleGameRow[] | null;
}): TeamFact {
  if (input.games == null) return { kind: 'unavailable' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.gameEtDate)) return { kind: 'unavailable' };

  const earlier: ScheduleGameRow[] = [];
  for (const game of input.games) {
    if (game.homeTeamId !== input.teamId && game.awayTeamId !== input.teamId) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(game.etDate)) return { kind: 'unavailable' };
    if (game.etDate >= input.gameEtDate) continue;
    if (isPreseason(game.seasonPhase)) continue;
    earlier.push(game);
  }
  if (earlier.length === 0) {
    return withinOpenerWindow(input.gameEtDate, input.season) ? { kind: 'opener' } : { kind: 'unavailable' };
  }

  let latest = earlier[0].etDate;
  for (const game of earlier) {
    if (game.etDate > latest) latest = game.etDate;
  }
  const onLatest = earlier.filter((game) => game.etDate === latest);
  if (onLatest.length !== 1) return { kind: 'unavailable' };
  const last = onLatest[0];
  if (last.status !== 'Final' || !countedPhase(last.seasonPhase)) return { kind: 'unavailable' };

  const days = etDayDiff(input.gameEtDate, last.etDate);
  if (days == null || days < 1) return { kind: 'unavailable' };

  let windowStart: string;
  try {
    windowStart = shiftEtYmd(input.gameEtDate, -3);
  } catch {
    return { kind: 'unavailable' };
  }
  const inWindow = earlier.filter((game) => game.etDate >= windowStart);
  const countable = inWindow.filter((game) => game.status === 'Final' && countedPhase(game.seasonPhase));
  const thirdInFour = inWindow.length === countable.length && countable.length === 2;
  return { kind: 'rest', daysRest: days - 1, thirdInFour };
}

function teamPhrase(abbr: string, fact: TeamFact): string {
  if (fact.kind === 'unavailable') return `${abbr}: rest unavailable`;
  if (fact.kind === 'opener') return `${abbr}: season opener`;
  if (fact.thirdInFour) return `${abbr}: 3rd game in 4 nights`;
  if (fact.daysRest === 0) return `${abbr} on 2nd night of a back-to-back`;
  const unit = fact.daysRest === 1 ? 'day' : 'days';
  return `${abbr} ${fact.daysRest} ${unit} rest`;
}

function sharedPhrase(away: TeamFact, home: TeamFact): string | null {
  if (away.kind === 'opener' && home.kind === 'opener') return 'Both teams: season openers';
  if (away.kind !== 'rest' || home.kind !== 'rest') return null;
  if (away.thirdInFour && home.thirdInFour && away.daysRest === home.daysRest) {
    return 'Both teams: 3rd game in 4 nights';
  }
  if (away.thirdInFour || home.thirdInFour) return null;
  if (away.daysRest === 0 && home.daysRest === 0) return 'Both teams on the 2nd night of a back-to-back';
  if (away.daysRest >= 1 && away.daysRest === home.daysRest) {
    const unit = away.daysRest === 1 ? 'day' : 'days';
    return `Both teams on ${away.daysRest} ${unit} rest`;
  }
  return null;
}

export function buildScheduleLine(input: {
  gameEtDate: string;
  season: string;
  awayTeamId: string;
  homeTeamId: string;
  awayAbbr: string;
  homeAbbr: string;
  /** null when this scoreboard game has no unique analytics.games match, or the read failed. */
  games: ScheduleGameRow[] | null;
}): ScheduleLine {
  const away = deriveTeamSchedule({
    teamId: input.awayTeamId,
    gameEtDate: input.gameEtDate,
    season: input.season,
    games: input.games,
  });
  const home = deriveTeamSchedule({
    teamId: input.homeTeamId,
    gameEtDate: input.gameEtDate,
    season: input.season,
    games: input.games,
  });
  if (away.kind === 'unavailable' && home.kind === 'unavailable') {
    return { status: 'unavailable', text: SCHEDULE_UNAVAILABLE_TEXT };
  }
  const shared = sharedPhrase(away, home);
  return {
    status: 'ready',
    text: shared ?? `${teamPhrase(input.awayAbbr, away)} · ${teamPhrase(input.homeAbbr, home)}`,
  };
}
