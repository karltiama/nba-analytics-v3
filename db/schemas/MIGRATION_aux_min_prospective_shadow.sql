-- Phase 18B: Auxiliary MIN prospective shadow storage.
-- RESEARCH / SHADOW ONLY. Append-only for canonical pregame records.
-- Does NOT alter Props Explorer, PTS prospective_shadow_predictions,
-- Track B.1, analytics.prediction_snapshots, or Context Center contexts.

CREATE TABLE IF NOT EXISTS analytics.prospective_min_shadow_predictions (
  shadow_prediction_id              text PRIMARY KEY,
  prospective_window_id             text NOT NULL,
  game_id                           text NOT NULL REFERENCES analytics.games(game_id),
  player_entity_id                  text NOT NULL REFERENCES analytics.players(player_id),
  team_id                           text NOT NULL,
  game_start                        timestamptz NOT NULL,
  prediction_created_at             timestamptz NOT NULL,
  target                            text NOT NULL DEFAULT 'MIN',
  b0_min                            numeric NOT NULL,
  context_adjustment                numeric NOT NULL,
  shadow_min                        numeric NOT NULL,
  branch                            text NOT NULL,
  role_minutes_delta                numeric,
  injury_expected_missing_minutes   numeric,
  injury_rotation_players_out_count numeric,
  role_context_version              text,
  availability_context_version      text,
  availability_completeness         text,
  model_id                          text NOT NULL,
  model_artifact_sha                text NOT NULL,
  feature_manifest_sha              text NOT NULL,
  training_manifest_sha             text NOT NULL,
  context_integration_version       text NOT NULL,
  pregame_eligibility_status        text NOT NULL,
  canonical_snapshot_identity       text NOT NULL,
  canonical_snapshot_status         text NOT NULL,
  intended_cutoff_at                timestamptz NOT NULL,
  late                              boolean NOT NULL DEFAULT false,
  provenance                        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospective_min_shadow_predictions_target_check CHECK (target = 'MIN'),
  CONSTRAINT prospective_min_shadow_predictions_branch_check CHECK (
    branch IN ('ROLE_AVAIL_JOINT', 'ROLE_ONLY', 'AVAIL_ONLY', 'BASELINE')
  ),
  CONSTRAINT prospective_min_shadow_predictions_eligibility_check CHECK (
    pregame_eligibility_status IN (
      'PRIMARY_ELIGIBLE',
      'FALLBACK_NOT_PRIMARY',
      'LATE',
      'VERSION_MISMATCH',
      'INVALID',
      'NOT_COUNTED'
    )
  ),
  CONSTRAINT prospective_min_shadow_predictions_snapshot_status_check CHECK (
    canonical_snapshot_status IN (
      'CANONICAL_T60',
      'LATE_AFTER_T60',
      'INVALID',
      'SUPERSEDED_NOT_STORED'
    )
  ),
  CONSTRAINT prospective_min_shadow_predictions_cutoff_check CHECK (
    prediction_created_at < game_start
  ),
  CONSTRAINT prospective_min_shadow_predictions_intended_cutoff_check CHECK (
    intended_cutoff_at <= game_start
  )
);

COMMENT ON TABLE analytics.prospective_min_shadow_predictions IS
  'Immutable pregame auxiliary MIN shadow predictions. RESEARCH/SHADOW ONLY. Never rewrite feature values or predictions after insert. Not a Props Explorer serving table. Isolated from PTS prospective_shadow_predictions.';

CREATE UNIQUE INDEX IF NOT EXISTS analytics_prospective_min_shadow_predictions_canonical_uidx
  ON analytics.prospective_min_shadow_predictions (
    prospective_window_id,
    player_entity_id,
    game_id,
    model_id
  );

COMMENT ON INDEX analytics.analytics_prospective_min_shadow_predictions_canonical_uidx IS
  'One certification row per (window, player, game, model). First on-time canonical insert wins; later updates DO NOTHING.';

CREATE INDEX IF NOT EXISTS analytics_prospective_min_shadow_predictions_window_idx
  ON analytics.prospective_min_shadow_predictions (
    prospective_window_id,
    pregame_eligibility_status,
    prediction_created_at
  );

CREATE INDEX IF NOT EXISTS analytics_prospective_min_shadow_predictions_game_idx
  ON analytics.prospective_min_shadow_predictions (game_id, player_entity_id);

-- Append-only outcome join. Never updates prospective_min_shadow_predictions pregame fields.
-- Outcome fields (including primary_sequence_number) may be upserted / recomputed.
CREATE TABLE IF NOT EXISTS analytics.prospective_min_shadow_outcomes (
  shadow_prediction_id       text PRIMARY KEY
    REFERENCES analytics.prospective_min_shadow_predictions(shadow_prediction_id),
  outcome_resolved_at        timestamptz NOT NULL,
  resolved_appearance_class  text NOT NULL,
  realized_minutes           numeric,
  primary_scoring_eligible   boolean NOT NULL DEFAULT false,
  primary_sequence_number    integer,
  audit                      jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT prospective_min_shadow_outcomes_class_check CHECK (
    resolved_appearance_class IN (
      'played',
      'dnp',
      'malformed',
      'no_pgl',
      'postponed',
      'cancelled',
      'unresolved'
    )
  ),
  CONSTRAINT prospective_min_shadow_outcomes_seq_check CHECK (
    primary_sequence_number IS NULL
    OR (primary_sequence_number >= 1 AND primary_scoring_eligible = true)
  )
);

COMMENT ON TABLE analytics.prospective_min_shadow_outcomes IS
  'Append/upsert outcome join for auxiliary MIN shadow. Never rewrites pregame predictions. primary_sequence_number assigned by prediction_created_at order among PLAYED joint rows.';
