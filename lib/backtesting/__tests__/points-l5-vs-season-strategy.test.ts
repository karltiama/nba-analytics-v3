import { describe, expect, it } from 'vitest';
import {
  evaluatePointsL5VsSeasonSignal,
  gradeOverPointsSignal,
  STRATEGY_NAME,
  STRATEGY_VERSION,
} from '../points-l5-vs-season-strategy';

const baseRow = {
  season: '2023',
  player_id: 'p1',
  game_id: 'g1',
  game_date: '2023-11-01',
  prior_games: 5,
  points_season_avg_before_game: 20,
  points_l5_avg_before_game: 24,
  actual_points: 25 as number | null,
};

describe('evaluatePointsL5VsSeasonSignal', () => {
  it('returns null when prior_games < minPriorGames', () => {
    expect(
      evaluatePointsL5VsSeasonSignal({
        row: { ...baseRow, prior_games: 4 },
        config: { season: 2023, threshold: 3, minPriorGames: 5 },
      })
    ).toBeNull();
  });

  it('returns null when season avg is null', () => {
    expect(
      evaluatePointsL5VsSeasonSignal({
        row: { ...baseRow, points_season_avg_before_game: null },
        config: { season: 2023, threshold: 3, minPriorGames: 5 },
      })
    ).toBeNull();
  });

  it('returns null when L5 avg is null', () => {
    expect(
      evaluatePointsL5VsSeasonSignal({
        row: { ...baseRow, points_l5_avg_before_game: null },
        config: { season: 2023, threshold: 3, minPriorGames: 5 },
      })
    ).toBeNull();
  });

  it('returns null when edge < threshold', () => {
    expect(
      evaluatePointsL5VsSeasonSignal({
        row: { ...baseRow, points_l5_avg_before_game: 22 },
        config: { season: 2023, threshold: 3, minPriorGames: 5 },
      })
    ).toBeNull();
  });

  it('emits OVER_POINTS when edge >= threshold (default 3)', () => {
    const s = evaluatePointsL5VsSeasonSignal({
      row: baseRow,
      config: { season: 2023, threshold: 3, minPriorGames: 5 },
    });
    expect(s).not.toBeNull();
    expect(s!.signalType).toBe('OVER_POINTS');
    expect(s!.syntheticLine).toBe(20);
    expect(s!.edge).toBe(4);
    expect(s!.strategyName).toBe(STRATEGY_NAME);
    expect(s!.strategyVersion).toBe(STRATEGY_VERSION);
  });

  it('accepts edge exactly at threshold', () => {
    const s = evaluatePointsL5VsSeasonSignal({
      row: { ...baseRow, points_l5_avg_before_game: 23 },
      config: { season: 2023, threshold: 3, minPriorGames: 5 },
    });
    expect(s).not.toBeNull();
    expect(s!.edge).toBe(3);
  });
});

describe('gradeOverPointsSignal', () => {
  const signal = evaluatePointsL5VsSeasonSignal({
    row: baseRow,
    config: { season: 2023, threshold: 3, minPriorGames: 5 },
  })!;

  it('wins when actual > synthetic line', () => {
    expect(gradeOverPointsSignal(signal, 21)).toBe('win');
  });

  it('loses when actual < synthetic line', () => {
    expect(gradeOverPointsSignal(signal, 19)).toBe('loss');
  });

  it('pushes when actual === synthetic line', () => {
    expect(gradeOverPointsSignal(signal, 20)).toBe('push');
  });
});
