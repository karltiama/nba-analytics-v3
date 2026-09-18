/**
 * opponent-context-v1 snapshot builder.
 *
 * TEAM_GAME grain: owner team receives opponent team's prior same-season profile.
 * Source: PGL-reconstructed team boxes only (never stale TGS advanced columns).
 */

import {
  CONTEXT_COMPLETENESS,
  CONTEXT_DISPLAY_STATUS,
  CONTEXT_PREDICTIVE_STATUS,
  OPPONENT_CONTEXT_VERSION,
  OPPONENT_POSSESSIONS_FORMULA_VERSION,
  OPPONENT_TEAM_BOX_VERSION,
  type ContextCompleteness,
} from '../types';
import {
  aggregateOpponentMetrics,
  assertOpponentMetricDomains,
  type OpponentMetrics,
} from './formulas';
import {
  type OpponentGameMeta,
  type OpponentTeamBox,
} from './team-box';

export type OpponentContextHistoryIndex = {
  /** Usable boxes for profile team, sorted by (startTime, gameId). */
  byTeamSeason: Map<string, OpponentTeamBox[]>;
};

export type OpponentContextSnapshot = {
  grain: 'TEAM_GAME';
  gameId: string;
  teamId: string;
  opponentTeamId: string;
  targetGameStart: string;
  season: string;
  contextVersion: typeof OPPONENT_CONTEXT_VERSION;
  opponent: OpponentMetrics;
  history: {
    n: number;
    latestGameStart: string | null;
  };
  completeness: {
    status: ContextCompleteness;
  };
  provenance: {
    version: typeof OPPONENT_CONTEXT_VERSION;
    teamBoxVersion: typeof OPPONENT_TEAM_BOX_VERSION;
    possessionsFormulaVersion: typeof OPPONENT_POSSESSIONS_FORMULA_VERSION;
    sourcePath: 'pgl_team_box_v1';
    staleTgsAdvancedColumnsUsed: false;
    historyPolicy: 'same_season_final_start_time_lt_tip';
    priorSeasonFallback: false;
    paceUnit: 'estimated_possessions_per_team_game';
  };
  predictiveStatus: typeof CONTEXT_PREDICTIVE_STATUS.NOT_TESTED;
  displayStatus: typeof CONTEXT_DISPLAY_STATUS.DISPLAYABLE | typeof CONTEXT_DISPLAY_STATUS.RESEARCH;
};

function teamSeasonKey(teamId: string, season: string): string {
  return `${teamId}|${season}`;
}

export function buildOpponentHistoryIndex(
  boxes: readonly OpponentTeamBox[]
): OpponentContextHistoryIndex {
  const byTeamSeason = new Map<string, OpponentTeamBox[]>();
  for (const b of boxes) {
    if (!b.usable) continue;
    const k = teamSeasonKey(b.teamId, b.season);
    const arr = byTeamSeason.get(k);
    if (arr) arr.push(b);
    else byTeamSeason.set(k, [b]);
  }
  for (const arr of byTeamSeason.values()) {
    arr.sort((a, b) => {
      if (a.startTime < b.startTime) return -1;
      if (a.startTime > b.startTime) return 1;
      return a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0;
    });
  }
  return { byTeamSeason };
}

export function selectOpponentPriorBoxes(args: {
  opponentTeamId: string;
  season: string;
  targetGameStart: string;
  index: OpponentContextHistoryIndex;
}): OpponentTeamBox[] {
  const all = args.index.byTeamSeason.get(teamSeasonKey(args.opponentTeamId, args.season)) ?? [];
  return all.filter((b) => b.startTime < args.targetGameStart);
}

export function resolveOpponentTeamId(args: {
  teamId: string;
  target: OpponentGameMeta;
}): string {
  const { teamId, target } = args;
  const isHome = String(teamId) === String(target.homeTeamId);
  const isAway = String(teamId) === String(target.awayTeamId);
  if (isHome === isAway) {
    throw new Error(
      `opponent mapping failure game=${target.gameId} team=${teamId} home=${target.homeTeamId} away=${target.awayTeamId}`
    );
  }
  const opp = isHome ? String(target.awayTeamId) : String(target.homeTeamId);
  if (opp === String(teamId)) {
    throw new Error(`team_id === opponent_team_id game=${target.gameId}`);
  }
  return opp;
}

export type ComputeOpponentContextArgs = {
  teamId: string;
  target: OpponentGameMeta;
  index: OpponentContextHistoryIndex;
  /** After certification: DISPLAYABLE; before: RESEARCH */
  displayStatus?: OpponentContextSnapshot['displayStatus'];
};

export function computeOpponentContext(args: ComputeOpponentContextArgs): OpponentContextSnapshot {
  const { teamId, target, index } = args;
  if (String(target.homeTeamId) === String(target.awayTeamId)) {
    throw new Error(`invalid target home==away game=${target.gameId}`);
  }
  const opponentTeamId = resolveOpponentTeamId({ teamId, target });
  const history = selectOpponentPriorBoxes({
    opponentTeamId,
    season: String(target.season),
    targetGameStart: target.startTime,
    index,
  });

  const n = history.length;
  const latestGameStart = n > 0 ? history[n - 1]!.startTime : null;
  if (latestGameStart != null && !(latestGameStart < target.startTime)) {
    throw new Error(
      `history_latest_game_start invariant failed latest=${latestGameStart} tip=${target.startTime}`
    );
  }

  const opponent = aggregateOpponentMetrics(history);
  assertOpponentMetricDomains(opponent);

  let completenessStatus: ContextCompleteness;
  if (n === 0) {
    completenessStatus = CONTEXT_COMPLETENESS.SOURCE_ONLY;
  } else {
    const vals = [
      opponent.pace,
      opponent.defensiveRating,
      opponent.defensiveReboundPct,
      opponent.offensiveReboundPct,
      opponent.turnoverRate,
      opponent.threePointAttemptRateAllowed,
    ];
    const available = vals.filter((v) => v != null).length;
    if (available === vals.length) completenessStatus = CONTEXT_COMPLETENESS.COMPLETE;
    else if (available > 0) completenessStatus = CONTEXT_COMPLETENESS.PARTIAL;
    else completenessStatus = CONTEXT_COMPLETENESS.SOURCE_ONLY;
  }

  return {
    grain: 'TEAM_GAME',
    gameId: String(target.gameId),
    teamId: String(teamId),
    opponentTeamId,
    targetGameStart: target.startTime,
    season: String(target.season),
    contextVersion: OPPONENT_CONTEXT_VERSION,
    opponent,
    history: { n, latestGameStart },
    completeness: { status: completenessStatus },
    provenance: {
      version: OPPONENT_CONTEXT_VERSION,
      teamBoxVersion: OPPONENT_TEAM_BOX_VERSION,
      possessionsFormulaVersion: OPPONENT_POSSESSIONS_FORMULA_VERSION,
      sourcePath: 'pgl_team_box_v1',
      staleTgsAdvancedColumnsUsed: false,
      historyPolicy: 'same_season_final_start_time_lt_tip',
      priorSeasonFallback: false,
      paceUnit: 'estimated_possessions_per_team_game',
    },
    predictiveStatus: CONTEXT_PREDICTIVE_STATUS.NOT_TESTED,
    displayStatus: args.displayStatus ?? CONTEXT_DISPLAY_STATUS.DISPLAYABLE,
  };
}
