import { describe, expect, it } from 'vitest';
import {
  bestHitRateStrategy,
  bestSampleAdjustedStrategy,
  enrichProxySweepRow,
  strategySignal,
  summarizeStrategy,
  type ProxySweepRow,
} from '@/lib/research/proxy-strategy-sweep';

describe('proxy strategy sweep helpers', () => {
  it('enrichProxySweepRow computes missing delta features', () => {
    const row = enrichProxySweepRow({
      prior_games: 12,
      actual_points: 28,
      points_season_avg_before_game: 21,
      points_l5_avg_before_game: 24,
      minutes_l5_avg_before_game: 33,
      minutes_l10_avg_before_game: 31,
    });
    expect(row.points_l5_minus_season_avg).toBe(3);
    expect(row.minutes_l5_minus_l10_avg).toBe(2);
  });

  it('strategySignal enforces strategy thresholds', () => {
    const base: ProxySweepRow = {
      prior_games: 12,
      actual_points: 30,
      points_season_avg_before_game: 24,
      points_l5_avg_before_game: 27,
      minutes_l5_avg_before_game: 28,
      minutes_l10_avg_before_game: 26,
      points_l5_minus_season_avg: 3,
      minutes_l5_minus_l10_avg: 2,
    };
    expect(strategySignal('minutes_floor_v1', base)).toBe(true);
    expect(strategySignal('points_trend_v1', base)).toBe(true);
    expect(strategySignal('points_trend_minutes_floor_v1', base)).toBe(true);
    expect(strategySignal('points_trend_minutes_trend_v1', base)).toBe(true);
    expect(strategySignal('strong_recent_role_change_v1', base)).toBe(true);
  });

  it('strategySignal rejects when prior_games is below requirement', () => {
    const row: ProxySweepRow = {
      prior_games: 9,
      actual_points: 26,
      points_season_avg_before_game: 20,
      points_l5_avg_before_game: 24,
      minutes_l5_avg_before_game: 30,
      minutes_l10_avg_before_game: 28,
      points_l5_minus_season_avg: 4,
      minutes_l5_minus_l10_avg: 2,
    };
    expect(strategySignal('minutes_floor_v1', row)).toBe(false);
    expect(strategySignal('strong_recent_role_change_v1', row)).toBe(false);
  });

  it('summarizeStrategy computes hit rate and averages for signaled rows', () => {
    const rows: ProxySweepRow[] = [
      {
        prior_games: 12,
        actual_points: 30,
        points_season_avg_before_game: 24,
        points_l5_avg_before_game: 27,
        minutes_l5_avg_before_game: 30,
        minutes_l10_avg_before_game: 28,
        points_l5_minus_season_avg: 3,
        minutes_l5_minus_l10_avg: 2,
      },
      {
        prior_games: 15,
        actual_points: 22,
        points_season_avg_before_game: 24,
        points_l5_avg_before_game: 27,
        minutes_l5_avg_before_game: 31,
        minutes_l10_avg_before_game: 29,
        points_l5_minus_season_avg: 3,
        minutes_l5_minus_l10_avg: 2,
      },
      {
        prior_games: 8,
        actual_points: 29,
        points_season_avg_before_game: 24,
        points_l5_avg_before_game: 27,
        minutes_l5_avg_before_game: 31,
        minutes_l10_avg_before_game: 29,
        points_l5_minus_season_avg: 3,
        minutes_l5_minus_l10_avg: 2,
      },
    ];
    const out = summarizeStrategy({
      strategyName: 'strong_recent_role_change_v1',
      season: 2025,
      rows,
    });

    expect(out.total_rows).toBe(3);
    expect(out.signal_count).toBe(2);
    expect(out.target_true_count).toBe(1);
    expect(out.target_false_count).toBe(1);
    expect(out.hit_rate).toBe(0.5);
    expect(out.avg_points_over_baseline).toBe(2);
    expect(out.avg_minutes_l5).toBe(30.5);
  });

  it('best strategy helpers choose expected rows', () => {
    const base = {
      season: 2025,
      total_rows: 1000,
      target_true_count: 0,
      target_false_count: 0,
      avg_actual_points: null,
      avg_points_season_avg_before_game: null,
      avg_points_over_baseline: null,
      avg_minutes_l5: null,
      avg_points_l5_minus_season: null,
      avg_minutes_l5_minus_l10: null,
    };
    const a = {
      ...base,
      strategy_name: 'a',
      signal_count: 20,
      signal_rate: 0.02,
      target_true_count: 12,
      target_false_count: 8,
      hit_rate: 0.6,
    };
    const b = {
      ...base,
      strategy_name: 'b',
      signal_count: 150,
      signal_rate: 0.15,
      target_true_count: 84,
      target_false_count: 66,
      hit_rate: 0.56,
    };
    expect(bestHitRateStrategy([a, b])?.strategy_name).toBe('a');
    expect(bestSampleAdjustedStrategy([a, b])?.strategy_name).toBe('b');
  });
});
