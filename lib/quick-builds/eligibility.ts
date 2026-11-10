/**
 * Chooses the latest complete game-level pull. Does not read a database.
 * A newer failed, zero-row, or invalid-clock attempt is never a silent
 * confirmation that an older snapshot is still the board.
 */

import { normalizeGameStatus } from '@/lib/betting/normalize-game-status';
import {
  QUICK_BUILD_MAX_ATTEMPTS,
  QUICK_BUILD_MAX_GAMES,
  QUICK_BUILD_MAX_OBSERVATIONS,
  QuickBuildInputError,
  type BlockingAttempt,
  type BlockingAttemptKind,
  type GameEligibility,
  type GamePullAttempt,
  type MarketObservationInput,
  type QuickBuildGameInput,
  type QuickBuildPolicy,
} from './types';

export type EligibleSelection = {
  asOfMs: number;
  maxObservationAgeMs: number | null;
  upcomingCount: number;
  games: GameEligibility[];
  observations: MarketObservationInput[];
};

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new QuickBuildInputError('MALFORMED_INPUT', `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new QuickBuildInputError('MALFORMED_INPUT', `${label} is required`);
  }
  return value.trim();
}

export function parseAsOf(asOf: string): number {
  const ms = Date.parse(asOf);
  if (!Number.isFinite(ms)) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'policy.asOf is not a timestamp');
  }
  return ms;
}

function pullNumber(pullRunId: string): number | null {
  return /^\d+$/.test(pullRunId) ? Number(pullRunId) : null;
}

function completedMs(attempt: GamePullAttempt): number | null {
  if (attempt.completedAt == null) return null;
  const ms = Date.parse(attempt.completedAt);
  return Number.isFinite(ms) ? ms : null;
}

/** Later attempts sort last. */
export function compareAttempts(a: GamePullAttempt, b: GamePullAttempt): number {
  const ta = completedMs(a);
  const tb = completedMs(b);
  if (ta != null && tb != null && ta !== tb) return ta - tb;
  if (ta != null && tb == null) return 1;
  if (ta == null && tb != null) return -1;
  const na = pullNumber(a.pullRunId);
  const nb = pullNumber(b.pullRunId);
  if (na != null && nb != null && na !== nb) return na - nb;
  return a.pullRunId.localeCompare(b.pullRunId);
}

export function isCompleteSuccess(attempt: GamePullAttempt): boolean {
  return (
    attempt.status === 'success' &&
    attempt.rowsStored > 0 &&
    attempt.observationClock === 'RESPONSE_RECEIVED' &&
    completedMs(attempt) != null
  );
}

export function blockingKind(attempt: GamePullAttempt): BlockingAttemptKind {
  if (attempt.status === 'error') return 'failed';
  if (attempt.status === 'started') return 'in_progress';
  if (attempt.status === 'success' && attempt.rowsStored === 0) return 'zero_row';
  if (attempt.status === 'success' && attempt.rowsStored > 0 && attempt.observationClock !== 'RESPONSE_RECEIVED') {
    return 'invalid_clock';
  }
  return 'incomplete';
}

function toBlocking(attempt: GamePullAttempt): BlockingAttempt {
  return {
    pullRunId: attempt.pullRunId,
    status: attempt.status,
    rowsStored: attempt.rowsStored,
    kind: blockingKind(attempt),
  };
}

function parseAttempt(raw: unknown, index: number): GamePullAttempt {
  const row = requireObject(raw, `attempts[${index}]`);
  const status = row.status;
  if (status !== 'started' && status !== 'success' && status !== 'error') {
    throw new QuickBuildInputError('MALFORMED_INPUT', `attempts[${index}].status is invalid`);
  }
  if (typeof row.rowsStored !== 'number' || !Number.isInteger(row.rowsStored) || row.rowsStored < 0) {
    throw new QuickBuildInputError('MALFORMED_INPUT', `attempts[${index}].rowsStored must be a non-negative integer`);
  }
  const clock = row.observationClock;
  if (clock != null && clock !== 'RESPONSE_RECEIVED') {
    throw new QuickBuildInputError('MALFORMED_INPUT', `attempts[${index}].observationClock is invalid`);
  }
  const completedAt = row.completedAt;
  if (completedAt != null && (typeof completedAt !== 'string' || !Number.isFinite(Date.parse(completedAt)))) {
    throw new QuickBuildInputError('MALFORMED_INPUT', `attempts[${index}].completedAt is invalid`);
  }
  return {
    pullRunId: requireString(row.pullRunId, `attempts[${index}].pullRunId`),
    gameId: requireString(row.gameId, `attempts[${index}].gameId`),
    status,
    rowsStored: row.rowsStored,
    completedAt: completedAt == null ? null : completedAt,
    observationClock: clock == null ? null : 'RESPONSE_RECEIVED',
  };
}

function parseGame(raw: unknown, index: number): QuickBuildGameInput {
  const row = requireObject(raw, `games[${index}]`);
  const status = row.status;
  if (status != null && typeof status !== 'string') {
    throw new QuickBuildInputError('MALFORMED_INPUT', `games[${index}].status is invalid`);
  }
  return {
    gameId: requireString(row.gameId, `games[${index}].gameId`),
    startTime: requireString(row.startTime, `games[${index}].startTime`),
    status: status ?? null,
  };
}

function parseObservation(raw: unknown, index: number): MarketObservationInput {
  const row = requireObject(raw, `observations[${index}]`);
  const clock = row.observationClock;
  if (clock != null && clock !== 'RESPONSE_RECEIVED') {
    throw new QuickBuildInputError('MALFORMED_INPUT', `observations[${index}].observationClock is invalid`);
  }
  const odds = row.oddsAmerican;
  if (odds != null && (typeof odds !== 'number' || !Number.isFinite(odds))) {
    throw new QuickBuildInputError('MALFORMED_INPUT', `observations[${index}].oddsAmerican is invalid`);
  }
  const line = row.line;
  if (typeof line !== 'number' && typeof line !== 'string') {
    throw new QuickBuildInputError('MALFORMED_INPUT', `observations[${index}].line is invalid`);
  }
  const observedAt = row.observedAt;
  if (observedAt != null && typeof observedAt !== 'string') {
    throw new QuickBuildInputError('MALFORMED_INPUT', `observations[${index}].observedAt is invalid`);
  }
  return {
    playerId: typeof row.playerId === 'string' ? row.playerId : '',
    gameId: typeof row.gameId === 'string' ? row.gameId : '',
    market: typeof row.market === 'string' ? row.market : '',
    side: typeof row.side === 'string' ? row.side : '',
    line,
    sportsbook: typeof row.sportsbook === 'string' ? row.sportsbook : '',
    oddsAmerican: odds == null ? null : odds,
    pullRunId: typeof row.pullRunId === 'string' ? row.pullRunId : '',
    observedAt: observedAt ?? null,
    observationClock: clock == null ? null : 'RESPONSE_RECEIVED',
  };
}

export function parsePolicy(policy: QuickBuildPolicy): { asOfMs: number; maxObservationAgeMs: number | null } {
  if (policy == null || typeof policy !== 'object') {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'policy is required');
  }
  if (policy.mode !== 'research_snapshot' && policy.mode !== 'recently_observed') {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'policy.mode is invalid');
  }
  const asOfMs = parseAsOf(policy.asOf);
  if (policy.mode === 'research_snapshot') {
    return { asOfMs, maxObservationAgeMs: null };
  }
  const age = policy.maxObservationAgeMs;
  if (typeof age !== 'number' || !Number.isFinite(age) || age < 0) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'policy.maxObservationAgeMs is required for recently_observed');
  }
  return { asOfMs, maxObservationAgeMs: age };
}

function isUpcoming(game: QuickBuildGameInput, asOfMs: number): boolean {
  const start = Date.parse(game.startTime);
  if (!Number.isFinite(start) || start <= asOfMs) return false;
  return normalizeGameStatus(game.status) === 'Scheduled';
}

function newestUnsuccessfulAfter(attempts: GamePullAttempt[], success: GamePullAttempt | null): GamePullAttempt | null {
  const later = attempts.filter((attempt) => {
    if (isCompleteSuccess(attempt)) return false;
    if (success == null) return true;
    return compareAttempts(success, attempt) < 0;
  });
  if (later.length === 0) return null;
  return later.slice().sort(compareAttempts).at(-1) ?? null;
}

export function selectEligibleObservations(input: {
  policy: QuickBuildPolicy;
  games: unknown[];
  attempts: unknown[];
  observations: unknown[];
}): EligibleSelection {
  if (input.games.length > QUICK_BUILD_MAX_GAMES) {
    throw new QuickBuildInputError('LIMIT_EXCEEDED', `games exceed ${QUICK_BUILD_MAX_GAMES}`);
  }
  if (input.attempts.length > QUICK_BUILD_MAX_ATTEMPTS) {
    throw new QuickBuildInputError('LIMIT_EXCEEDED', `attempts exceed ${QUICK_BUILD_MAX_ATTEMPTS}`);
  }
  if (input.observations.length > QUICK_BUILD_MAX_OBSERVATIONS) {
    throw new QuickBuildInputError('LIMIT_EXCEEDED', `observations exceed ${QUICK_BUILD_MAX_OBSERVATIONS}`);
  }

  const { asOfMs, maxObservationAgeMs } = parsePolicy(input.policy);
  const games = input.games.map(parseGame);
  const attempts = input.attempts.map(parseAttempt);
  const observations = input.observations.map(parseObservation);
  const gameIds = new Set(games.map((game) => game.gameId));
  if (gameIds.size !== games.length) {
    throw new QuickBuildInputError('MALFORMED_INPUT', 'games contains a duplicate gameId');
  }

  const byGame = new Map<string, GamePullAttempt[]>();
  for (const attempt of attempts) {
    if (!gameIds.has(attempt.gameId)) continue;
    const list = byGame.get(attempt.gameId) ?? [];
    list.push(attempt);
    byGame.set(attempt.gameId, list);
  }

  const eligibility: GameEligibility[] = [];
  const kept: MarketObservationInput[] = [];
  let upcomingCount = 0;

  for (const game of games) {
    const upcoming = isUpcoming(game, asOfMs);
    if (!upcoming) {
      eligibility.push({
        gameId: game.gameId,
        upcoming: false,
        eligiblePullRunId: null,
        rejection: 'NOT_UPCOMING',
        newerUnsuccessfulAttempt: null,
        stalePullRunId: null,
      });
      continue;
    }
    upcomingCount += 1;
    const gameAttempts = byGame.get(game.gameId) ?? [];
    const successes = gameAttempts.filter(isCompleteSuccess).slice().sort(compareAttempts);
    const latestSuccess = successes.at(-1) ?? null;
    const newer = newestUnsuccessfulAfter(gameAttempts, latestSuccess);
    const blocking = newer == null ? null : toBlocking(newer);

    if (latestSuccess == null) {
      eligibility.push({
        gameId: game.gameId,
        upcoming: true,
        eligiblePullRunId: null,
        rejection: 'NO_COMPLETE_PULL',
        newerUnsuccessfulAttempt: blocking,
        stalePullRunId: null,
      });
      continue;
    }

    if (input.policy.mode === 'recently_observed' && blocking != null) {
      eligibility.push({
        gameId: game.gameId,
        upcoming: true,
        eligiblePullRunId: null,
        rejection: 'NEWER_UNSUCCESSFUL_ATTEMPT',
        newerUnsuccessfulAttempt: blocking,
        stalePullRunId: null,
      });
      continue;
    }

    const fresh = observations.filter((row) => {
      if (row.pullRunId !== latestSuccess.pullRunId || row.gameId !== game.gameId) return false;
      if (row.observationClock !== 'RESPONSE_RECEIVED' || row.observedAt == null) return false;
      const observedMs = Date.parse(row.observedAt);
      if (!Number.isFinite(observedMs) || observedMs > asOfMs) return false;
      if (maxObservationAgeMs == null) return true;
      return asOfMs - observedMs <= maxObservationAgeMs;
    });

    if (fresh.length === 0) {
      eligibility.push({
        gameId: game.gameId,
        upcoming: true,
        eligiblePullRunId: null,
        rejection: 'STALE_OBSERVATION',
        newerUnsuccessfulAttempt: blocking,
        stalePullRunId: latestSuccess.pullRunId,
      });
      continue;
    }

    eligibility.push({
      gameId: game.gameId,
      upcoming: true,
      eligiblePullRunId: latestSuccess.pullRunId,
      rejection: null,
      newerUnsuccessfulAttempt: blocking,
      stalePullRunId: null,
    });
    kept.push(...fresh);
  }

  return { asOfMs, maxObservationAgeMs, upcomingCount, games: eligibility, observations: kept };
}
