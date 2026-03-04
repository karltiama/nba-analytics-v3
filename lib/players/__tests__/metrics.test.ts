import { describe, it, expect } from 'vitest';
import {
  extractMetric,
  getSeasonAvgForMetric,
  hitRate,
  avgMargin,
  streak,
  rollingAvg,
  summaryStats,
} from '../metrics';
import type { GameLog } from '../types';

function makeGame(overrides: Partial<GameLog> = {}): GameLog {
  return {
    game_id: 'g1',
    game_date: '2025-01-01',
    start_time: '2025-01-01T00:00:00Z',
    season: '2024-25',
    team_id: 't1',
    team_abbr: 'LAL',
    team_name: 'Los Angeles Lakers',
    opponent_id: 't2',
    opponent_abbr: 'BOS',
    opponent_name: 'Boston Celtics',
    location: 'home',
    result: 'W',
    team_score: 110,
    opponent_score: 100,
    minutes: 34,
    points: 25,
    rebounds: 8,
    assists: 6,
    steals: 2,
    blocks: 1,
    turnovers: 3,
    field_goals_made: 10,
    field_goals_attempted: 20,
    three_pointers_made: 3,
    three_pointers_attempted: 7,
    free_throws_made: 2,
    free_throws_attempted: 3,
    plus_minus: 10,
    started: true,
    dnp_reason: null,
    offensive_rebounds: 2,
    defensive_rebounds: 6,
    personal_fouls: 3,
    ...overrides,
  };
}

// ---------- extractMetric ----------

describe('extractMetric', () => {
  const games = [
    makeGame({ points: 30, rebounds: 10, assists: 8, three_pointers_made: 5 }),
    makeGame({ points: 20, rebounds: 5, assists: 3, three_pointers_made: 1 }),
    makeGame({ points: 25, rebounds: 7, assists: 6, three_pointers_made: 3 }),
  ];

  it('extracts pts', () => {
    expect(extractMetric(games, 'pts')).toEqual([30, 20, 25]);
  });

  it('extracts reb', () => {
    expect(extractMetric(games, 'reb')).toEqual([10, 5, 7]);
  });

  it('extracts ast', () => {
    expect(extractMetric(games, 'ast')).toEqual([8, 3, 6]);
  });

  it('extracts 3pm', () => {
    expect(extractMetric(games, '3pm')).toEqual([5, 1, 3]);
  });

  it('extracts pra (pts + reb + ast)', () => {
    expect(extractMetric(games, 'pra')).toEqual([48, 28, 38]);
  });

  it('returns 0 for null values', () => {
    const nullGames = [makeGame({ points: null, rebounds: null, assists: null })];
    expect(extractMetric(nullGames, 'pts')).toEqual([0]);
    expect(extractMetric(nullGames, 'pra')).toEqual([0]);
  });

  it('returns empty array for empty games', () => {
    expect(extractMetric([], 'pts')).toEqual([]);
  });
});

// ---------- getSeasonAvgForMetric ----------

describe('getSeasonAvgForMetric', () => {
  const seasonAvg = {
    avg_points: 24.5,
    avg_rebounds: 7.2,
    avg_assists: 5.8,
    total_3pm: 150,
    games_active: 60,
  };

  it('returns pts avg', () => {
    expect(getSeasonAvgForMetric(seasonAvg, 'pts')).toBe(24.5);
  });

  it('returns reb avg', () => {
    expect(getSeasonAvgForMetric(seasonAvg, 'reb')).toBe(7.2);
  });

  it('returns ast avg', () => {
    expect(getSeasonAvgForMetric(seasonAvg, 'ast')).toBe(5.8);
  });

  it('computes 3pm avg from total/gp', () => {
    expect(getSeasonAvgForMetric(seasonAvg, '3pm')).toBe(2.5);
  });

  it('computes pra as sum of pts + reb + ast', () => {
    expect(getSeasonAvgForMetric(seasonAvg, 'pra')).toBeCloseTo(37.5);
  });

  it('handles zero games for 3pm', () => {
    expect(getSeasonAvgForMetric({ ...seasonAvg, games_active: 0 }, '3pm')).toBe(0);
  });
});

// ---------- hitRate ----------

describe('hitRate', () => {
  it('computes hit rates correctly', () => {
    const values = [30, 25, 20, 28, 22, 35, 18, 27, 24, 31, 19, 26, 23, 29, 21, 33, 17, 28, 24, 30];
    const result = hitRate(values, 24.5);

    const last10 = values.slice(0, 10);
    const expectedL10 = (last10.filter(v => v > 24.5).length / 10) * 100;
    expect(result.last10).toBe(expectedL10);

    const expectedL20 = (values.filter(v => v > 24.5).length / 20) * 100;
    expect(result.last20).toBe(expectedL20);
  });

  it('returns 0 for empty array', () => {
    expect(hitRate([], 20)).toEqual({ last10: 0, last20: 0 });
  });

  it('returns 100 when all values over line', () => {
    const values = [30, 31, 32, 33, 34];
    const result = hitRate(values, 20);
    expect(result.last10).toBe(100);
    expect(result.last20).toBe(100);
  });

  it('returns 0 when all values under line', () => {
    const values = [10, 11, 12, 13];
    const result = hitRate(values, 20);
    expect(result.last10).toBe(0);
    expect(result.last20).toBe(0);
  });

  it('excludes exact line (over means strictly greater)', () => {
    const values = [20, 20, 20];
    const result = hitRate(values, 20);
    expect(result.last10).toBe(0);
  });

  it('handles fewer than 10 games', () => {
    const values = [25, 30];
    const result = hitRate(values, 24);
    expect(result.last10).toBe(100);
    expect(result.last20).toBe(100);
  });
});

