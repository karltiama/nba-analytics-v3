import { describe, expect, it } from 'vitest';
import {
  buildProxyStrategyComparison,
  calculateHitRateRange,
  calculateSimpleAvgHitRate,
  calculateWeightedHitRate,
  rankComparedStrategies,
  renderProxyStrategyComparisonMarkdownReport,
  type PerSeasonStrategyRow,
} from '@/lib/research/proxy-strategy-comparison';

describe('proxy-strategy-comparison helpers', () => {
  it('calculates weighted hit rate correctly', () => {
    const rows: PerSeasonStrategyRow[] = [
      {
        season: 2023,
        strategy_name: 's1',
        signal_count: 100,
        hit_rate: 0.6,
        avg_points_over_baseline: 1.2,
        signal_rate: 0.1,
      },
      {
        season: 2024,
        strategy_name: 's1',
        signal_count: 300,
        hit_rate: 0.5,
        avg_points_over_baseline: 1.1,
        signal_rate: 0.2,
      },
    ];
    expect(calculateWeightedHitRate(rows)).toBe(0.525);
  });

  it('calculates simple average hit rate correctly', () => {
    const rows: PerSeasonStrategyRow[] = [
      { season: 2023, strategy_name: 's1', signal_count: 10, hit_rate: 0.6, avg_points_over_baseline: 1, signal_rate: 0.1 },
      { season: 2024, strategy_name: 's1', signal_count: 10, hit_rate: 0.4, avg_points_over_baseline: 1, signal_rate: 0.1 },
      { season: 2025, strategy_name: 's1', signal_count: 10, hit_rate: 0.5, avg_points_over_baseline: 1, signal_rate: 0.1 },
    ];
    expect(calculateSimpleAvgHitRate(rows)).toBe(0.5);
  });

  it('calculates min/max/range correctly', () => {
    const rows: PerSeasonStrategyRow[] = [
      { season: 2023, strategy_name: 's1', signal_count: 10, hit_rate: 0.62, avg_points_over_baseline: 1, signal_rate: 0.1 },
      { season: 2024, strategy_name: 's1', signal_count: 10, hit_rate: 0.55, avg_points_over_baseline: 1, signal_rate: 0.1 },
      { season: 2025, strategy_name: 's1', signal_count: 10, hit_rate: 0.70, avg_points_over_baseline: 1, signal_rate: 0.1 },
    ];
    const out = calculateHitRateRange(rows);
    expect(out.min_hit_rate).toBe(0.55);
    expect(out.max_hit_rate).toBe(0.7);
    expect(out.hit_rate_range).toBeCloseTo(0.15, 9);
  });

  it('ranks strategies by weighted hit rate then signal count then lower range', () => {
    const ranked = rankComparedStrategies([
      {
        strategy_name: 'a',
        seasons_included: [2023, 2024],
        total_signal_count: 100,
        weighted_hit_rate: 0.62,
        simple_avg_hit_rate: 0.62,
        min_hit_rate: 0.61,
        max_hit_rate: 0.63,
        hit_rate_range: 0.02,
        avg_signal_count_per_season: 50,
        min_signal_count: 40,
        max_signal_count: 60,
        weighted_avg_points_over_baseline: 2,
        best_season: 2024,
        worst_season: 2023,
      },
      {
        strategy_name: 'b',
        seasons_included: [2023, 2024],
        total_signal_count: 300,
        weighted_hit_rate: 0.62,
        simple_avg_hit_rate: 0.62,
        min_hit_rate: 0.6,
        max_hit_rate: 0.64,
        hit_rate_range: 0.04,
        avg_signal_count_per_season: 150,
        min_signal_count: 140,
        max_signal_count: 160,
        weighted_avg_points_over_baseline: 2,
        best_season: 2024,
        worst_season: 2023,
      },
      {
        strategy_name: 'c',
        seasons_included: [2023, 2024],
        total_signal_count: 200,
        weighted_hit_rate: 0.60,
        simple_avg_hit_rate: 0.60,
        min_hit_rate: 0.58,
        max_hit_rate: 0.62,
        hit_rate_range: 0.04,
        avg_signal_count_per_season: 100,
        min_signal_count: 90,
        max_signal_count: 110,
        weighted_avg_points_over_baseline: 2,
        best_season: 2024,
        worst_season: 2023,
      },
    ]);
    expect(ranked.map((r) => r.strategy_name)).toEqual(['b', 'a', 'c']);
    expect(ranked[0].rank).toBe(1);
  });

  it('handles missing seasons while building comparison', () => {
    const built = buildProxyStrategyComparison({
      requestedSeasons: [2023, 2024, 2025],
      availablePayloads: [
        {
          season: 2023,
          target_definition: 't',
          generated_at: 'now',
          input_path: 'in',
          output_path: 'out',
          total_rows: 100,
          strategies: [
            {
              strategy_name: 'x',
              season: 2023,
              total_rows: 100,
              signal_count: 10,
              signal_rate: 0.1,
              target_true_count: 6,
              target_false_count: 4,
              hit_rate: 0.6,
              avg_actual_points: 1,
              avg_points_season_avg_before_game: 1,
              avg_points_over_baseline: 1,
              avg_minutes_l5: 1,
              avg_points_l5_minus_season: 1,
              avg_minutes_l5_minus_l10: 1,
            },
          ],
        },
      ],
    });
    expect(built.included_seasons).toEqual([2023]);
    expect(built.missing_seasons).toEqual([2024, 2025]);
  });

  it('markdown rendering includes required sections', () => {
    const md = renderProxyStrategyComparisonMarkdownReport({
      seasons: [2023, 2024, 2025],
      targetDefinition: 'actual_points > points_season_avg_before_game',
      generatedAt: '2026-05-01T00:00:00.000Z',
      inputPaths: ['a', 'b'],
      outputPath: 'out',
      missingSeasons: [2025],
      strategySummary: [],
      perSeasonRows: [],
    });
    expect(md).toContain('# Player Points Proxy Strategy Multi-Season Comparison');
    expect(md).toContain('## 1. Cross-Season Strategy Summary');
    expect(md).toContain('## 2. Per-Season Results');
    expect(md).toContain('## 3. Most Stable Strategies');
    expect(md).toContain('## 4. Highest Hit Rate Strategies');
    expect(md).toContain('## 5. Interpretation Notes');
    expect(md).toContain('## 6. Data Quality Warnings');
  });
});
