import { describe, expect, it } from 'vitest';
import { PLAYER_PROPS_WAVE_MAX_GAMES, selectOneGameAcquisition } from '../wave-cap';

const games = [
  { gameId: '300', bdlGameId: 300 },
  { gameId: '100', bdlGameId: 100 },
  { gameId: '200', bdlGameId: 200 },
];

describe('one-game acquisition fence', () => {
  it('caps an unscoped wave at one game by refusing the slate', () => {
    expect(PLAYER_PROPS_WAVE_MAX_GAMES).toBe(1);
    expect(selectOneGameAcquisition(games, undefined)).toEqual({ ok: false, reason: 'wave_cap' });
  });

  it('keeps a single eligible game', () => {
    expect(selectOneGameAcquisition([games[1]], undefined)).toEqual({ ok: true, games: [games[1]] });
  });

  it('selects only an explicit canonical id that is already eligible', () => {
    expect(selectOneGameAcquisition(games, '200')).toEqual({ ok: true, games: [games[2]] });
  });

  it('rejects ids that are not in the pregame set, including leading zeros and numbers', () => {
    expect(selectOneGameAcquisition(games, '999')).toEqual({ ok: false, reason: 'game_not_eligible' });
    expect(selectOneGameAcquisition(games, '0200')).toEqual({ ok: false, reason: 'invalid_game_id' });
    expect(selectOneGameAcquisition(games, 200)).toEqual({ ok: false, reason: 'invalid_game_id' });
    expect(selectOneGameAcquisition([], '100')).toEqual({ ok: false, reason: 'game_not_eligible' });
  });
});
