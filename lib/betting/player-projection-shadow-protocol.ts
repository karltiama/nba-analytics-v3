/**
 * Versioned prospective shadow protocol for PTS C and REB C.
 * Created before live results exist. Does not change production serving.
 * Frozen feature order is copied here so freeze/upload scripts do not import DB.
 */

export const SHADOW_PROTOCOL_VERSION = 'player-projection-shadow-pts-reb-c-r1';
/** Timing/ops amendment. Does not change frozen models or feature order. */
export const SHADOW_PROTOCOL_AMENDMENT = 'player-projection-shadow-pts-reb-c-r1.1-timing';
export const SHADOW_MODEL_VERSION = 'player-projection-learned-r1-pts-reb-c';
export const SHADOW_FEATURE_SPEC_VERSION = 'player-projection-learned-features-r1';
export const SHADOW_MINUTES_BEFORE_TIP = 60;
/** Scheduler poll interval. Amended from the original 15-minute due lookahead. */
export const SHADOW_SCHEDULER_INTERVAL_MINUTES = 5;
/**
 * Due window is [cutoff − this, cutoff]. Generation after cutoff is late.
 * Original protocol used 15; r1.1 uses 5 so a 5-minute poll can still hit on-time.
 */
export const SHADOW_DUE_LOOKAHEAD_MINUTES = 5;
/**
 * Ops SLA for starting a due cycle. Does not reclassify late predictions as on-time.
 * A prediction with generated_at > intended_cutoff remains late even if latency ≤ this.
 */
export const SHADOW_ALLOWABLE_EXECUTION_LATENCY_SECONDS = 90;
export const SHADOW_PRIMARY_WINDOW_DAYS = 60;
export const SHADOW_NOMINATION_DELTA_MAE = -0.01;
export const SHADOW_TARGETS = ['points', 'rebounds'] as const;
export type ShadowTarget = (typeof SHADOW_TARGETS)[number];
export const SHADOW_SEASON = '2026';
/** Inclusive ET calendar floor matching historicalSeasonWindow servingMinDate (MM-DD). */
export const SHADOW_REGULAR_SEASON_FLOOR_MMDD = '10-15';

/** Frozen copy of FEATURE_C_ALLOWLIST. Tests assert equality. */
export const SHADOW_FEATURE_ORDER = [
  'pts_l5',
  'pts_l10',
  'pts_l20',
  'pts_season',
  'pts_std10',
  'pred_track_a_pts',
  'reb_l5',
  'reb_l10',
  'reb_l20',
  'reb_season',
  'reb_std10',
  'pred_track_a_reb',
  'ast_l5',
  'ast_l10',
  'ast_l20',
  'ast_season',
  'ast_std10',
  'pred_track_a_ast',
  'threes_l5',
  'threes_l10',
  'threes_l20',
  'threes_season',
  'threes_std10',
  'pred_track_a_threes',
  'min_l5',
  'min_l10',
  'min_l20',
  'min_season',
  'min_ewm_a025',
  'min_std10',
  'min_l5_l10_rel_change',
  'min_change_large',
  'fga_l5',
  'fga_l10',
  'fga_season',
  'tpa_l5',
  'tpa_l10',
  'tpa_season',
  'fta_l5',
  'fta_l10',
  'fta_season',
  'pts_per_min_l10',
  'pts_per_min_season',
  'reb_per_min_l10',
  'ast_per_min_l10',
  'threes_per_min_l10',
  'fga_share_l5',
  'fga_share_l10',
  'fga_share_season',
  'tpa_share_l10',
  'fta_share_l10',
  'prior_played_count',
  'prior_log_count',
  'l5_played_count',
  'l10_played_count',
  'l20_played_count',
  'season_played_count',
  'opportunity_matched_l10',
] as const;

export const SHADOW_BUNDLE_RELATIVE_DIR = 'reports/modeling/shadow-pts-reb-c-r1';
export const LEARNED_R1_CANONICAL_RELATIVE_DIR = 'reports/modeling/learned-r1';
export const SHADOW_S3_PREFIX = 'research/models/player-projection-shadow-pts-reb-c-r1';

export const SHADOW_ARTIFACT_FILES = {
  pointsModel: 'c_points.cbm',
  reboundsModel: 'c_rebounds.cbm',
  manifest: 'manifest.json',
  featureOrder: 'feature_order.json',
  sampleFeatures: 'sample_features.jsonl',
  samplePredictions: 'sample_predictions.jsonl',
} as const;

export const PRODUCTION_INPUT_MISMATCH_NOTE =
  'Played-only research A/B/C are not the current production season-average / DNP-inclusive inputs. A production rollout must address that mismatch separately.';
