-- PROPOSED schema for STEP 14M.C1 CatBoost prospective shadow (PTS/REB C).
-- Do NOT apply this file for Phase 16B PTS production-context shadow.
--
-- Phase 16B applied migration (dedicated DNP-inclusive production-context store):
--   db/schemas/MIGRATION_pts_production_context_prospective_shadow.sql
--
-- Why this proposed table remains separate:
-- Existing analytics.prediction_snapshots (MIGRATION_context_collection_snapshots.sql)
-- is reusable for immutability of research Track A/B/C, but it cannot satisfy the
-- C1 contract without overloading jsonb:
--   1. pred_a is played-only research Track A, not production DNP-inclusive 70/30.
--   2. Unique key (player_id, game_id, model_version, intended_cutoff_at) cannot
--      store per-market logical rows.
--   3. Cohort flags, missing context fields, sportsbook line, and Context Engine
--      snapshot are not first-class frozen columns.
-- This new table is additive. It does not alter production serving tables.

CREATE TABLE IF NOT EXISTS analytics.prospective_shadow_predictions (
  prediction_id text PRIMARY KEY,
  protocol_version text NOT NULL,
  generated_at timestamptz NOT NULL,
  context_cutoff timestamptz NOT NULL,
  game_id text NOT NULL REFERENCES analytics.games(game_id),
  scheduled_tip timestamptz NOT NULL,
  player_canonical_id text NOT NULL REFERENCES analytics.players(player_id),
  team_id text NOT NULL,
  opponent_team_id text NOT NULL,
  market text NOT NULL,
  sportsbook_line numeric,
  model_version text NOT NULL,
  feature_version text NOT NULL,
  control_id text NOT NULL,
  control_prediction numeric,
  candidate_id text NOT NULL,
  candidate_prediction numeric,
  captured_feature_values jsonb NOT NULL,
  captured_feature_event_timestamps jsonb NOT NULL,
  candidate_context_fields_available jsonb NOT NULL,
  missing_context_fields jsonb NOT NULL,
  data_freshness jsonb NOT NULL,
  eligibility jsonb NOT NULL,
  experiment_cohorts jsonb NOT NULL,
  context_engine_contract_version text NOT NULL,
  context_engine_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prospective_shadow_predictions_market_check CHECK (market IN ('points', 'rebounds')),
  CONSTRAINT prospective_shadow_predictions_cutoff_check CHECK (context_cutoff <= scheduled_tip)
);

CREATE UNIQUE INDEX IF NOT EXISTS analytics_prospective_shadow_predictions_logical_uidx
  ON analytics.prospective_shadow_predictions (
    player_canonical_id,
    game_id,
    market,
    model_version,
    context_cutoff
  );

COMMENT ON TABLE analytics.prospective_shadow_predictions IS
  'Immutable prospective prediction records. Outcomes never update these rows.';

CREATE TABLE IF NOT EXISTS analytics.prospective_shadow_outcomes (
  prediction_id text PRIMARY KEY
    REFERENCES analytics.prospective_shadow_predictions(prediction_id),
  joined_at timestamptz NOT NULL,
  actual numeric,
  outcome_class text NOT NULL,
  audit jsonb NOT NULL,
  CONSTRAINT prospective_shadow_outcomes_class_check CHECK (
    outcome_class IN ('played', 'dnp', 'postponed', 'cancelled', 'unresolved')
  )
);

COMMENT ON TABLE analytics.prospective_shadow_outcomes IS
  'Append-only outcome join. Never rewrites prospective_shadow_predictions.';
