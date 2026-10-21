import { describe, expect, it } from 'vitest';
import { propsFullSlateBudget, propsRequestBudget } from '../acquisition-budget';
import { PLAYER_PROPS_MAX_HTTP_ATTEMPTS, PROPS_DAILY_HTTP_ATTEMPT_CAP } from '../attempt-budget';
import { controllerCoverageMetric } from '../market-outcome';
import { resolveWaveMaxGames, selectGameWave } from '../wave-cap';

const games = [
  { gameId: '300', bdlGameId: 300, startTime: '2026-10-21T23:30:00.000Z' },
  { gameId: '100', bdlGameId: 100, startTime: '2026-10-21T23:00:00.000Z' },
  { gameId: '200', bdlGameId: 200, startTime: '2026-10-21T23:15:00.000Z' },
];

describe('bounded game wave', () => {
  it('uses the 15-game ceiling when the setting is absent and refuses a larger setting', () => {
    expect(resolveWaveMaxGames(undefined)).toBe(15);
    expect(resolveWaveMaxGames('')).toBe(15);
    expect(resolveWaveMaxGames('2')).toBe(2);
    expect(() => resolveWaveMaxGames('16')).toThrow(/exceeds 15/);
    expect(() => resolveWaveMaxGames('0')).toThrow(/1 to 15/);
  });

  it('keeps the soonest games and defers the rest', () => {
    expect(selectGameWave(games, undefined, 2)).toEqual({
      ok: true,
      games: [games[1], games[2]],
      deferred: [games[0]],
    });
  });

  it('keeps a single eligible game', () => {
    expect(selectGameWave([games[1]], undefined, 15)).toEqual({ ok: true, games: [games[1]], deferred: [] });
  });

  it('selects only an explicit canonical id that is already eligible', () => {
    expect(selectGameWave(games, '200', 1)).toEqual({ ok: true, games: [games[2]], deferred: [] });
  });

  it('rejects ids that are not in the pregame set, including leading zeros and numbers', () => {
    expect(selectGameWave(games, '999', 15)).toEqual({ ok: false, reason: 'game_not_eligible' });
    expect(selectGameWave(games, '0200', 15)).toEqual({ ok: false, reason: 'invalid_game_id' });
    expect(selectGameWave(games, 200, 15)).toEqual({ ok: false, reason: 'invalid_game_id' });
    expect(selectGameWave([], '100', 15)).toEqual({ ok: false, reason: 'game_not_eligible' });
  });
});

describe('props request budget', () => {
  it('plans three pages per collection and keeps the 10-attempt pull cap', () => {
    const one = propsRequestBudget(1);
    expect(one.collectionsPerGame).toBe(5);
    expect(one.expectedRequests).toBe(15);
    expect(one.hardRequests).toBe(50);
    expect(PLAYER_PROPS_MAX_HTTP_ATTEMPTS).toBe(10);
    const slate = propsFullSlateBudget();
    expect(slate.games).toBe(15);
    expect(slate.expectedRequests).toBe(225);
    expect(slate.hardRequests).toBe(750);
    expect(slate.hardRequests).toBeGreaterThan(slate.games * slate.collectionsPerGame);
    expect(PROPS_DAILY_HTTP_ATTEMPT_CAP).toBe(300);
    expect(PROPS_DAILY_HTTP_ATTEMPT_CAP).toBeGreaterThan(slate.expectedRequests);
    expect(PROPS_DAILY_HTTP_ATTEMPT_CAP).toBeLessThan(slate.hardRequests);
  });
});

describe('near-tip coverage metric', () => {
  it('does not emit when no game was eligible or every eligible game was already claimed', () => {
    expect(controllerCoverageMetric({ eligibleGames: 0, queuedGames: 0, dedupedGames: 0 })).toBeNull();
    expect(controllerCoverageMetric({ eligibleGames: 2, queuedGames: 0, dedupedGames: 2 })).toBeNull();
  });

  it('emits a zero only when eligible games were neither queued nor deduped', () => {
    expect(controllerCoverageMetric({ eligibleGames: 4, queuedGames: 0, dedupedGames: 0 })).toEqual({
      GamesTargeted: 4,
      GamesQueued: 0,
      GamesDeduped: 0,
    });
    expect(controllerCoverageMetric({ eligibleGames: 4, queuedGames: 3, dedupedGames: 1 })).toEqual({
      GamesTargeted: 4,
      GamesQueued: 3,
      GamesDeduped: 1,
    });
  });
});
