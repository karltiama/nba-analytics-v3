/**
 * Declared residual-correction feature lists for wowy-known-out-r1.
 * Specified before fitting. Do not expand after seeing evaluation results.
 */

export const KNOWN_OUT_EXPERIMENT_VERSION = 'player-projection-wowy-known-out-r1';
export const KNOWN_OUT_FEATURE_SPEC_VERSION = 'wowy-known-out-residual-r1';

/** Inner chrono holdout: last this fraction of training ET dates. */
export const KNOWN_OUT_INNER_VAL_DATE_FRACTION = 0.3;
export const KNOWN_OUT_RIDGE_LAMBDAS = [0.3, 1, 3, 10, 30] as const;
export const KNOWN_OUT_FIXED_LAMBDA = 10;
export const KNOWN_OUT_MIN_INNER_VAL_N = 40;

export const ROLE_FEATURES_PTS = [
  'min_l10',
  'min_season',
  'pts_l10',
  'pts_per_min_l10',
  'opportunity_matched_l10',
  'prior_played_count',
] as const;

export const ROLE_FEATURES_REB = [
  'min_l10',
  'min_season',
  'reb_l10',
  'reb_per_min_l10',
  'opportunity_matched_l10',
  'prior_played_count',
] as const;

export const WOWY_FEATURES_PTS = [
  'wowy_primary_delta_minutes',
  'wowy_primary_delta_pts',
  'wowy_primary_delta_fga',
  'wowy_primary_with_games',
  'wowy_primary_without_games',
  'wowy_primary_support_adequate',
] as const;

export const WOWY_FEATURES_REB = [
  'wowy_primary_delta_minutes',
  'wowy_primary_delta_reb',
  'wowy_primary_delta_fga',
  'wowy_primary_with_games',
  'wowy_primary_without_games',
  'wowy_primary_support_adequate',
] as const;

export type KnownOutTarget = 'points' | 'rebounds';

export function roleFeatures(target: KnownOutTarget): readonly string[] {
  return target === 'points' ? ROLE_FEATURES_PTS : ROLE_FEATURES_REB;
}

export function wowyFeatures(target: KnownOutTarget): readonly string[] {
  return target === 'points' ? WOWY_FEATURES_PTS : WOWY_FEATURES_REB;
}

export function allFeatures(target: KnownOutTarget): string[] {
  return [...roleFeatures(target), ...wowyFeatures(target)];
}
