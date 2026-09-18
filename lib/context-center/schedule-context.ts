/**
 * schedule-context-v1
 *
 * TEAM_GAME schedule facts/derived context.
 * Basketball dates via etCalendarDate (America/New_York).
 *
 * days_rest = (target_ET_date - previous_ET_date) - 1
 * back_to_back = (days_rest === 0) when prior exists
 * Season opener (no same-season Final prior): days_rest=null, back_to_back=false
 *
 * Note: Feature D `team_rest_days` is the raw calendar gap; this context uses gap-1.
 */

import { etCalendarDate } from '@/lib/wowy/calendar';
import {
  BASKETBALL_DATE_TIMEZONE,
  CONTEXT_COMPLETENESS,
  SCHEDULE_CONTEXT_VERSION,
  type ContextCompleteness,
} from './types';

export type HomeAway = 'HOME' | 'AWAY';

export type ScheduleGameRow = {
  gameId: string;
  season: string;
  startTime: string;
  status: string | null;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
};

export type TeamGameScheduleSnapshot = {
  grain: 'TEAM_GAME';
  gameId: string;
  teamId: string;
  season: string;
  gameStart: string;
  contextVersion: typeof SCHEDULE_CONTEXT_VERSION;
  schedule: {
    homeAway: HomeAway;
    daysRest: number | null;
    backToBack: boolean;
    isSeasonOpener: boolean;
  };
  /** Raw ET calendar gap (target_date - prev_date). Provenance/debug only — not a registry context. */
  daysSinceLastGame: number | null;
  completeness: {
    status: ContextCompleteness;
  };
  provenance: {
    previousGameId: string | null;
    previousGameStart: string | null;
    targetBasketballDate: string;
    previousBasketballDate: string | null;
    timezone: typeof BASKETBALL_DATE_TIMEZONE;
    version: typeof SCHEDULE_CONTEXT_VERSION;
    priorGameEligibility: 'status_Final_with_scores';
    seasonOpenerPolicy: 'same_season_only_no_cross_season_rest';
  };
  predictiveStatus: 'NOT_TESTED';
  displayStatus: 'DISPLAYABLE';
};

export function isEligibleCompletedGame(game: ScheduleGameRow): boolean {
  return (
    game.status === 'Final' &&
    typeof game.startTime === 'string' &&
    game.startTime.length > 0 &&
    Number.isFinite(Date.parse(game.startTime)) &&
    game.homeScore != null &&
    game.awayScore != null &&
    Number.isFinite(game.homeScore) &&
    Number.isFinite(game.awayScore) &&
    game.homeTeamId !== game.awayTeamId
  );
}

export function resolveHomeAway(teamId: string, game: ScheduleGameRow): HomeAway {
  const isHome = String(teamId) === String(game.homeTeamId);
  const isAway = String(teamId) === String(game.awayTeamId);
  if (isHome === isAway) {
    throw new Error(
      `HOME/AWAY identity failure game=${game.gameId} team=${teamId} home=${game.homeTeamId} away=${game.awayTeamId}`
    );
  }
  return isHome ? 'HOME' : 'AWAY';
}