// ---------- avgMargin ----------

describe('avgMargin', () => {
  it('computes positive margin when values are above line', () => {
    const values = [30, 28, 26];
    expect(avgMargin(values, 25)).toBeCloseTo(3);
  });

  it('computes negative margin when values are below line', () => {
    const values = [20, 22, 18];
    expect(avgMargin(values, 25)).toBeCloseTo(-5);
  });

  it('returns 0 for empty array', () => {
    expect(avgMargin([], 25)).toBe(0);
  });

  it('handles mixed values', () => {
    const values = [30, 20];
    expect(avgMargin(values, 25)).toBe(0);
  });
});

// ---------- streak ----------

describe('streak', () => {
  it('finds an over streak', () => {
    const values = [30, 28, 26, 20, 18];
    const result = streak(values, 25);
    expect(result).toEqual({ count: 3, type: 'over' });
  });

  it('finds an under streak', () => {
    const values = [20, 22, 18, 30, 28];
    const result = streak(values, 25);
    expect(result).toEqual({ count: 3, type: 'under' });
  });

  it('returns count 1 for single game over', () => {
    const values = [30, 20];
    const result = streak(values, 25);
    expect(result).toEqual({ count: 1, type: 'over' });
  });

  it('returns count 0 for empty array', () => {
    const result = streak([], 25);
    expect(result).toEqual({ count: 0, type: 'over' });
  });

  it('counts all games when entire array is over', () => {
    const values = [30, 28, 26];
    const result = streak(values, 20);
    expect(result).toEqual({ count: 3, type: 'over' });
  });

  it('treats exact line value as under', () => {
    const values = [25, 25, 30];
    const result = streak(values, 25);
    expect(result).toEqual({ count: 2, type: 'under' });
  });
});

// ---------- rollingAvg ----------

describe('rollingAvg', () => {
  it('computes rolling average with window 3', () => {
    const values = [10, 20, 30, 40, 50];
    const result = rollingAvg(values, 3);
    expect(result[0]).toBeCloseTo(10);
    expect(result[1]).toBeCloseTo(15);
    expect(result[2]).toBeCloseTo(20);
    expect(result[3]).toBeCloseTo(30);
    expect(result[4]).toBeCloseTo(40);
  });

  it('window 1 returns the values themselves', () => {
    const values = [5, 10, 15];
    expect(rollingAvg(values, 1)).toEqual([5, 10, 15]);
  });

  it('returns empty for empty input', () => {
    expect(rollingAvg([], 3)).toEqual([]);
  });

  it('returns empty for window 0', () => {
    expect(rollingAvg([1, 2, 3], 0)).toEqual([]);
  });

  it('handles window larger than array', () => {
    const values = [10, 20];
    const result = rollingAvg(values, 5);
    expect(result[0]).toBeCloseTo(10);
    expect(result[1]).toBeCloseTo(15);
  });
});

// ---------- summaryStats ----------

describe('summaryStats', () => {
  it('computes all summary stats', () => {
    const values = [30, 25, 20, 28, 22, 35, 18, 27, 24, 31, 19, 26];
    const result = summaryStats(values);

    const expectedAvg = values.reduce((a, b) => a + b, 0) / values.length;
    expect(result.avg).toBeCloseTo(expectedAvg);

    const l5 = values.slice(0, 5);
    expect(result.last5).toBeCloseTo(l5.reduce((a, b) => a + b, 0) / 5);

    const l10 = values.slice(0, 10);
    expect(result.last10).toBeCloseTo(l10.reduce((a, b) => a + b, 0) / 10);

    expect(result.high).toBe(35);
    expect(result.low).toBe(18);
  });

  it('handles empty array', () => {
    const result = summaryStats([]);
    expect(result).toEqual({ avg: 0, last5: 0, last10: 0, high: 0, low: 0 });
  });

  it('handles single value', () => {
    const result = summaryStats([42]);
    expect(result.avg).toBe(42);
    expect(result.last5).toBe(42);
    expect(result.last10).toBe(42);
    expect(result.high).toBe(42);
    expect(result.low).toBe(42);
  });

  it('handles fewer than 5 values', () => {
    const values = [10, 20, 30];
    const result = summaryStats(values);
    expect(result.last5).toBeCloseTo(20);
    expect(result.last10).toBeCloseTo(20);
  });
});
