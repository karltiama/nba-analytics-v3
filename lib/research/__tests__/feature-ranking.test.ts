import { describe, expect, it } from 'vitest';
import {
  buildProxyTarget,
  computeDeltaFeatures,
  rankFeatureScores,
  scoreFeature,
} from '@/lib/research/feature-ranking';

describe('feature-ranking helpers', () => {
  it('buildProxyTarget returns true when actual_points > points_season_avg_before_game', () => {
    const out = buildProxyTarget({
      actual_points: 25,
      points_season_avg_before_game: 22,
    });
    expect(out).toBe(true);
  });

  it('buildProxyTarget returns false when actual_points <= points_season_avg_before_game', () => {
    const equalCase = buildProxyTarget({
      actual_points: 22,
      points_season_avg_before_game: 22,
    });
    const lessCase = buildProxyTarget({
      actual_points: 19,
      points_season_avg_before_game: 22,
    });
    expect(equalCase).toBe(false);
    expect(lessCase).toBe(false);
  });

  it('scoreFeature calculates target-conditional means correctly', () => {
    const rows = [
      { target_score_above_season_avg: true, f: 10 },
      { target_score_above_season_avg: true, f: 14 },
      { target_score_above_season_avg: false, f: 4 },
      { target_score_above_season_avg: false, f: 6 },
    ];

    const scored = scoreFeature(rows, 'f');
    expect(scored.mean_when_target_true).toBe(12);
    expect(scored.mean_when_target_false).toBe(5);
    expect(scored.mean_difference).toBe(7);
    expect(scored.abs_mean_difference).toBe(7);
  });

  it('scoreFeature excludes null feature values from sample for that feature', () => {
    const rows = [
      { target_score_above_season_avg: true, f: 10 },
      { target_score_above_season_avg: false, f: null },
      { target_score_above_season_avg: false, f: 5 },
      { target_score_above_season_avg: true, f: undefined },
    ];

    const scored = scoreFeature(rows, 'f');
    expect(scored.sample_size).toBe(2);
    expect(scored.null_count).toBe(2);
    expect(scored.target_true_count).toBe(1);
    expect(scored.target_false_count).toBe(1);
  });

  it('rankFeatureScores orders by abs_mean_difference descending', () => {
    const ranked = rankFeatureScores([
      {
        feature_name: 'b',
        sample_size: 10,
        null_count: 0,
        null_rate: 0,
        target_true_count: 5,
        target_false_count: 5,
        mean_when_target_true: 4,
        mean_when_target_false: 2,
        mean_difference: 2,
        abs_mean_difference: 2,
        simple_correlation_with_target: 0.1,
      },
      {
        feature_name: 'a',
        sample_size: 10,
        null_count: 0,
        null_rate: 0,
        target_true_count: 5,
        target_false_count: 5,
        mean_when_target_true: 8,
        mean_when_target_false: 2,
        mean_difference: 6,
        abs_mean_difference: 6,
        simple_correlation_with_target: 0.2,
      },
    ]);

    expect(ranked[0].feature_name).toBe('a');
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].feature_name).toBe('b');
    expect(ranked[1].rank).toBe(2);
  });

  it('computeDeltaFeatures calculates requested deltas correctly', () => {
    const deltas = computeDeltaFeatures({
      points_l5_avg_before_game: 24,
      points_l10_avg_before_game: 21,
      points_season_avg_before_game: 19,
      minutes_l5_avg_before_game: 34,
      minutes_l10_avg_before_game: 31,
    });

    expect(deltas.points_l5_minus_season_avg).toBe(5);
    expect(deltas.points_l10_minus_season_avg).toBe(2);
    expect(deltas.minutes_l5_minus_l10_avg).toBe(3);
  });
});
