-- Transform: raw.player_prop_snapshots -> analytics.player_prop_lines
-- Flattens over_under markets into one row per (game, player, sportsbook, market_type, side, line_value, snapshot_at).
-- Idempotent: ON CONFLICT DO NOTHING on unique key.
-- Run with :pull_run_id optional (e.g. from script); if omitted, processes all raw snapshots.
-- Prerequisites: analytics_player_prop_lines_schema.sql applied.

INSERT INTO analytics.player_prop_lines (
  game_id, player_id, player_name, team_id, sportsbook, market_type, side, line_value,
  odds_american, odds_decimal, implied_probability, snapshot_at
)
SELECT
  s.game_id,
  s.player_id,
  p.full_name,
  gl.team_id,
  s.vendor,
  s.prop_type,
  'over' AS side,
  s.line_value,
  s.over_odds,
  analytics.american_to_decimal(s.over_odds),
  analytics.american_to_implied_prob(s.over_odds),
  COALESCE(s.provider_updated_at, s.created_at) AS snapshot_at
FROM raw.player_prop_snapshots s
LEFT JOIN analytics.players p ON p.player_id = s.player_id
LEFT JOIN analytics.player_game_logs gl ON gl.game_id = s.game_id AND gl.player_id = s.player_id
WHERE s.market_type = 'over_under'
  AND s.over_odds IS NOT NULL
  AND s.game_id IN (SELECT game_id FROM analytics.games)
  AND s.player_id IN (SELECT player_id FROM analytics.players)
  -- Optional: AND s.pull_run_id = $pull_run_id

UNION ALL

SELECT
  s.game_id,
  s.player_id,
  p.full_name,
  gl.team_id,
  s.vendor,
  s.prop_type,
  'under' AS side,
  s.line_value,
  s.under_odds,
  analytics.american_to_decimal(s.under_odds),
  analytics.american_to_implied_prob(s.under_odds),
  COALESCE(s.provider_updated_at, s.created_at) AS snapshot_at
FROM raw.player_prop_snapshots s
LEFT JOIN analytics.players p ON p.player_id = s.player_id
LEFT JOIN analytics.player_game_logs gl ON gl.game_id = s.game_id AND gl.player_id = s.player_id
WHERE s.market_type = 'over_under'
  AND s.under_odds IS NOT NULL
  AND s.game_id IN (SELECT game_id FROM analytics.games)
  AND s.player_id IN (SELECT player_id FROM analytics.players)
  -- Optional: AND s.pull_run_id = $pull_run_id

ON CONFLICT (game_id, player_id, sportsbook, market_type, side, line_value, snapshot_at) DO NOTHING;
