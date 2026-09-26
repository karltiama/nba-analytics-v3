-- Prospective projection ledger. Append-only. Does not alter market, result, or research shadow tables.
-- Apply once. Do not backfill predictions in this migration.

CREATE TABLE IF NOT EXISTS analytics.projection_snapshots (
  projection_snapshot_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id                      text NOT NULL REFERENCES analytics.games (game_id) ON DELETE RESTRICT,
  player_id                    text NOT NULL REFERENCES analytics.players (player_id) ON DELETE RESTRICT,
  team_id                      text REFERENCES analytics.teams (team_id) ON DELETE RESTRICT,
  season                       text NOT NULL,
  input_season_key             text NOT NULL,
  market                       text NOT NULL,
  snapshot_policy              text NOT NULL,
  snapshot_revision            integer NOT NULL DEFAULT 1,
  provenance_type              text NOT NULL,
  timing_status                text NOT NULL,
  projection_value             numeric NOT NULL,
  base_projection_value        numeric NOT NULL,
  serving_track                text NOT NULL,
  projection_model_id          text NOT NULL,
  projection_model_version     text NOT NULL,
  calibration_version          text NOT NULL,
  code_revision                text NOT NULL,
  config_fingerprint           text NOT NULL,
  generated_at                 timestamptz NOT NULL,
  intended_cutoff_at           timestamptz NOT NULL,
  game_tip_time                timestamptz NOT NULL,
  capture_eligible_at_write    boolean GENERATED ALWAYS AS (
    provenance_type = 'PROSPECTIVE_LIVE'
    AND timing_status = 'ON_TIME'
    AND snapshot_revision = 1
    AND generated_at < game_tip_time
  ) STORED,
  latest_input_game_start_time timestamptz,
  l5_avg                       numeric NOT NULL,
  l10_avg                      numeric NOT NULL,
  season_avg                   numeric NOT NULL,
  sample_games_used            integer NOT NULL,
  season_games_played          integer NOT NULL,
  sigma_effective              numeric NOT NULL,
  input_snapshot               jsonb NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projection_snapshots_market_chk CHECK (
    market IN (
      'points', 'rebounds', 'assists', 'threes',
      'points_assists', 'points_rebounds', 'rebounds_assists', 'points_rebounds_assists'
    )
  ),
  CONSTRAINT projection_snapshots_policy_chk CHECK (
    snapshot_policy IN ('T_MINUS_60', 'T_MINUS_24H', 'T_MINUS_6H', 'T_MINUS_15', 'ON_CHANGE')
  ),
  CONSTRAINT projection_snapshots_revision_chk CHECK (snapshot_revision = 1),
  CONSTRAINT projection_snapshots_provenance_chk CHECK (
    provenance_type IN ('PROSPECTIVE_LIVE', 'RECONSTRUCTED_BACKFILL', 'TEST')
  ),
  CONSTRAINT projection_snapshots_timing_pair_chk CHECK (
    (
      provenance_type = 'PROSPECTIVE_LIVE'
      AND timing_status IN ('ON_TIME', 'LATE_BEFORE_TIP')
    )
    OR (
      provenance_type IN ('RECONSTRUCTED_BACKFILL', 'TEST')
      AND timing_status = 'NOT_APPLICABLE'
    )
  ),
  CONSTRAINT projection_snapshots_live_before_tip_chk CHECK (
    provenance_type <> 'PROSPECTIVE_LIVE' OR generated_at < game_tip_time
  ),
  CONSTRAINT projection_snapshots_cutoff_chk CHECK (
    snapshot_policy <> 'T_MINUS_60'
    OR intended_cutoff_at = game_tip_time - interval '60 minutes'
  ),
  CONSTRAINT projection_snapshots_on_time_window_chk CHECK (
    timing_status <> 'ON_TIME'
    OR (
      generated_at <= intended_cutoff_at
      AND generated_at >= intended_cutoff_at - interval '5 minutes'
    )
  ),
  CONSTRAINT projection_snapshots_late_window_chk CHECK (
    timing_status <> 'LATE_BEFORE_TIP'
    OR (generated_at > intended_cutoff_at AND generated_at < game_tip_time)
  ),
  CONSTRAINT projection_snapshots_track_chk CHECK (
    serving_track IN ('baseline', 'trackA_calibrated', 'trackB_calibrated')
  ),
  CONSTRAINT projection_snapshots_identity_chk CHECK (
    length(btrim(code_revision)) > 0 AND length(btrim(config_fingerprint)) > 0
  ),
  CONSTRAINT projection_snapshots_slot_uidx UNIQUE (
    game_id, player_id, market, snapshot_policy, provenance_type, snapshot_revision
  )
);

