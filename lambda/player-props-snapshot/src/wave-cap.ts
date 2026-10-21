import type { GameTarget } from './types';

/** One game per controller wave. A higher cap is a separate reviewed change. */
export const PLAYER_PROPS_WAVE_MAX_GAMES = 1;

/** Canonical analytics.games.game_id for a BDL game: decimal digits, no leading zero. */
const CANONICAL_GAME_ID = /^[1-9][0-9]*$/;

export type WaveCapReason = 'invalid_game_id' | 'game_not_eligible' | 'wave_cap';

export type WaveSelection<T> =
  | { ok: true; games: T[] }
  | { ok: false; reason: WaveCapReason };

/**
 * At most one eligible pregame target.
 * An explicit gameId must be that canonical id and must already be in the eligible set.
 * With no gameId, more than one eligible game is refused. Nothing is chosen implicitly.
 */
export function selectOneGameAcquisition<T extends Pick<GameTarget, 'gameId'>>(
  targets: readonly T[],
  requestedGameId: unknown
): WaveSelection<T> {
  const ordered = [...targets].sort((a, b) => (a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0));
  const requested = requestedGameId == null || requestedGameId === '' ? null : requestedGameId;
  if (requested == null) {
    if (ordered.length > PLAYER_PROPS_WAVE_MAX_GAMES) return { ok: false, reason: 'wave_cap' };
    return { ok: true, games: ordered };
  }
  if (typeof requested !== 'string' || !CANONICAL_GAME_ID.test(requested)) {
    return { ok: false, reason: 'invalid_game_id' };
  }
  const match = ordered.filter((target) => target.gameId === requested);
  if (match.length !== 1) return { ok: false, reason: 'game_not_eligible' };
  return { ok: true, games: match };
}
