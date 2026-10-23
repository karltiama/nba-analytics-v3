/**
 * Keep only allowlisted Final games inside the recovery window.
 * A neighbor returned by the date-range games call is ignored, never written.
 */

import type { ExpectedFinal, RecoveryPlan } from './recovery-plan';
import { classifyServingGame, etDateOfProviderGame } from './season-eligibility';

export type ProviderGame = {
  id?: unknown;
  season?: unknown;
  date?: unknown;
  datetime?: unknown;
  status?: unknown;
  ist_stage?: unknown;
  home_team_score?: unknown;
  visitor_team_score?: unknown;
  home_team?: { id?: unknown; abbreviation?: unknown } | null;
  visitor_team?: { id?: unknown; abbreviation?: unknown } | null;
  period?: unknown;
  time?: unknown;
  period_detail?: unknown;
  postseason?: unknown;
};

export type GameRejection = {
  gameId: number | null;
  reason: string;
  detail?: string;
};

export type RecoverySelection = {
  ready: ProviderGame[];
  rejected: GameRejection[];
  ignoredGameIds: number[];
};

function sameRow(left: ProviderGame, right: ProviderGame): boolean {
  return (
    left.status === right.status &&
    left.date === right.date &&
    String(left.season) === String(right.season) &&
    left.home_team_score === right.home_team_score &&
    left.visitor_team_score === right.visitor_team_score &&
    left.home_team?.id === right.home_team?.id &&
    left.visitor_team?.id === right.visitor_team?.id
  );
}

export function expectedFinalMismatch(game: ProviderGame, expected: ExpectedFinal): string | null {
  if (game.home_team?.id !== expected.homeTeamId || game.visitor_team?.id !== expected.awayTeamId) {
    return 'expected_team_mismatch';
  }
  if (game.home_team_score !== expected.homeScore || game.visitor_team_score !== expected.awayScore) {
    return 'expected_score_mismatch';
  }
  return null;
}

export function selectRecoveryGames(plan: RecoveryPlan, games: readonly ProviderGame[]): RecoverySelection {
  const allowed = new Set(plan.gameIds);
  const grouped = new Map<number, ProviderGame[]>();
  const ignoredGameIds: number[] = [];

  for (const game of games) {
    const id = typeof game?.id === 'number' && Number.isSafeInteger(game.id) ? game.id : null;
    if (id == null || !allowed.has(id)) {
      if (id != null) ignoredGameIds.push(id);
      continue;
    }
    const rows = grouped.get(id) ?? [];
    rows.push(game);
    grouped.set(id, rows);
  }

  const ready: ProviderGame[] = [];
  const rejected: GameRejection[] = [];
  for (const gameId of plan.gameIds) {
    const rows = grouped.get(gameId) ?? [];
    if (rows.length === 0) {
      rejected.push({ gameId, reason: 'game_absent' });
      continue;
    }
    if (rows.some((row) => !sameRow(row, rows[0]))) {
      rejected.push({ gameId, reason: 'duplicate_game_row' });
      continue;
    }
    const game = rows[0];
    const serving = classifyServingGame({
      game,
      requestedSeasonType: 'regular',
      expectedSeason: plan.seasonStartYear,
    });
    if (!serving.eligible) {
      rejected.push({ gameId, reason: serving.reason });
      continue;
    }
    const etDate = etDateOfProviderGame(game);
    if (etDate == null || etDate < plan.startDate || etDate > plan.endDate) {
      rejected.push({ gameId, reason: 'outside_window', detail: etDate ?? undefined });
      continue;
    }
    if (game.status !== 'Final') {
      rejected.push({ gameId, reason: 'not_final', detail: String(game.status ?? '') });
      continue;
    }
    const homeId = game.home_team?.id;
    const awayId = game.visitor_team?.id;
    if (typeof homeId !== 'number' || typeof awayId !== 'number' || homeId === awayId) {
      rejected.push({ gameId, reason: 'team_missing' });
      continue;
    }
    ready.push(game);
  }

  return { ready, rejected, ignoredGameIds };
}