function parseYmdUtc(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Calendar day difference between two YYYY-MM-DD basketball dates. */
export function etDateDiffDays(laterYmd: string, earlierYmd: string): number {
  const later = parseYmdUtc(laterYmd);
  const earlier = parseYmdUtc(earlierYmd);
  if (later == null || earlier == null) {
    throw new Error(`Invalid basketball dates later=${laterYmd} earlier=${earlierYmd}`);
  }
  return Math.round((later - earlier) / 86_400_000);
}

/**
 * Select previous eligible same-season completed game for a team.
 * Strict start_time < target.startTime. Same-tip excluded.
 * If multiple candidates share identical max start_time → throw (ambiguity).
 */
export function selectPreviousCompletedGame(args: {
  teamId: string;
  target: ScheduleGameRow;
  history: readonly ScheduleGameRow[];
}): ScheduleGameRow | null {
  const { teamId, target, history } = args;
  const candidates: ScheduleGameRow[] = [];
  for (const g of history) {
    if (String(g.season) !== String(target.season)) continue;
    if (String(g.gameId) === String(target.gameId)) continue;
    if (!isEligibleCompletedGame(g)) continue;
    if (!(g.startTime < target.startTime)) continue;
    const onTeam =
      String(g.homeTeamId) === String(teamId) || String(g.awayTeamId) === String(teamId);
    if (!onTeam) continue;
    candidates.push(g);
  }
  if (candidates.length === 0) return null;

  let maxStart = candidates[0]!.startTime;
  for (const g of candidates) {
    if (g.startTime > maxStart) maxStart = g.startTime;
  }
  const atMax = candidates.filter((g) => g.startTime === maxStart);
  if (atMax.length !== 1) {
    throw new Error(
      `Ambiguous prior games for team=${teamId} target=${target.gameId} start=${maxStart} count=${atMax.length}`
    );
  }
  return atMax[0]!;
}

export function computeTeamGameSchedule(args: {
  teamId: string;
  target: ScheduleGameRow;
  history: readonly ScheduleGameRow[];
}): TeamGameScheduleSnapshot {
  const { teamId, target, history } = args;
  if (!isEligibleCompletedGame(target) && target.status !== 'Final') {
    // Target universe is Final games; still allow home/away from IDs if scores present.
  }
  if (String(target.homeTeamId) === String(target.awayTeamId)) {
    throw new Error(`home_team_id == away_team_id for game ${target.gameId}`);
  }

  const homeAway = resolveHomeAway(teamId, target);
  const targetBasketballDate = etCalendarDate(target.startTime);
  if (!targetBasketballDate) {
    throw new Error(`Cannot derive ET basketball date for ${target.gameId} ${target.startTime}`);
  }

  const previous = selectPreviousCompletedGame({ teamId, target, history });
  let daysSinceLastGame: number | null = null;
  let daysRest: number | null = null;
  let backToBack = false;
  let isSeasonOpener = false;
  let previousBasketballDate: string | null = null;

  if (previous == null) {
    isSeasonOpener = true;
    daysRest = null;
    backToBack = false;
    daysSinceLastGame = null;
  } else {
    previousBasketballDate = etCalendarDate(previous.startTime);
    if (!previousBasketballDate) {
      throw new Error(`Cannot derive ET date for prior ${previous.gameId}`);
    }
    daysSinceLastGame = etDateDiffDays(targetBasketballDate, previousBasketballDate);
    if (daysSinceLastGame < 1) {
      throw new Error(
        `Non-positive calendar gap team=${teamId} target=${target.gameId} prev=${previous.gameId} gap=${daysSinceLastGame}`
      );
    }
    daysRest = daysSinceLastGame - 1;
    if (daysRest < 0) {
      throw new Error(`Negative days_rest team=${teamId} target=${target.gameId}`);
    }
    if (!Number.isInteger(daysRest)) {
      throw new Error(`Non-integer days_rest=${daysRest}`);
    }
    backToBack = daysRest === 0;
  }

  return {
    grain: 'TEAM_GAME',
    gameId: target.gameId,
    teamId: String(teamId),
    season: String(target.season),
    gameStart: target.startTime,
    contextVersion: SCHEDULE_CONTEXT_VERSION,
    schedule: {
      homeAway,
      daysRest,
      backToBack,
      isSeasonOpener,
    },
    daysSinceLastGame,
    completeness: {
      status: CONTEXT_COMPLETENESS.COMPLETE,
    },
    provenance: {
      previousGameId: previous?.gameId ?? null,
      previousGameStart: previous?.startTime ?? null,
      targetBasketballDate,
      previousBasketballDate,
      timezone: BASKETBALL_DATE_TIMEZONE,
      version: SCHEDULE_CONTEXT_VERSION,
      priorGameEligibility: 'status_Final_with_scores',
      seasonOpenerPolicy: 'same_season_only_no_cross_season_rest',
    },
    predictiveStatus: 'NOT_TESTED',
    displayStatus: 'DISPLAYABLE',
  };
}

export function assertScheduleInvariants(snap: TeamGameScheduleSnapshot): void {
  if (snap.schedule.daysRest != null) {
    if (!Number.isFinite(snap.schedule.daysRest) || snap.schedule.daysRest < 0) {
      throw new Error('invalid days_rest');
    }
    if (!Number.isInteger(snap.schedule.daysRest)) {
      throw new Error('days_rest must be integer');
    }
    if (snap.schedule.backToBack !== (snap.schedule.daysRest === 0)) {
      throw new Error('back_to_back inconsistency');
    }
  } else {
    if (!snap.schedule.isSeasonOpener) {
      throw new Error('null days_rest only valid for season opener');
    }
    if (snap.schedule.backToBack !== false) {
      throw new Error('season opener must have back_to_back=false');
    }
  }
  if (snap.completeness.status !== CONTEXT_COMPLETENESS.COMPLETE) {
    throw new Error('schedule snapshot must be COMPLETE under locked semantics');
  }
}
