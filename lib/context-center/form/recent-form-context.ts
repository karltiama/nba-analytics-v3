/**
 * recent-form-context-v1
 *
 * PLAYER_GAME derived context: season outcome baseline + recent ≤10 outcomes/efficiency.
 * Reuses selectPriorPlayedGames / classifyWowyAppearance (same chronology as Role).
 * Counting stats = arithmetic mean/game. Percentages = pooled made/attempts (null if 0 attempts).
 * Does not add TS%/FT%/eFG%, hot/cold labels, or predictive validation.
 */

import {
  selectPriorPlayedGames,
  type RoleHistoryGame,
} from '../role-expectation';
import {
  CONTEXT_COMPLETENESS,
  CONTEXT_DISPLAY_STATUS,
  CONTEXT_PREDICTIVE_STATUS,
  PLAYER_RECENT_FORM_WINDOW_MAX,
  RECENT_FORM_CONTEXT_VERSION,
  type ContextCompleteness,
} from '../types';

export const RECENT_FORM_WINDOW_MAX = PLAYER_RECENT_FORM_WINDOW_MAX;

export type FormMetricBlock = {
  historyN: number;
  latestHistoryGameId: string | null;
  latestHistoryGameStart: string | null;
  points: number | null;
  rebounds: number | null;
  tpm: number | null;
  fgMade: number | null;
  fgAttempted: number | null;
  fgPct: number | null;
  threeMade: number | null;
  threeAttempted: number | null;
  threePct: number | null;
};

export type RecentFormContextSnapshot = {
  grain: 'PLAYER_GAME';
  gameId: string;
  playerEntityId: string;
  teamId: string;
  season: string;
  targetGameStart: string;
  contextVersion: typeof RECENT_FORM_CONTEXT_VERSION;
  seasonForm: FormMetricBlock;
  recentForm: FormMetricBlock & { windowMax: typeof RECENT_FORM_WINDOW_MAX };
  completeness: { status: ContextCompleteness };
  provenance: {
    version: typeof RECENT_FORM_CONTEXT_VERSION;
    playedClassification: 'classifyWowyAppearance';
    baselineMethod: 'EXPANDING_SAME_SEASON_SAME_TEAM_PRIOR_PLAYED';
    recentWindow: 'LAST_10_PRIOR_PLAYED_GAMES';
    countingAggregation: 'arithmetic_mean_per_played_game';
    percentageAggregation: 'pooled_made_over_attempts';
    percentageUnit: 'fraction_0_1';
    priorSeasonFallback: false;
    priorTeamFallback: false;
  };
  predictiveStatus: typeof CONTEXT_PREDICTIVE_STATUS.NOT_TESTED;
  displayStatus:
    | typeof CONTEXT_DISPLAY_STATUS.DISPLAYABLE
    | typeof CONTEXT_DISPLAY_STATUS.RESEARCH;
};

function emptyBlock(): FormMetricBlock {
  return {
    historyN: 0,
    latestHistoryGameId: null,
    latestHistoryGameStart: null,
    points: null,
    rebounds: null,
    tpm: null,
    fgMade: null,
    fgAttempted: null,
    fgPct: null,
    threeMade: null,
    threeAttempted: null,
    threePct: null,
  };
}

function formBlock(prior: readonly RoleHistoryGame[]): FormMetricBlock {
  if (prior.length === 0) return emptyBlock();

  let sumPts = 0;
  let sumReb = 0;
  let sumTpm = 0;
  let sumFgm = 0;
  let sumFga = 0;
  let sumTpa = 0;

  for (const g of prior) {
    sumPts += Number(g.points ?? 0);
    sumReb += Number(g.rebounds ?? 0);
    sumTpm += Number(g.three_pointers_made ?? 0);
    sumFgm += Number(g.field_goals_made ?? 0);
    sumFga += Number(g.field_goals_attempted ?? 0);
    sumTpa += Number(g.three_pointers_attempted ?? 0);
  }

  const n = prior.length;
  const last = prior[n - 1]!;
  const fgPct = sumFga > 0 ? sumFgm / sumFga : null;
  const threePct = sumTpa > 0 ? sumTpm / sumTpa : null;

  if (fgPct != null && !(fgPct >= 0 && fgPct <= 1 && Number.isFinite(fgPct))) {
    throw new Error(`form fgPct out of domain: ${fgPct}`);
  }
  if (threePct != null && !(threePct >= 0 && threePct <= 1 && Number.isFinite(threePct))) {
    throw new Error(`form threePct out of domain: ${threePct}`);
  }

  return {
    historyN: n,
    latestHistoryGameId: last.gameId,
    latestHistoryGameStart: last.gameStart,
    points: sumPts / n,
    rebounds: sumReb / n,
    tpm: sumTpm / n,
    fgMade: sumFgm,
    fgAttempted: sumFga,
    fgPct,
    threeMade: sumTpm,
    threeAttempted: sumTpa,
    threePct,
  };
}

