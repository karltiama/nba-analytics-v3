import { describe, expect, it } from 'vitest';
import {
  comparisonReportS3Key,
  legacyComparisonReportS3Key,
  legacySummaryReportS3Key,
  parseBacktestComparisonPayload,
  parseBacktestSummaryPayload,
  parseThresholdSweepPayload,
  summaryReportS3Key,
  thresholdSweepReportS3Key,
} from '../backtest-report-service';

describe('S3 key helpers', () => {
  it('builds summary and comparison keys with sorted seasons', () => {
    expect(summaryReportS3Key(3, 2023)).toContain('threshold=3');
    expect(summaryReportS3Key(3, 2023)).toContain('summary-season=2023');
    expect(legacySummaryReportS3Key(2023)).toBe(
      'backtests/reports/strategy=points_l5_vs_season_v1/summary-season=2023.json'
    );
    expect(comparisonReportS3Key(3, [2024, 2023])).toContain('comparison-seasons=2023-2024');
    expect(legacyComparisonReportS3Key([2024, 2023])).toBe(
      'backtests/reports/strategy=points_l5_vs_season_v1/comparison-seasons=2023-2024.json'
    );
    expect(thresholdSweepReportS3Key([2024, 2023])).toContain('threshold-sweep-seasons=2023-2024');
  });
});

describe('parseBacktestSummaryPayload', () => {
  it('accepts a minimal valid payload', () => {
    const raw = {
      generatedAt: '2026-01-01T00:00:00Z',
      reportVersion: 1,
      summary: {
        season: 2023,
        threshold: 3,
        strategyName: 'points_l5_vs_season',
        strategyVersion: 'v1',
        rowsScanned: 100,
        signalsGenerated: 10,
        signalRate: 0.1,
        wins: 5,
        losses: 4,
        pushes: 1,
        winRate: 0.5,
        averageEdge: 4,
        averageActualMargin: 1,
        skippedRows: 90,
        skippedReasons: { insufficient_prior_games: 1, missing_feature_values: 1, no_signal: 88 },
        byMonth: [],
        byPriorGamesBucket: [],
        topWinningMargins: [],
        worstLosingMargins: [],
        topEdges: [],
      },
    };
    const out = parseBacktestSummaryPayload(raw);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.summary.season).toBe(2023);
      expect(out.data.summary.threshold).toBe(3);
    }
  });

  it('rejects non-object root', () => {
    const out = parseBacktestSummaryPayload(null);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('INVALID_JSON');
  });
});

describe('parseBacktestComparisonPayload', () => {
  it('accepts minimal comparison', () => {
    const raw = {
      generatedAt: 't',
      reportVersion: 1,
      comparison: {
        strategyName: 'points_l5_vs_season',
        strategyVersion: 'v1',
        seasons: [2023, 2024],
        perSeason: [],
      },
    };
    const out = parseBacktestComparisonPayload(raw);
    expect(out.ok).toBe(true);
  });
});

describe('parseThresholdSweepPayload', () => {
  it('accepts minimal sweep', () => {
    const raw = {
      generatedAt: 't',
      reportVersion: 1,
      sweep: {
        strategyName: 'points_l5_vs_season',
        strategyVersion: 'v1',
        seasons: [2023, 2024],
        thresholds: [3],
        rows: [],
        bestThresholdByWinRate: null,
        bestThresholdBySampleAdjustedWinRate: null,
      },
    };
    const out = parseThresholdSweepPayload(raw);
    expect(out.ok).toBe(true);
  });
});
