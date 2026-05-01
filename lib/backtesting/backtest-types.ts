/**
 * Slice 9: minimal backtest harness types.
 *
 * Framework-free shapes for synthetic-line strategies over player_game_features_v1.
 * No file I/O or lookahead fields here.
 */

/** Resolved CLI / run configuration for a single-strategy backtest. */
export type BacktestConfig = {
  season: number;
  /** Minimum prior games before emitting a signal (strategy-specific; L5 strategy uses 5). */
  minPriorGames: number;
  /** Edge threshold: points_l5_avg_before_game - points_season_avg_before_game >= threshold. */
  threshold: number;
  strategyName: string;
  strategyVersion: string;
};

/** One emitted trading-style signal (no outcome until graded vs line). */
export type BacktestSignal = {
  strategyName: string;
  strategyVersion: string;
  season: string;
  player_id: string;
  game_id: string;
  game_date: string;
  signalType: 'OVER_POINTS';
  syntheticLine: number;
  edge: number;
  points_season_avg_before_game: number;
  points_l5_avg_before_game: number;
  prior_games: number;
};

/** Graded result for a row where a signal was emitted. */
export type BacktestResult = BacktestSignal & {
  actual_points: number;
  outcome: 'win' | 'loss' | 'push';
};

/** Aggregate stats for console / manifest. */
export type BacktestSummary = {
  rowsScanned: number;
  signalsGenerated: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null;
  averageEdge: number | null;
  averageActualMargin: number | null;
  skippedRows: number;
  skippedReasons: {
    insufficient_prior_games: number;
    missing_feature_values: number;
    no_signal: number;
  };
};

/** S3 manifest written after a successful (non-dry) backtest run. */
export type BacktestManifest = {
  strategyName: string;
  strategyVersion: string;
  season: number;
  threshold: number;
  inputFeaturePrefix: string;
  outputPrefix: string;
  rowsScanned: number;
  signalsGenerated: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null;
  averageEdge: number | null;
  averageActualMargin: number | null;
  skippedRows: number;
  skippedReasons: BacktestSummary['skippedReasons'];
  createdAt: string;
  status: 'success' | 'dry-run';
};

/** Minimal feature row slice needed for the L5 vs season points strategy. */
export type PointsL5VsSeasonFeatureInput = {
  prior_games: number;
  points_season_avg_before_game: number | null;
  points_l5_avg_before_game: number | null;
  actual_points: number | null;
  season: string;
  player_id: string;
  game_id: string;
  game_date: string;
};
