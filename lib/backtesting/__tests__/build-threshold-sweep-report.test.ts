import { describe, expect, it } from 'vitest';
import type { BacktestReportSummary } from '../backtest-report-types';
import {
  buildThresholdSweepReport,
  formatThresholdSweepMarkdown,
} from '../build-threshold-sweep-report';
import type { ThresholdSweepConfig } from '../backtest-threshold-sweep-types';

const baseConfig = (): ThresholdSweepConfig => ({
  strategyName: 'points_l5_vs_season',
  strategyVersion: 'v1',
  seasons: [2023, 2024],
  thresholds: [1, 2, 3],
});

function sum(
  over: Partial<BacktestReportSummary> & Pick<BacktestReportSummary, 'season' | 'threshold'>
): BacktestReportSummary {
  return {
    season: over.season,
    strategyName: 'points_l5_vs_season',
    strategyVersion: 'v1',
    threshold: over.threshold,
    rowsScanned: over.rowsScanned ?? 100,
    signalsGenerated: over.signalsGenerated ?? 10,
    signalRate: over.signalRate ?? 0.1,
    wins: over.wins ?? 5,
    losses: over.losses ?? 4,
    pushes: over.pushes ?? 1,
    winRate: over.winRate ?? 0.5,
    averageEdge: over.averageEdge ?? 4,
    averageActualMargin: over.averageActualMargin ?? 1,
    skippedRows: over.skippedRows ?? 90,
    skippedReasons: over.skippedReasons ?? {
      insufficient_prior_games: 1,
      missing_feature_values: 1,
      no_signal: 88,
    },
    byMonth: over.byMonth ?? [],
    byPriorGamesBucket: over.byPriorGamesBucket ?? [],
    topWinningMargins: over.topWinningMargins ?? [],
    worstLosingMargins: over.worstLosingMargins ?? [],
    topEdges: over.topEdges ?? [],
  };
}