/**
 * Prior PLAYED history game IDs (season + recent window) — for Role/Form chronology parity.
 */
export function selectFormPriorHistory(args: {
  season: string;
  teamId: string;
  targetGameStart: string;
  history: readonly RoleHistoryGame[];
}): { season: RoleHistoryGame[]; recent: RoleHistoryGame[] } {
  const season = selectPriorPlayedGames(args);
  const recent =
    season.length <= RECENT_FORM_WINDOW_MAX
      ? season
      : season.slice(season.length - RECENT_FORM_WINDOW_MAX);
  return { season, recent };
}

export function computeRecentFormContext(args: {
  gameId: string;
  playerEntityId: string;
  teamId: string;
  season: string;
  targetGameStart: string;
  history: readonly RoleHistoryGame[];
  displayStatus?: RecentFormContextSnapshot['displayStatus'];
}): RecentFormContextSnapshot {
  const { season: prior, recent: recentSlice } = selectFormPriorHistory({
    season: args.season,
    teamId: args.teamId,
    targetGameStart: args.targetGameStart,
    history: args.history,
  });

  const seasonForm = formBlock(prior);
  const recentBase = formBlock(recentSlice);
  const recentForm = {
    ...recentBase,
    windowMax: RECENT_FORM_WINDOW_MAX as typeof RECENT_FORM_WINDOW_MAX,
  };

  if (seasonForm.latestHistoryGameStart != null) {
    if (!(seasonForm.latestHistoryGameStart < args.targetGameStart)) {
      throw new Error(
        `form-context season latest invariant failed latest=${seasonForm.latestHistoryGameStart} tip=${args.targetGameStart}`
      );
    }
  }
  if (recentForm.latestHistoryGameStart != null) {
    if (!(recentForm.latestHistoryGameStart < args.targetGameStart)) {
      throw new Error(
        `form-context recent latest invariant failed latest=${recentForm.latestHistoryGameStart} tip=${args.targetGameStart}`
      );
    }
  }
  if (recentForm.historyN > RECENT_FORM_WINDOW_MAX) {
    throw new Error(
      `recent_history_n ${recentForm.historyN} exceeds window ${RECENT_FORM_WINDOW_MAX}`
    );
  }

  let completenessStatus: ContextCompleteness;
  if (seasonForm.historyN === 0) {
    completenessStatus = CONTEXT_COMPLETENESS.SOURCE_ONLY;
  } else {
    const vals = [
      seasonForm.points,
      seasonForm.rebounds,
      seasonForm.tpm,
      seasonForm.fgPct,
      seasonForm.threePct,
      recentForm.points,
      recentForm.rebounds,
      recentForm.tpm,
      recentForm.fgPct,
      recentForm.threePct,
    ];
    const available = vals.filter((v) => v != null && Number.isFinite(v)).length;
    if (available === vals.length) completenessStatus = CONTEXT_COMPLETENESS.COMPLETE;
    else if (available > 0) completenessStatus = CONTEXT_COMPLETENESS.PARTIAL;
    else completenessStatus = CONTEXT_COMPLETENESS.SOURCE_ONLY;
  }

  return {
    grain: 'PLAYER_GAME',
    gameId: String(args.gameId),
    playerEntityId: String(args.playerEntityId),
    teamId: String(args.teamId),
    season: String(args.season),
    targetGameStart: args.targetGameStart,
    contextVersion: RECENT_FORM_CONTEXT_VERSION,
    seasonForm,
    recentForm,
    completeness: { status: completenessStatus },
    provenance: {
      version: RECENT_FORM_CONTEXT_VERSION,
      playedClassification: 'classifyWowyAppearance',
      baselineMethod: 'EXPANDING_SAME_SEASON_SAME_TEAM_PRIOR_PLAYED',
      recentWindow: 'LAST_10_PRIOR_PLAYED_GAMES',
      countingAggregation: 'arithmetic_mean_per_played_game',
      percentageAggregation: 'pooled_made_over_attempts',
      percentageUnit: 'fraction_0_1',
      priorSeasonFallback: false,
      priorTeamFallback: false,
    },
    predictiveStatus: CONTEXT_PREDICTIVE_STATUS.NOT_TESTED,
    displayStatus: args.displayStatus ?? CONTEXT_DISPLAY_STATUS.DISPLAYABLE,
  };
}
