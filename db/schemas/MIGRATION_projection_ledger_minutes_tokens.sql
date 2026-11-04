-- Projection ledger: read 2026-27 BallDontLie minutes tokens in v_projection_performance.
--
-- NOT APPLIED. Apply only through the reviewed deploy path (docs/deployment-checklist.md).
-- Replaces only resolution_state; every column, join and filter is unchanged from
-- MIGRATION_projection_ledger.sql, so v_projection_performance_grades (base.*) keeps working.
--
-- Why: 2026-27 analytics.player_game_logs.minutes is "MM:SS" for played games and "0" with no box
-- stats for a DNP (481 of 481 "0" rows had none). Earlier seasons used decimals and "00".
-- The old CASE sent every "MM:SS" row to UNRESOLVED and graded every "0" DNP as PLAYED.
--
-- New rule (matches classifyAppearance / classifyLedgerResolution and classifyWowyAppearance):
--   minutes > 0 (decimal or MM:SS)        -> PLAYED
--   "00"                                   -> DNP_VOID
--   0 minutes ("0", "0.0", "0:00") + stats -> PLAYED
--   0 minutes, no stats                    -> DNP_VOID
--
-- Rollback: re-run the CREATE OR REPLACE VIEW analytics.v_projection_performance statement from
-- MIGRATION_projection_ledger.sql.

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
    WHEN btrim(l.minutes) !~ '^[0-9]+(\.[0-9]+)?$'
     AND btrim(l.minutes) !~ '^[0-9]+:[0-5]?[0-9]$' THEN 'UNRESOLVED'
    WHEN (CASE
            WHEN btrim(l.minutes) ~ '^[0-9]+(\.[0-9]+)?$' THEN btrim(l.minutes)::numeric
            ELSE split_part(btrim(l.minutes), ':', 1)::numeric + split_part(btrim(l.minutes), ':', 2)::numeric / 60
          END) > 0 THEN 'PLAYED'
    WHEN btrim(l.minutes) = '00' THEN 'DNP_VOID'
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

COMMENT ON VIEW analytics.v_projection_performance IS
  'Authoritative pre-grade join. Excludes backfill, test, late, and tip-moved captures. Market comparison is not official. Missing closes stay null.';
