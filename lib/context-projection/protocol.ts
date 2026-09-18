/**
 * Phase 16B — PTS production context shadow protocol (frozen).
 * Research/shadow only. Does not change Props Explorer serving.
 */

export const CONTEXT_INTEGRATION_VERSION = 'context-projection-integration-v1' as const;

export const PROD_PTS_CONTEXT_MODEL_VERSION = 'prod-pts-context-role-form-joint-v1' as const;
export const PROD_PTS_ROLE_ONLY_MODEL_VERSION = 'prod-pts-context-role-only-v1' as const;
export const PROD_PTS_FORM_ONLY_MODEL_VERSION = 'prod-pts-context-form-only-v1' as const;

export const PROSPECTIVE_WINDOW_ID = 'prod-pts-context-v1-first500' as const;
export const PROSPECTIVE_REQUIRED_N = 500 as const;

export const PRODUCTION_BASELINE_ID = 'production_70_30' as const;
export const PRODUCTION_BASELINE_VERSION = 'court-context-model-lifecycle-c1.0' as const;

export const SHADOW_CUTOFF_MINUTES = 60 as const;

export const RIDGE_ALPHA = 1.0 as const;
export const FEATURE_STANDARDIZATION = 'NONE' as const;

export const PRODUCTION_PTS_CONTEXT_FEATURES = ['role.fga_delta', 'form.points_delta'] as const;
export type ProductionPtsContextFeature = (typeof PRODUCTION_PTS_CONTEXT_FEATURES)[number];

export const UNAUTHORIZED_PTS_CONTEXT_FEATURES = [
  'schedule.days_rest',
  'schedule.is_b2b',
  'opponent.defensive_rating',
  'opponent.pace',
  'injury.expected_missing_minutes',
  'injury.rotation_players_out_count',
  'matchup.perimeter',
  'interpretation.observation',
] as const;

export const BRANCHES = ['ROLE_FORM_JOINT', 'ROLE_ONLY', 'FORM_ONLY', 'BASELINE'] as const;
export type ShadowBranch = (typeof BRANCHES)[number];

export const PRIMARY_BRANCH: ShadowBranch = 'ROLE_FORM_JOINT';

export const ELIGIBILITY_STATUSES = [
  'PRIMARY_ELIGIBLE',
  'FALLBACK_NOT_PRIMARY',
  'LATE',
  'VERSION_MISMATCH',
  'INVALID',
  'NOT_COUNTED',
] as const;
export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number];

export const ROLE_CONTEXT_VERSION = 'player-role-context-v1' as const;
export const FORM_CONTEXT_VERSION = 'recent-form-context-v1' as const;

export const ARTIFACT_RELATIVE_DIR = 'reports/modeling/prod-pts-context-role-form-joint-v1' as const;

export const TRAINING_SEASONS = ['2023', '2024', '2025'] as const;

export const LOCKS = {
  PRODUCTION_BASELINE_RESIDUAL_REFIT_TRAINING_WINDOW: '2023+2024+2025 Final DNP-inclusive',
  TRAINING_CUTOFF: 'LAST_ELIGIBLE_FINAL_TIP_BEFORE_MODEL_ARTIFACT_FREEZE',
  SHADOW_PERSISTENCE_DESTINATION: 'analytics.prospective_shadow_predictions',
  '2025_USED_FOR_FUTURE_FACING_TRAINING': 'YES',
  '2025_USED_AS_INDEPENDENT_PRODUCTION_CERTIFICATION': 'NO',
  PROSPECTIVE_CERTIFICATION_SOURCE: 'FIRST_500_ELIGIBLE_PRODUCTION_PTS_SHADOW_PREDICTIONS',
  PRIMARY_PROSPECTIVE_PTS_CANDIDATE: 'PROD_PTS_ROLE_FORM_JOINT',
  B0_RESIDUAL_COEFFICIENTS_IMPORTED: 0,
} as const;