CREATE INDEX IF NOT EXISTS projection_snapshots_game_player_idx
  ON analytics.projection_snapshots (game_id, player_id);
CREATE INDEX IF NOT EXISTS projection_snapshots_capture_eligible_idx
  ON analytics.projection_snapshots (game_id, market)
  WHERE capture_eligible_at_write;

COMMENT ON TABLE analytics.projection_snapshots IS
  'Immutable prospective Court Context means. capture_eligible_at_write is the write-time flag only. Public stats use analytics.v_projection_performance.';
COMMENT ON COLUMN analytics.projection_snapshots.latest_input_game_start_time IS
  'Start time of the newest Final game in the model window. Not a database updated_at.';
COMMENT ON COLUMN analytics.projection_snapshots.capture_eligible_at_write IS
  'True only when a live on-time revision-1 row was before the tip stored at insert. Not authoritative after a tip change.';

CREATE TABLE IF NOT EXISTS analytics.projection_market_snapshots (
  projection_market_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projection_snapshot_id        uuid NOT NULL REFERENCES analytics.projection_snapshots (projection_snapshot_id) ON DELETE RESTRICT,
  venue_type                    text NOT NULL DEFAULT 'sportsbook',
  sportsbook                    text NOT NULL,
  side                          text NOT NULL,
  line_value                    numeric NOT NULL,
  odds_american                 integer NOT NULL,
  odds_decimal                  numeric NOT NULL,
  market_implied_probability    numeric NOT NULL,
  observed_at                   timestamptz NOT NULL,
  source_table                  text NOT NULL,
  source_row_id                 uuid,
  served_probability_raw        numeric,
  served_probability_calibrated numeric,
  served_probability_anchored   numeric,
  served_ev                     numeric,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projection_market_venue_chk CHECK (venue_type = 'sportsbook'),
  CONSTRAINT projection_market_side_chk CHECK (side IN ('over', 'under')),
  CONSTRAINT projection_market_slot_uidx UNIQUE (
    projection_snapshot_id, sportsbook, side, line_value
  )
);

CREATE INDEX IF NOT EXISTS projection_market_snapshots_parent_idx
  ON analytics.projection_market_snapshots (projection_snapshot_id);

COMMENT ON TABLE analytics.projection_market_snapshots IS
  'Sportsbook observations captured with a projection. Not a consensus line. Not a prediction market.';

CREATE OR REPLACE FUNCTION analytics.projection_market_observed_at_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_generated timestamptz;
BEGIN
  SELECT generated_at INTO parent_generated
    FROM analytics.projection_snapshots
   WHERE projection_snapshot_id = NEW.projection_snapshot_id;
  IF parent_generated IS NULL THEN
    RAISE EXCEPTION 'projection market snapshot missing parent';
  END IF;
  IF NEW.observed_at > parent_generated THEN
    RAISE EXCEPTION 'market observed_at % is after projection generated_at %', NEW.observed_at, parent_generated;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projection_market_observed_at_guard ON analytics.projection_market_snapshots;
CREATE TRIGGER projection_market_observed_at_guard
  BEFORE INSERT ON analytics.projection_market_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION analytics.projection_market_observed_at_guard();

CREATE TABLE IF NOT EXISTS analytics.projection_publish_attempts (
  attempt_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempted_at      timestamptz NOT NULL DEFAULT now(),
  game_id           text,
  player_id         text,
  market            text,
  snapshot_policy   text,
  provenance_type   text,
  outcome           text NOT NULL,
  detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
  code_revision     text,
  CONSTRAINT projection_publish_attempts_outcome_chk CHECK (
    outcome IN (
      'inserted',
      'duplicate_same',
      'duplicate_conflict',
      'skipped_no_inputs',
      'skipped_after_tip',
      'skipped_not_due',
      'skipped_missing_code_revision',
      'skipped_ineligible_game',
      'skipped_unsupported_market',
      'market_child_rejected',
      'error'
    )
  )
);

CREATE INDEX IF NOT EXISTS projection_publish_attempts_game_idx
  ON analytics.projection_publish_attempts (game_id, attempted_at DESC);

COMMENT ON TABLE analytics.projection_publish_attempts IS
  'Operational telemetry for the projection writer. Not a published prediction and not an official performance source.';

CREATE OR REPLACE FUNCTION analytics.projection_ledger_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('projection_ledger.maintenance', true) = 'allow'
     AND current_user IN ('postgres', 'supabase_admin') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'projection ledger % is append-only', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS projection_snapshots_block_mutation ON analytics.projection_snapshots;
