import { PROPS_WAVE_MAX_GAMES_CEILING } from './acquisition-budget';
import type { GameTarget } from './types';

export const PLAYER_PROPS_WAVE_MAX_GAMES_CEILING = PROPS_WAVE_MAX_GAMES_CEILING;

/** Canonical analytics.games.game_id for a BDL game: decimal digits, no leading zero. */
const CANONICAL_GAME_ID = /^[1-9][0-9]*$/;

export type WaveCapReason = 'invalid_game_id' | 'game_not_eligible';

export type WaveSelection<T> =
  | { ok: true; games: T[]; deferred: T[] }
  | { ok: false; reason: WaveCapReason };

/**
 * Missing or blank config uses the slate ceiling. A value outside 1..ceiling is refused.
 * The controller does not fall back to queueing every eligible game.
 */
export function resolveWaveMaxGames(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') return PLAYER_PROPS_WAVE_MAX_GAMES_CEILING;
  if (!/^[1-9][0-9]*$/.test(raw.trim())) {
    throw new Error(`PLAYER_PROPS_WAVE_MAX_GAMES must be an integer from 1 to ${PLAYER_PROPS_WAVE_MAX_GAMES_CEILING}`);
  }
  const value = Number(raw.trim());
  if (value > PLAYER_PROPS_WAVE_MAX_GAMES_CEILING) {
    throw new Error(`PLAYER_PROPS_WAVE_MAX_GAMES ${value} exceeds ${PLAYER_PROPS_WAVE_MAX_GAMES_CEILING}`);
  }
  return value;
}

/**
 * Queue at most `maxGames` eligible pregame targets, soonest tip first.
 * An explicit gameId must be that canonical id and must already be in the eligible set.
 * Games past the cap are deferred to a later wave. They are not a failed wave.
 */
export function selectGameWave<T extends Pick<GameTarget, 'gameId' | 'startTime'>>(
  targets: readonly T[],
  requestedGameId: unknown,
  maxGames: number
): WaveSelection<T> {
  if (!Number.isInteger(maxGames) || maxGames < 1 || maxGames > PLAYER_PROPS_WAVE_MAX_GAMES_CEILING) {
    throw new Error(`wave max games ${maxGames} is outside 1..${PLAYER_PROPS_WAVE_MAX_GAMES_CEILING}`);
  }
  const ordered = [...targets].sort(byTipThenGameId);
  const requested = requestedGameId == null || requestedGameId === '' ? null : requestedGameId;
  if (requested == null) {
    return { ok: true, games: ordered.slice(0, maxGames), deferred: ordered.slice(maxGames) };
  }
  if (typeof requested !== 'string' || !CANONICAL_GAME_ID.test(requested)) {
    return { ok: false, reason: 'invalid_game_id' };
  }
  const match = ordered.filter((target) => target.gameId === requested);
  if (match.length !== 1) return { ok: false, reason: 'game_not_eligible' };
  return { ok: true, games: match, deferred: [] };
}

function byTipThenGameId(a: Pick<GameTarget, 'gameId' | 'startTime'>, b: Pick<GameTarget, 'gameId' | 'startTime'>): number {
  const aStart = a.startTime ?? '';
  const bStart = b.startTime ?? '';
  if (aStart !== bStart) return aStart < bStart ? -1 : 1;
  if (a.gameId === b.gameId) return 0;
  return a.gameId < b.gameId ? -1 : 1;
}
