/**
 * Phase 17 — Auxiliary MIN shadow protocol (research only).
 * Does not touch Props Explorer, PTS shadow, or MIN→PTS.
 */

export const AUX_MIN_MODEL_VERSION = 'aux-min-context-role-avail-joint-v1' as const;
export const AUX_MIN_ROLE_ONLY_MODEL_VERSION = 'aux-min-context-role-only-v1' as const;
export const AUX_MIN_AVAIL_ONLY_MODEL_VERSION = 'aux-min-context-avail-only-v1' as const;

export const AUX_MIN_INTEGRATION_VERSION = 'context-projection-integration-v1' as const;

export const AUX_MIN_SPINE = 'B0_PLAYER_HISTORY' as const;
export const B0_MIN_VERSION = 'expanding_mean_same_season_same_team_prior_PLAYED' as const;

/** Exact H3_ROLE_MIN model feature (recent − season). */
export const H3_ROLE_MIN_FEATURES = ['role.minutes_delta'] as const;

/** Exact H5_AVAIL_MIN model features (raw). */
export const H5_AVAIL_MIN_FEATURES = [
  'injury.expected_missing_minutes',
  'injury.rotation_players_out_count',
] as const;

export const AUX_MIN_JOINT_FEATURES = [
  'role.minutes_delta',
  'injury.expected_missing_minutes',
  'injury.rotation_players_out_count',
] as const;

export const AVAIL_MIN_VALIDATED_COMPLETENESS_POLICY = 'COMPLETE_ONLY_PRIMARY' as const;
export const AUX_MIN_TARGET_POPULATION = 'PLAYED' as const;

export const RIDGE_ALPHA = 1.0 as const;
export const FEATURE_STANDARDIZATION = 'NONE' as const;

export const AUX_MIN_BRANCHES = [
  'ROLE_AVAIL_JOINT',
  'ROLE_ONLY',
  'AVAIL_ONLY',
  'BASELINE',
] as const;
export type AuxMinBranch = (typeof AUX_MIN_BRANCHES)[number];

export const PRIMARY_AUX_MIN_BRANCH: AuxMinBranch = 'ROLE_AVAIL_JOINT';

export const AUX_MIN_UNAUTHORIZED_FEATURES = [
  'schedule.days_rest',
  'schedule.back_to_back',
  'schedule.home_away',
  'schedule.is_season_opener',
  'opponent.defensive_rating',
  'form.points_delta',
  'form.recent_points',
  'matchup.perimeter',
  'interpretation.observation',
  'shadow_context_pts',
  'prod_pts_adjustment',
] as const;

export const ROLE_CONTEXT_VERSION = 'player-role-context-v1' as const;
export const AVAIL_CONTEXT_VERSION = 'team-injury-context-v2' as const;

/** Phase 18A design freeze — dedicated MIN store (not PTS table). */
export const AUX_MIN_SHADOW_STORAGE =
  'analytics.prospective_min_shadow_predictions' as const;
export const AUX_MIN_SHADOW_OUTCOMES_STORAGE =
  'analytics.prospective_min_shadow_outcomes' as const;

/** Phase 18A design freeze — collection not yet implemented. */
export const AUX_MIN_PROSPECTIVE_WINDOW =
  'aux-min-role-avail-joint-v1-first750' as const;
export const AUX_MIN_PROSPECTIVE_MANIFEST_ID =
  'auxiliary-min-prospective-window-v1' as const;
export const PROSPECTIVE_MIN_REQUIRED_N = 750 as const;
export const MIN_CANONICAL_SNAPSHOT_POLICY =
  'LATEST_ELIGIBLE_AT_OR_BEFORE_T_MINUS_60' as const;
export const DNP_PROSPECTIVE_POLICY =
  'STORE_AS_DIAGNOSTIC_NOT_PRIMARY_SCORE' as const;
export const AUXILIARY_MIN_PROSPECTIVE_VALIDATION_DESIGN = 'APPROVED' as const;
/** Updated by Phase 18B after activation certification. */
export const AUXILIARY_MIN_SHADOW_STATUS =
  'READY_FOR_PROSPECTIVE_COLLECTION' as const;

/** Frozen artifact SHAs — must match aux-min-model_artifact.json exactly. */
export const FROZEN_AUX_MIN_MODEL_ARTIFACT_SHA =
  '7354e0a8f9a8a15ade3c5f77e95b45b009661f49abfdcfea2c1e9edc3a4b1904' as const;
export const FROZEN_AUX_MIN_FEATURE_MANIFEST_SHA =
  'f572935248cd9c43b56aa847171caa17c20fcd8121eecb01a90caca5dcd95414' as const;
export const FROZEN_AUX_MIN_TRAINING_MANIFEST_SHA =
  '237f372d61a71d1921e8737fd913869c684307902a40258a07eee35d4a2a6d69' as const;

export const AUX_MIN_PRIMARY_WINDOW_REFIT_COUNT = 0 as const;
export const MIN_PRODUCTION_PATH = 'DEFER_PROPS_EXPLORER' as const;

export const TRAINING_SEASONS = ['2023', '2024', '2025'] as const;

export const PTS_PROSPECTIVE_WINDOW_ID = 'prod-pts-context-v1-first500' as const;
export const PTS_FROZEN_MODEL_ARTIFACT_SHA =
  '36f68abdab110ea13e78ac03d573aa3718b9ae7bb8b9bbd8a0d5983d83df478a' as const;
export const PTS_PROSPECTIVE_REQUIRED_N = 500 as const;

export const LOCKS = {
  MIN_SHADOW_SPINE: AUX_MIN_SPINE,
  PRIMARY_CANDIDATE: 'AUX_MIN_ROLE_AVAIL_JOINT',
  JOINT_NOT_BLIND_SUM: true,
  MIN_TO_PTS_CHAIN: 'NONE',
  '2025_INDEPENDENT_CERTIFICATION_AUTHORITY': 'NO',
  B0_RESIDUAL_COEFFICIENTS_FROM_PTS: 0,
} as const;
