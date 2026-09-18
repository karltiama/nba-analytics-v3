/**
 * player-role-context-v1
 *
 * PLAYER_GAME derived context: season baseline + recent ≤10 deployment/opportunity.
 * Reuses selectPriorPlayedGames / classifyWowyAppearance from player-role-expectation-v1.
 * Does not change expectedMinutes/FGA/PTS semantics used by Team Injury Context V2.
 */

import { parseMinutes } from '@/lib/wowy/appearance';
import {
  isPlayedRoleHistoryGame,
  selectPriorPlayedGames,
  type RoleHistoryGame,
} from '../role-expectation';
import {
  CONTEXT_COMPLETENESS,
  CONTEXT_DISPLAY_STATUS,
  CONTEXT_PREDICTIVE_STATUS,
  PLAYER_RECENT_ROLE_WINDOW_MAX,
  PLAYER_ROLE_CONTEXT_VERSION,
  PLAYER_ROLE_EXPECTATION_VERSION,
  type ContextCompleteness,
} from '../types';

export const RECENT_ROLE_WINDOW_MAX = PLAYER_RECENT_ROLE_WINDOW_MAX;

export type RoleMetricBlock = {
  historyN: number;
  latestHistoryGameId: string | null;
  latestHistoryGameStart: string | null;
  minutes: number | null;
  fga: number | null;
  fta: number | null;
  ast: number | null;
  tpa: number | null;
};

export type PlayerRoleContextSnapshot = {
  grain: 'PLAYER_GAME';
  gameId: string;
  playerEntityId: string;
  teamId: string;
  season: string;
  targetGameStart: string;
  contextVersion: typeof PLAYER_ROLE_CONTEXT_VERSION;
  seasonRole: RoleMetricBlock;
  recentRole: RoleMetricBlock & { windowMax: typeof RECENT_ROLE_WINDOW_MAX };
  completeness: { status: ContextCompleteness };
  provenance: {
    version: typeof PLAYER_ROLE_CONTEXT_VERSION;
    roleExpectationVersion: typeof PLAYER_ROLE_EXPECTATION_VERSION;
    playedClassification: 'classifyWowyAppearance';
    baselineMethod: 'EXPANDING_SAME_SEASON_SAME_TEAM_PRIOR_PLAYED_MEAN';
    recentWindow: 'LAST_10_PRIOR_PLAYED_GAMES';
    priorSeasonFallback: false;
    priorTeamFallback: false;
  };
  predictiveStatus: typeof CONTEXT_PREDICTIVE_STATUS.NOT_TESTED;
  displayStatus: typeof CONTEXT_DISPLAY_STATUS.DISPLAYABLE | typeof CONTEXT_DISPLAY_STATUS.RESEARCH;
};

function meanBlock(prior: readonly RoleHistoryGame[]): RoleMetricBlock {
  if (prior.length === 0) {
    return {
      historyN: 0,
      latestHistoryGameId: null,
      latestHistoryGameStart: null,
      minutes: null,
      fga: null,
      fta: null,
      ast: null,
      tpa: null,
    };
  }
  let sumMin = 0;
  let sumFga = 0;
  let sumFta = 0;
  let sumAst = 0;
  let sumTpa = 0;
  for (const g of prior) {
    sumMin += parseMinutes(g.minutes) ?? 0;
    sumFga += Number(g.field_goals_attempted ?? 0);
    sumFta += Number(g.free_throws_attempted ?? 0);
    sumAst += Number(g.assists ?? 0);
    sumTpa += Number(g.three_pointers_attempted ?? 0);
  }
  const n = prior.length;
  const last = prior[n - 1]!;
  return {
    historyN: n,
    latestHistoryGameId: last.gameId,
    latestHistoryGameStart: last.gameStart,
    minutes: sumMin / n,
    fga: sumFga / n,
    fta: sumFta / n,
    ast: sumAst / n,
    tpa: sumTpa / n,
  };
}