CREATE TRIGGER projection_snapshots_block_mutation
  BEFORE UPDATE OR DELETE ON analytics.projection_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION analytics.projection_ledger_block_mutation();

DROP TRIGGER IF EXISTS projection_market_snapshots_block_mutation ON analytics.projection_market_snapshots;
CREATE TRIGGER projection_market_snapshots_block_mutation
  BEFORE UPDATE OR DELETE ON analytics.projection_market_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION analytics.projection_ledger_block_mutation();

DROP TRIGGER IF EXISTS projection_publish_attempts_block_mutation ON analytics.projection_publish_attempts;
CREATE TRIGGER projection_publish_attempts_block_mutation
  BEFORE UPDATE OR DELETE ON analytics.projection_publish_attempts
  FOR EACH ROW
  EXECUTE FUNCTION analytics.projection_ledger_block_mutation();

CREATE OR REPLACE FUNCTION analytics.projection_ledger_admin_delete(p_snapshot_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'projection ledger maintenance requires a privileged role';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 8 THEN
    RAISE EXCEPTION 'projection ledger maintenance requires an explicit reason';
  END IF;
  PERFORM set_config('projection_ledger.maintenance', 'allow', true);
  DELETE FROM analytics.projection_market_snapshots WHERE projection_snapshot_id = p_snapshot_id;
  DELETE FROM analytics.projection_snapshots WHERE projection_snapshot_id = p_snapshot_id;
END;
$$;

REVOKE ALL ON FUNCTION analytics.projection_ledger_admin_delete(uuid, text) FROM PUBLIC;

ALTER TABLE analytics.projection_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.projection_market_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.projection_publish_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE analytics.projection_snapshots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE analytics.projection_market_snapshots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE analytics.projection_publish_attempts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW analytics.v_projection_performance AS
SELECT
  p.projection_snapshot_id,
  p.game_id,
  p.player_id,
  p.season,
  p.input_season_key,
  p.market,
  p.snapshot_policy,
  p.provenance_type,
  p.timing_status,
  p.capture_eligible_at_write,
  p.projection_value,
  p.base_projection_value,
  p.serving_track,
  p.projection_model_id,
  p.projection_model_version,
  p.generated_at,
  p.game_tip_time AS stored_game_tip_time,
  g.start_time AS current_game_start_time,
  p.latest_input_game_start_time,
  m.projection_market_snapshot_id,
  m.sportsbook,
  m.side,
  m.line_value AS publish_line,
  m.odds_american AS publish_odds_american,
  m.observed_at AS market_observed_at,
  m.served_probability_anchored,
  d.line_value AS closing_line,
  d.odds_american AS closing_odds_american,
  d.decision_at AS closing_observed_at,
  d.sportsbook AS closing_sportsbook,
  l.updated_at AS result_row_updated_at,
  CASE p.market
    WHEN 'points' THEN l.points::numeric
    WHEN 'rebounds' THEN l.rebounds::numeric
    WHEN 'assists' THEN l.assists::numeric
    WHEN 'threes' THEN l.three_pointers_made::numeric
    WHEN 'points_assists' THEN CASE WHEN l.points IS NULL OR l.assists IS NULL THEN NULL ELSE (l.points + l.assists)::numeric END
    WHEN 'points_rebounds' THEN CASE WHEN l.points IS NULL OR l.rebounds IS NULL THEN NULL ELSE (l.points + l.rebounds)::numeric END
    WHEN 'rebounds_assists' THEN CASE WHEN l.rebounds IS NULL OR l.assists IS NULL THEN NULL ELSE (l.rebounds + l.assists)::numeric END
    WHEN 'points_rebounds_assists' THEN CASE
      WHEN l.points IS NULL OR l.rebounds IS NULL OR l.assists IS NULL THEN NULL
      ELSE (l.points + l.rebounds + l.assists)::numeric
    END
    ELSE NULL
  END AS actual_result,
  CASE
    WHEN lower(btrim(coalesce(g.status, ''))) = 'postponed' THEN 'POSTPONED'
    WHEN lower(btrim(coalesce(g.status, ''))) IN ('canceled', 'cancelled') THEN 'CANCELED'
    WHEN lower(btrim(coalesce(g.status, ''))) <> 'final' THEN 'UNRESOLVED'
    WHEN NOT EXISTS (
      SELECT 1 FROM analytics.player_game_logs c WHERE c.game_id = p.game_id
    ) THEN 'UNRESOLVED'
    WHEN l.player_id IS NULL THEN 'DNP_VOID'
    WHEN l.minutes IS NULL OR btrim(l.minutes) = '' THEN 'UNRESOLVED'
    WHEN btrim(l.minutes) !~ '^[0-9]+(\.[0-9]+)?$' THEN 'UNRESOLVED'
    WHEN btrim(l.minutes)::numeric > 0 THEN 'PLAYED'
    WHEN btrim(l.minutes) = '00' THEN 'DNP_VOID'
    WHEN btrim(l.minutes) IN ('0', '0.0') THEN 'PLAYED'
    WHEN COALESCE(l.points, 0) + COALESCE(l.rebounds, 0) + COALESCE(l.assists, 0)
       + COALESCE(l.three_pointers_made, 0) + COALESCE(l.field_goals_attempted, 0)
       + COALESCE(l.free_throws_attempted, 0) > 0 THEN 'PLAYED'
    ELSE 'DNP_VOID'
  END AS resolution_state,
  false AS official_market_comparison
FROM analytics.projection_snapshots p
JOIN analytics.games g ON g.game_id = p.game_id
LEFT JOIN analytics.projection_market_snapshots m
  ON m.projection_snapshot_id = p.projection_snapshot_id
LEFT JOIN LATERAL (
  SELECT d.line_value, d.odds_american, d.decision_at, d.sportsbook
    FROM research.prop_decision_lines d
   WHERE m.sportsbook IS NOT NULL
     AND d.game_id = p.game_id
     AND d.player_id = p.player_id
     AND d.prop_type = p.market
     AND d.sportsbook = m.sportsbook
     AND d.side = m.side
     AND d.decision_at < g.start_time
   ORDER BY d.decision_at DESC, d.line_value DESC
   LIMIT 1
) d ON true
LEFT JOIN analytics.player_game_logs l
  ON l.game_id = p.game_id
 AND l.player_id = p.player_id
WHERE p.provenance_type = 'PROSPECTIVE_LIVE'
  AND p.timing_status = 'ON_TIME'
  AND p.snapshot_revision = 1
  AND p.generated_at < p.game_tip_time
  AND p.generated_at < g.start_time
  AND p.game_tip_time = g.start_time
  AND p.capture_eligible_at_write;

CREATE OR REPLACE VIEW analytics.v_projection_performance_grades AS
SELECT
  base.*,
  CASE
    WHEN base.resolution_state = 'PLAYED' AND base.actual_result IS NOT NULL
      THEN abs(base.actual_result - base.projection_value)
  END AS absolute_error,
  CASE
    WHEN base.resolution_state = 'PLAYED' AND base.actual_result IS NOT NULL
      THEN base.actual_result - base.projection_value
  END AS signed_error,
  CASE
    WHEN base.publish_line IS NOT NULL THEN base.projection_value - base.publish_line
  END AS projection_minus_publish_line,
  CASE
    WHEN base.publish_line IS NOT NULL AND base.closing_line IS NOT NULL
      THEN base.closing_line - base.publish_line
  END AS line_movement,
  CASE
    WHEN base.publish_line IS NULL OR base.closing_line IS NULL THEN NULL
    WHEN base.closing_line = base.publish_line THEN 'unchanged'
    WHEN (base.projection_value - base.publish_line) = 0 THEN NULL
    WHEN sign(base.closing_line - base.publish_line) = sign(base.projection_value - base.publish_line)
      THEN 'toward_projection'
    ELSE 'away_from_projection'
  END AS movement_direction,
  CASE
    WHEN base.resolution_state <> 'PLAYED' OR base.publish_line IS NULL OR base.actual_result IS NULL OR base.side IS NULL
      THEN NULL
    WHEN base.actual_result = base.publish_line THEN 'push'
    WHEN base.side = 'over' AND base.actual_result > base.publish_line THEN 'beat'
    WHEN base.side = 'over' AND base.actual_result < base.publish_line THEN 'miss'
    WHEN base.side = 'under' AND base.actual_result < base.publish_line THEN 'beat'
    WHEN base.side = 'under' AND base.actual_result > base.publish_line THEN 'miss'
  END AS side_result,
  CASE
    WHEN base.publish_line IS NOT NULL AND base.closing_line IS NOT NULL
      THEN base.publish_line - base.closing_line
  END AS clv_line_delta,
  (base.resolution_state = 'PLAYED') AS included_in_primary_accuracy
FROM analytics.v_projection_performance base;

COMMENT ON VIEW analytics.v_projection_performance IS
  'Authoritative pre-grade join. Excludes backfill, test, late, and tip-moved captures. Market comparison is not official. Missing closes stay null.';
COMMENT ON VIEW analytics.v_projection_performance_grades IS
  'Derived errors and same-book line deltas. Null when the input is missing. Not ROI. Primary accuracy is PLAYED only.';
