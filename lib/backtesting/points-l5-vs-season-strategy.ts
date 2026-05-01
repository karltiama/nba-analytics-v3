/**
 * Slice 9: synthetic-line strategy — L5 points edge vs season average (points only).
 *
 * Pure logic: no I/O. Uses only pre-game feature columns from player_game_features_v1.
 */

import type { BacktestConfig, BacktestSignal, PointsL5VsSeasonFeatureInput } from './backtest-types';

const STRATEGY_NAME = 'points_l5_vs_season';
const STRATEGY_VERSION = 'v1';

/**
 * Returns a signal when:
 * - prior_games >= minPriorGames (caller should pass config.minPriorGames >= 5)
 * - points_l5_avg_before_game and points_season_avg_before_game are non-null
 * - edge = L5 - season >= threshold
 */
export function evaluatePointsL5VsSeasonSignal(args: {
  row: PointsL5VsSeasonFeatureInput;
  config: Pick<BacktestConfig, 'season' | 'threshold' | 'minPriorGames'>;
}): BacktestSignal | null {
  const { row, config } = args;
  const minPrior = config.minPriorGames;
  if (row.prior_games < minPrior) return null;

  const seasonAvg = row.points_season_avg_before_game;
  const l5 = row.points_l5_avg_before_game;
  if (seasonAvg == null || l5 == null) return null;

  const edge = l5 - seasonAvg;
  if (edge < config.threshold) return null;

  return {
    strategyName: STRATEGY_NAME,
    strategyVersion: STRATEGY_VERSION,
    season: row.season,
    player_id: row.player_id,
    game_id: row.game_id,
    game_date: row.game_date,
    signalType: 'OVER_POINTS',
    syntheticLine: seasonAvg,
    edge,
    points_season_avg_before_game: seasonAvg,
    points_l5_avg_before_game: l5,
    prior_games: row.prior_games,
  };
}

/** Grade OVER_POINTS vs synthetic line (season avg). */
export function gradeOverPointsSignal(
  signal: BacktestSignal,
  actualPoints: number
): 'win' | 'loss' | 'push' {
  if (actualPoints > signal.syntheticLine) return 'win';
  if (actualPoints < signal.syntheticLine) return 'loss';
  return 'push';
}

export { STRATEGY_NAME, STRATEGY_VERSION };