export function computePlayerRoleContext(args: {
  gameId: string;
  playerEntityId: string;
  teamId: string;
  season: string;
  targetGameStart: string;
  history: readonly RoleHistoryGame[];
  displayStatus?: PlayerRoleContextSnapshot['displayStatus'];
}): PlayerRoleContextSnapshot {
  const prior = selectPriorPlayedGames({
    season: args.season,
    teamId: args.teamId,
    targetGameStart: args.targetGameStart,
    history: args.history,
  });

  const seasonRole = meanBlock(prior);
  const recentSlice =
    prior.length <= RECENT_ROLE_WINDOW_MAX ? prior : prior.slice(prior.length - RECENT_ROLE_WINDOW_MAX);
  const recentBase = meanBlock(recentSlice);
  const recentRole = { ...recentBase, windowMax: RECENT_ROLE_WINDOW_MAX as typeof RECENT_ROLE_WINDOW_MAX };

  if (seasonRole.latestHistoryGameStart != null) {
    if (!(seasonRole.latestHistoryGameStart < args.targetGameStart)) {
      throw new Error(
        `role-context season latest invariant failed latest=${seasonRole.latestHistoryGameStart} tip=${args.targetGameStart}`
      );
    }
  }
  if (recentRole.latestHistoryGameStart != null) {
    if (!(recentRole.latestHistoryGameStart < args.targetGameStart)) {
      throw new Error(
        `role-context recent latest invariant failed latest=${recentRole.latestHistoryGameStart} tip=${args.targetGameStart}`
      );
    }
  }
  if (recentRole.historyN > RECENT_ROLE_WINDOW_MAX) {
    throw new Error(`recent_history_n ${recentRole.historyN} exceeds window ${RECENT_ROLE_WINDOW_MAX}`);
  }

  let completenessStatus: ContextCompleteness;
  if (seasonRole.historyN === 0) {
    completenessStatus = CONTEXT_COMPLETENESS.SOURCE_ONLY;
  } else {
    const vals = [
      seasonRole.minutes,
      seasonRole.fga,
      seasonRole.fta,
      seasonRole.ast,
      seasonRole.tpa,
      recentRole.minutes,
      recentRole.fga,
      recentRole.fta,
      recentRole.ast,
      recentRole.tpa,
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
    contextVersion: PLAYER_ROLE_CONTEXT_VERSION,
    seasonRole,
    recentRole,
    completeness: { status: completenessStatus },
    provenance: {
      version: PLAYER_ROLE_CONTEXT_VERSION,
      roleExpectationVersion: PLAYER_ROLE_EXPECTATION_VERSION,
      playedClassification: 'classifyWowyAppearance',
      baselineMethod: 'EXPANDING_SAME_SEASON_SAME_TEAM_PRIOR_PLAYED_MEAN',
      recentWindow: 'LAST_10_PRIOR_PLAYED_GAMES',
      priorSeasonFallback: false,
      priorTeamFallback: false,
    },
    predictiveStatus: CONTEXT_PREDICTIVE_STATUS.NOT_TESTED,
    displayStatus: args.displayStatus ?? CONTEXT_DISPLAY_STATUS.DISPLAYABLE,
  };
}

/**
 * Chronological accumulator for streaming certification.
 * Call peek/emit BEFORE ingesting a PLAYED target outcome.
 */
export type PlayerTeamSeasonAccum = {
  games: RoleHistoryGame[];
};

export function accumKey(season: string, teamId: string, playerEntityId: string): string {
  return `${season}|${teamId}|${playerEntityId}`;
}

export function ingestPlayedIntoAccum(
  map: Map<string, PlayerTeamSeasonAccum>,
  game: RoleHistoryGame & { playerEntityId: string }
): void {
  if (!isPlayedRoleHistoryGame(game)) {
    throw new Error(`ingestPlayedIntoAccum requires PLAYED game=${game.gameId}`);
  }
  const key = accumKey(game.season, game.teamId, game.playerEntityId);
  let slot = map.get(key);
  if (!slot) {
    slot = { games: [] };
    map.set(key, slot);
  }
  slot.games.push({
    gameId: game.gameId,
    gameStart: game.gameStart,
    season: game.season,
    teamId: game.teamId,
    minutes: game.minutes,
    points: game.points,
    rebounds: game.rebounds,
    assists: game.assists,
    three_pointers_made: game.three_pointers_made,
    three_pointers_attempted: game.three_pointers_attempted,
    field_goals_made: game.field_goals_made,
    field_goals_attempted: game.field_goals_attempted,
    free_throws_attempted: game.free_throws_attempted,
  });
}

export function historyFromAccum(
  map: Map<string, PlayerTeamSeasonAccum>,
  season: string,
  teamId: string,
  playerEntityId: string
): readonly RoleHistoryGame[] {
  return map.get(accumKey(season, teamId, playerEntityId))?.games ?? [];
}
