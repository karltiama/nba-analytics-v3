import { describe, expect, it } from 'vitest';
import {
  aggregateBucketBreakdowns,
  aggregatePlayerSignalStats,
  assignMinutesL5Bucket,
  assignPointsSeasonAvgBucket,
  assignPriorGamesBucket,
  buildStrategyBreakdownBundle,
  detectBestWorstBuckets,
  filterSignaledRows,
  playerHitRateLeaderboard,
  playerSignalConcentration,
  renderProxyStrategyBreakdownMarkdownReport,
  type BreakdownInputRow,
} from '@/lib/research/proxy-strategy-breakdowns';

const strat = 'strong_recent_role_change_v1' as const;

function row(
  partial: Partial<BreakdownInputRow> & Pick<BreakdownInputRow, 'season' | 'player_id' | 'target_true'>
): BreakdownInputRow {
  return {
    prior_games: 12,
    minutes_l5_avg_before_game: 28,
    points_season_avg_before_game: 14,
    signals: { [strat]: true },
    ...partial,
  };
}

describe('proxy-strategy-breakdowns', () => {
  it('assigns prior games buckets', () => {
    expect(assignPriorGamesBucket(null)).toBe('unknown');
    expect(assignPriorGamesBucket(5)).toBe('lt_10');
    expect(assignPriorGamesBucket(12)).toBe('10_14');
    expect(assignPriorGamesBucket(35)).toBe('30_plus');
  });

  it('assigns minutes and season-avg buckets', () => {
    expect(assignMinutesL5Bucket(22)).toBe('20_23');
    expect(assignMinutesL5Bucket(30)).toBe('28_31');
    expect(assignPointsSeasonAvgBucket(10)).toBe('8_11');
    expect(assignPointsSeasonAvgBucket(22)).toBe('20_plus');
  });

  it('computes hit rate in bucket breakdowns', () => {
    const rows: BreakdownInputRow[] = [
      row({ season: 2025, player_id: 'a', target_true: true, signals: { [strat]: true } }),
      row({ season: 2025, player_id: 'b', target_true: false, signals: { [strat]: true } }),
      row({ season: 2025, player_id: 'c', target_true: true, signals: { [strat]: false } }),
    ];
    const bySeason = aggregateBucketBreakdowns({ rows, strategy: strat, dimension: 'season' });
    const s2025 = bySeason.find((b) => b.bucket_key === '2025');
    expect(s2025?.signal_count).toBe(2);
    expect(s2025?.hit_count).toBe(1);
    expect(s2025?.hit_rate).toBe(0.5);
  });

  it('filters leaderboard by minimum sample', () => {
    const stats = [
      { player_id: 'hot', signal_count: 3, hit_count: 3, hit_rate: 1 },
      { player_id: 'ok', signal_count: 10, hit_count: 8, hit_rate: 0.8 },
    ];
    const lb = playerHitRateLeaderboard(stats, 5);
    expect(lb.map((p) => p.player_id)).toEqual(['ok']);
  });

  it('aggregates player frequency', () => {
    const rows: BreakdownInputRow[] = [
      row({ season: 2025, player_id: 'p1', target_true: true, signals: { [strat]: true } }),
      row({ season: 2025, player_id: 'p1', target_true: true, signals: { [strat]: true } }),
      row({ season: 2025, player_id: 'p2', target_true: false, signals: { [strat]: true } }),
    ];
    const agg = aggregatePlayerSignalStats(rows, strat);
    const p1 = agg.find((p) => p.player_id === 'p1');
    expect(p1?.signal_count).toBe(2);
    expect(p1?.hit_count).toBe(2);
    expect(p1?.hit_rate).toBe(1);
  });

  it('detects best and worst bucket with min sample', () => {
    const buckets = [
      { dimension: 'season' as const, bucket_key: '2023', signal_count: 100, hit_count: 60, hit_rate: 0.6 },
      { dimension: 'season' as const, bucket_key: '2024', signal_count: 5, hit_count: 5, hit_rate: 1 },
      { dimension: 'season' as const, bucket_key: '2025', signal_count: 80, hit_count: 40, hit_rate: 0.5 },
    ];
    const { best, worst, buckets_evaluated } = detectBestWorstBuckets(buckets, 50);
    expect(buckets_evaluated).toBe(2);
    expect(best?.bucket_key).toBe('2023');
    expect(worst?.bucket_key).toBe('2025');
  });

  it('handles empty signaled rows', () => {
    const rows: BreakdownInputRow[] = [
      row({ season: 2025, player_id: 'x', target_true: true, signals: { [strat]: false } }),
    ];
    expect(filterSignaledRows(rows, strat)).toHaveLength(0);
    const bundle = buildStrategyBreakdownBundle({ rows, strategy: strat });
    expect(bundle.total_signals).toBe(0);
    expect(bundle.overall_hit_rate).toBeNull();
  });

  it('markdown includes required sections', () => {
    const md = renderProxyStrategyBreakdownMarkdownReport({
      seasons: [2023, 2024],
      strategies: ['a'],
      generatedAt: 't',
      inputPaths: ['in'],
      outputPath: 'out',
      targetDefinition: 'x > y',
      leaderboardRecap: [],
      bundles: [],
      narratives: [],
    });
    expect(md).toContain('## Executive summary');
    expect(md).toContain('## Strategy leaderboard recap');
    expect(md).toContain('## Recommended next step');
    expect(md).toContain('## Data quality warnings');
  });
});
