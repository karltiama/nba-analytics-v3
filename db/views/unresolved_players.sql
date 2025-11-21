-- View: Unresolved Players from Scraped Box Scores
-- Shows players that have box score data but no resolved player_id
-- Useful for identifying players that need manual resolution

CREATE OR REPLACE VIEW unresolved_players AS
SELECT 
  sb.player_name,
  sb.team_code,
  COUNT(DISTINCT sb.game_id) as game_count,
  COUNT(*) as stat_record_count,
  MIN(sb.game_date) as first_seen,
  MAX(sb.game_date) as last_seen,
  SUM(sb.points) as total_points,
  AVG(sb.points) as avg_points,
  MAX(sb.points) as max_points,
  -- Show sample game IDs for reference
  ARRAY_AGG(DISTINCT sb.game_id ORDER BY sb.game_id) FILTER (WHERE sb.game_id IS NOT NULL) as sample_game_ids
FROM scraped_boxscores sb
WHERE sb.player_id IS NULL
GROUP BY sb.player_name, sb.team_code
ORDER BY stat_record_count DESC, player_name;

-- Index to support this view efficiently
CREATE INDEX IF NOT EXISTS scraped_boxscores_unresolved_idx 
  ON scraped_boxscores (player_name, team_code) 
  WHERE player_id IS NULL;

