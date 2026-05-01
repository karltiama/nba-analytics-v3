/**
 * Slice 10: types for backtest reports and multi-season comparisons.
 * Consumes Slice 9 manifest + results.jsonl shapes (no strategy re-run).
 */

import type { BacktestManifest, BacktestSummary } from './backtest-types';

/** Aggregate stats for a grouping dimension (calendar month or prior-games bucket). */
export type BacktestBucketSummary = {
  bucketKey: string;
  signals: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null;
  averageEdge: number | null;
  averageActualMargin: number | null;
};

/** One row highlighted in top-N tables (margins, edges). */
export type BacktestPlayerSample = {
  player_id: string;
  game_id: string;
  game_date: string;
  edge: number;
  /** actual_points - syntheticLine */
  actual_margin: number;
  synthetic_line: number;
  actual_points: number;
  outcome: 'win' | 'loss' | 'push';
};

/** Full single-season report built from manifest + signal rows (pure layer output). */
export type BacktestReportSummary = {
  season: number;
  strategyName: string;
  strategyVersion: string;
  threshold: number;
  rowsScanned: number;
  signalsGenerated: number;
  signalRate: number | null;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null;
  averageEdge: number | null;
  averageActualMargin: number | null;
  skippedRows: number;
  skippedReasons: BacktestSummary['skippedReasons'];
  byMonth: BacktestBucketSummary[];
  byPriorGamesBucket: BacktestBucketSummary[];
  topWinningMargins: BacktestPlayerSample[];
  worstLosingMargins: BacktestPlayerSample[];
  topEdges: BacktestPlayerSample[];
};

/** Side-by-side metrics for multiple seasons (same strategy). */
export type BacktestSeasonComparison = {
  strategyName: string;
  strategyVersion: string;
  seasons: number[];
  perSeason: Array<{
    season: number;
    threshold: number;
    rowsScanned: number;
    signalsGenerated: number;
    signalRate: number | null;
    wins: number;
    losses: number;
    pushes: number;
    winRate: number | null;
    averageEdge: number | null;
    averageActualMargin: number | null;
    skippedRows: number;
  }>;
};

/** Wrapper written by the report CLI (only `generatedAt` is non-deterministic). */
export type BacktestReportFilePayload = {
  generatedAt: string;
  reportVersion: 1;
  summary: BacktestReportSummary;
};

export type BacktestComparisonFilePayload = {
  generatedAt: string;
  reportVersion: 1;
  comparison: BacktestSeasonComparison;
};
