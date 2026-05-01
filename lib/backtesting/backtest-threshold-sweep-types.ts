/**
 * Slice 11: threshold sweep across seasons (aggregated report inputs).
 */

/** Sweep dimensions (strategy fixed to points_l5_vs_season_v1 in CLI). */
export type ThresholdSweepConfig = {
  strategyName: string;
  strategyVersion: string;
  seasons: number[];
  thresholds: number[];
};

/** One aggregated row for a single edge threshold across included seasons. */
export type ThresholdSweepRow = {
  threshold: number;
  seasonsIncluded: number[];
  totalRowsScanned: number;
  totalSignalsGenerated: number;
  signalRate: number | null;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null;
  /** Weighted by `signalsGenerated` per season. */
  averageEdge: number | null;
  /** Weighted by `signalsGenerated` per season. */
  averageActualMargin: number | null;
  minSeasonWinRate: number | null;
  maxSeasonWinRate: number | null;
  /** (wins+1)/(signals+2) — shrinkage for ranking under small N. */
  sampleAdjustedWinRate: number | null;
  warnings: string[];
};

export type ThresholdSweepReport = {
  strategyName: string;
  strategyVersion: string;
  seasons: number[];
  thresholds: number[];
  rows: ThresholdSweepRow[];
  /** Tie-break: lower threshold wins. */
  bestThresholdByWinRate: number | null;
  /** Tie-break: lower threshold wins. */
  bestThresholdBySampleAdjustedWinRate: number | null;
};

export type ThresholdSweepFilePayload = {
  generatedAt: string;
  reportVersion: 1;
  sweep: ThresholdSweepReport;
};
