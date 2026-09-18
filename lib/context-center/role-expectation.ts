/**
 * player-role-expectation-v1
 *
 * Same season + same team + prior PLAYED games only + expanding mean.
 * Strict: history game_start < target_game_start.
 * No previous-team / previous-season / career / league fallback.
 *
 * Played semantics: classifyWowyAppearance (canonical WOWY/PGL rule).
 *
 * NOTE: expectedMinutes / expectedFga / expectedPoints semantics are frozen —
 * Team Injury Context V2 depends on them. Extensions for Role Context live in
 * selectPriorPlayedGames + player-role-context (FTA/AST/3PA/recent).
 */

import { classifyWowyAppearance, parseMinutes } from '@/lib/wowy/appearance';
import { PLAYER_ROLE_EXPECTATION_VERSION } from './types';

export type RoleHistoryGame = {
  gameId: string;
  gameStart: string;
  season: string;
  teamId: string;
  minutes: string | number | null;
  points?: number | null;
  rebounds?: number | null;
  assists?: number | null;
  three_pointers_made?: number | null;
  three_pointers_attempted?: number | null;
  field_goals_made?: number | null;
  field_goals_attempted?: number | null;
  free_throws_attempted?: number | null;
};

export type PlayerRoleEstimate = {
  playerEntityId: string;
  season: string;
  teamId: string;
  historyN: number;
  expectedMinutes: number;
  expectedFga: number;
  expectedPoints: number;
  historyMaxGameStart: string;
  targetGameStart: string;
  roleExpectationVersion: typeof PLAYER_ROLE_EXPECTATION_VERSION;
};

export type PlayerRoleEstimateResult =
  | { status: 'OK'; estimate: PlayerRoleEstimate }
  | { status: 'NO_HISTORY' };

export function isPlayedRoleHistoryGame(game: RoleHistoryGame): boolean {
  return classifyWowyAppearance(game).class === 'played';
}

/**
 * Prior PLAYED games for same season + team with start_time < tip.
 * Sorted ascending by (gameStart, gameId). Deterministic.
 */
export function selectPriorPlayedGames(args: {
  season: string;
  teamId: string;
  targetGameStart: string;
  history: readonly RoleHistoryGame[];
}): RoleHistoryGame[] {
  const { season, teamId, targetGameStart, history } = args;
  const prior: RoleHistoryGame[] = [];
  for (const g of history) {
    if (g.season !== season) continue;
    if (String(g.teamId) !== String(teamId)) continue;
    if (!(g.gameStart < targetGameStart)) continue;
    if (!isPlayedRoleHistoryGame(g)) continue;
    prior.push(g);
  }
  prior.sort((a, b) =>
    a.gameStart < b.gameStart ? -1 : a.gameStart > b.gameStart ? 1 : a.gameId.localeCompare(b.gameId)
  );
  return prior;
}

/**
 * Expanding mean of prior played games for same season + team.
 * Returns NO_HISTORY when no qualifying prior played games.
 * Semantics for minutes/FGA/PTS must remain stable for injury V2.
 */
export function estimatePlayerRole(args: {
  playerEntityId: string;
  season: string;
  teamId: string;
  targetGameStart: string;
  history: readonly RoleHistoryGame[];
}): PlayerRoleEstimateResult {
  const { playerEntityId, season, teamId, targetGameStart, history } = args;

  const prior = selectPriorPlayedGames({ season, teamId, targetGameStart, history });

  if (prior.length === 0) {
    return { status: 'NO_HISTORY' };
  }

  let sumMin = 0;
  let sumFga = 0;
  let sumPts = 0;
  for (const g of prior) {
    sumMin += parseMinutes(g.minutes) ?? 0;
    sumFga += Number(g.field_goals_attempted ?? 0);
    sumPts += Number(g.points ?? 0);
  }
  const n = prior.length;
  const historyMaxGameStart = prior[prior.length - 1]!.gameStart;

  if (!(historyMaxGameStart < targetGameStart)) {
    throw new Error(
      `role-expectation invariant violated: historyMaxGameStart=${historyMaxGameStart} >= target=${targetGameStart}`
    );
  }

  return {
    status: 'OK',
    estimate: {
      playerEntityId,
      season,
      teamId,
      historyN: n,
      expectedMinutes: sumMin / n,
      expectedFga: sumFga / n,
      expectedPoints: sumPts / n,
      historyMaxGameStart,
      targetGameStart,
      roleExpectationVersion: PLAYER_ROLE_EXPECTATION_VERSION,
    },
  };
}

export function isRotationPlayer(expectedMinutes: number): boolean {
  return expectedMinutes >= 20;
}
