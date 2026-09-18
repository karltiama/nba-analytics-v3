-- Phase 16B: PTS production context prospective shadow storage.
-- RESEARCH / SHADOW ONLY. Append-only for canonical pregame records.
-- Does NOT alter Props Explorer serving, production_70_30, Track B.1,
-- analytics.prediction_snapshots, or Context Center contexts.

CREATE TABLE IF NOT EXISTS analytics.prospective_shadow_predictions (
  shadow_prediction_id         text PRIMARY KEY,
  prospective_window_id        text NOT NULL,
  game_id                      text NOT NULL REFERENCES analytics.games(game_id),
  player_entity_id             text NOT NULL REFERENCES analytics.players(player_id),
  team_id                      text NOT NULL,
  game_start                   timestamptz NOT NULL,
  prediction_created_at        timestamptz NOT NULL,
  production_baseline_id       text NOT NULL,
  production_baseline_version  text NOT NULL,
  production_baseline_pts      numeric NOT NULL,
  context_integration_version  text NOT NULL,
  context_model_version        text NOT NULL,
  shadow_context_pts           numeric NOT NULL,
  context_adjustment           numeric NOT NULL,
  branch                       text NOT NULL,
  role_fga_delta               numeric,
  form_points_delta            numeric,
  role_context_version         text,
  form_context_version         text,
  feature_manifest_sha         text NOT NULL,
  training_manifest_sha        text NOT NULL,
  model_artifact_sha           text NOT NULL,
  eligibility_status           text NOT NULL,
  canonical_snapshot_identity  text NOT NULL,
  intended_cutoff_at           timestamptz NOT NULL,
  late                         boolean NOT NULL DEFAULT false,
  provenance                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospective_shadow_predictions_branch_check CHECK (
    branch IN ('ROLE_FORM_JOINT', 'ROLE_ONLY', 'FORM_ONLY', 'BASELINE')
  ),
  CONSTRAINT prospective_shadow_predictions_eligibility_check CHECK (
    eligibility_status IN (
      'PRIMARY_ELIGIBLE',
      'FALLBACK_NOT_PRIMARY',
      'LATE',
      'VERSION_MISMATCH',
      'INVALID',
      'NOT_COUNTED'
    )
  ),
  CONSTRAINT prospective_shadow_predictions_cutoff_check CHECK (
    prediction_created_at < game_start
  ),
  CONSTRAINT prospective_shadow_predictions_intended_cutoff_check CHECK (
    intended_cutoff_at <= game_start
  )
);

COMMENT ON TABLE analytics.prospective_shadow_predictions IS
  'Immutable pregame PTS production-context shadow predictions. RESEARCH/SHADOW ONLY. Never rewrite feature values or predictions after insert. Not a Props Explorer serving table.';

CREATE UNIQUE INDEX IF NOT EXISTS analytics_prospective_shadow_predictions_canonical_uidx
  ON analytics.prospective_shadow_predictions (
    prospective_window_id,
    player_entity_id,
    game_id,
    context_model_version
  );

COMMENT ON INDEX analytics.analytics_prospective_shadow_predictions_canonical_uidx IS
  'One certification row per (window, player, game, model). Canonical T-60 snapshot wins; later updates DO NOTHING.';

CREATE INDEX IF NOT EXISTS analytics_prospective_shadow_predictions_window_idx
  ON analytics.prospective_shadow_predictions (prospective_window_id, eligibility_status, created_at);

CREATE INDEX IF NOT EXISTS analytics_prospective_shadow_predictions_game_idx
  ON analytics.prospective_shadow_predictions (game_id, player_entity_id);

-- Append-only outcome join. Never updates prospective_shadow_predictions.
CREATE TABLE IF NOT EXISTS analytics.prospective_shadow_outcomes (
  shadow_prediction_id text PRIMARY KEY
    REFERENCES analytics.prospective_shadow_predictions(shadow_prediction_id),
  joined_at            timestamptz NOT NULL,
  actual_pts           numeric,
  outcome_class        text NOT NULL,
  audit                jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT prospective_shadow_outcomes_class_check CHECK (
    outcome_class IN ('played', 'dnp', 'postponed', 'cancelled', 'unresolved')
  )
);

COMMENT ON TABLE analytics.prospective_shadow_outcomes IS
  'Append-only outcome join for PTS production-context shadow. Never rewrites pregame predictions.';