describe('buildThresholdSweepReport', () => {
  it('aggregates totals and signalRate across seasons', () => {
    const sweep = buildThresholdSweepReport({
      config: baseConfig(),
      summaries: [
        { threshold: 3, summary: sum({ season: 2023, threshold: 3, rowsScanned: 100, signalsGenerated: 10 }) },
        { threshold: 3, summary: sum({ season: 2024, threshold: 3, rowsScanned: 200, signalsGenerated: 20 }) },
      ],
    });
    const row = sweep.rows[0];
    expect(row.threshold).toBe(3);
    expect(row.totalRowsScanned).toBe(300);
    expect(row.totalSignalsGenerated).toBe(30);
    expect(row.signalRate).toBeCloseTo(0.1);
    expect(row.wins).toBe(10);
    expect(row.losses).toBe(8);
    expect(row.pushes).toBe(2);
  });

  it('computes pooled winRate from aggregated wins / signals', () => {
    const sweep = buildThresholdSweepReport({
      config: baseConfig(),
      summaries: [
        {
          threshold: 2,
          summary: sum({
            season: 2023,
            threshold: 2,
            rowsScanned: 50,
            signalsGenerated: 10,
            wins: 7,
            losses: 3,
            pushes: 0,
            winRate: 0.7,
          }),
        },
        {
          threshold: 2,
          summary: sum({
            season: 2024,
            threshold: 2,
            rowsScanned: 50,
            signalsGenerated: 10,
            wins: 3,
            losses: 7,
            pushes: 0,
            winRate: 0.3,
          }),
        },
      ],
    });
    expect(sweep.rows[0].winRate).toBeCloseTo(0.5);
    expect(sweep.rows[0].minSeasonWinRate).toBeCloseTo(0.3);
    expect(sweep.rows[0].maxSeasonWinRate).toBeCloseTo(0.7);
  });

  it('weights averageEdge and averageActualMargin by signals per season', () => {
    const sweep = buildThresholdSweepReport({
      config: baseConfig(),
      summaries: [
        {
          threshold: 1,
          summary: sum({
            season: 2023,
            threshold: 1,
            signalsGenerated: 10,
            averageEdge: 2,
            averageActualMargin: 1,
          }),
        },
        {
          threshold: 1,
          summary: sum({
            season: 2024,
            threshold: 1,
            signalsGenerated: 20,
            averageEdge: 5,
            averageActualMargin: 3,
          }),
        },
      ],
    });
    expect(sweep.rows[0].averageEdge).toBeCloseTo((2 * 10 + 5 * 20) / 30);
    expect(sweep.rows[0].averageActualMargin).toBeCloseTo((1 * 10 + 3 * 20) / 30);
  });

  it('orders rows by threshold ascending regardless of input order', () => {
    const sweep = buildThresholdSweepReport({
      config: baseConfig(),
      summaries: [
        { threshold: 3, summary: sum({ season: 2023, threshold: 3, signalsGenerated: 10 }) },
        { threshold: 1, summary: sum({ season: 2023, threshold: 1, signalsGenerated: 10 }) },
        { threshold: 2, summary: sum({ season: 2023, threshold: 2, signalsGenerated: 10 }) },
      ],
    });
    expect(sweep.rows.map((r) => r.threshold)).toEqual([1, 2, 3]);
  });

  it('adds low-sample warning when aggregate signals < 200', () => {
    const sweep = buildThresholdSweepReport({
      config: baseConfig(),
      summaries: [
        {
          threshold: 8,
          summary: sum({
            season: 2023,
            threshold: 8,
            signalsGenerated: 50,
            rowsScanned: 1000,
          }),
        },
      ],
    });
    expect(sweep.rows[0].warnings.some((w) => w.includes('Low aggregate sample'))).toBe(true);
  });

  it('picks best raw win rate with tie-break lower threshold', () => {
    const sweep = buildThresholdSweepReport({
      config: baseConfig(),
      summaries: [
        { threshold: 2, summary: sum({ season: 2023, threshold: 2, winRate: 0.6, wins: 6, losses: 4, pushes: 0, signalsGenerated: 10 }) },
        { threshold: 5, summary: sum({ season: 2023, threshold: 5, winRate: 0.6, wins: 6, losses: 4, pushes: 0, signalsGenerated: 10 }) },
      ],
    });
    expect(sweep.bestThresholdByWinRate).toBe(2);
  });

  it('picks best sample-adjusted win rate with tie-break lower threshold', () => {
    const sweep = buildThresholdSweepReport({
      config: baseConfig(),
      summaries: [
        { threshold: 4, summary: sum({ season: 2023, threshold: 4, wins: 5, losses: 5, pushes: 0, signalsGenerated: 10 }) },
        { threshold: 6, summary: sum({ season: 2023, threshold: 6, wins: 5, losses: 5, pushes: 0, signalsGenerated: 10 }) },
      ],
    });
    expect(sweep.rows[0].sampleAdjustedWinRate).toBeCloseTo(6 / 12);
    expect(sweep.rows[1].sampleAdjustedWinRate).toBeCloseTo(6 / 12);
    expect(sweep.bestThresholdBySampleAdjustedWinRate).toBe(4);
  });

  it('throws on duplicate threshold+season', () => {
    const s = sum({ season: 2023, threshold: 1 });
    expect(() =>
      buildThresholdSweepReport({
        config: baseConfig(),
        summaries: [
          { threshold: 1, summary: s },
          { threshold: 1, summary: { ...s } },
        ],
      })
    ).toThrow(/Duplicate/);
  });

  it('throws on mixed strategy', () => {
    expect(() =>
      buildThresholdSweepReport({
        config: baseConfig(),
        summaries: [
          { threshold: 1, summary: sum({ season: 2023, threshold: 1 }) },
          {
            threshold: 2,
            summary: { ...sum({ season: 2023, threshold: 2 }), strategyName: 'other' },
          },
        ],
      })
    ).toThrow(/Mixed strategy/);
  });
});

describe('formatThresholdSweepMarkdown', () => {
  it('includes sweep table and notes', () => {
    const sweep = buildThresholdSweepReport({
      config: baseConfig(),
      summaries: [
        { threshold: 3, summary: sum({ season: 2023, threshold: 3 }) },
      ],
    });
    const md = formatThresholdSweepMarkdown(sweep);
    expect(md).toContain('# Threshold sweep');
    expect(md).toContain('Best threshold (raw win rate)');
    expect(md).toContain('sample-adjusted');
    expect(md).toContain('synthetic season-average line');
  });
});
