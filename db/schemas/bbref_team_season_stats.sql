-- BBREF TEAM SEASON STATS (Materialized View)
-- Aggregated season statistics from bbref_team_game_stats
-- This provides fast queries for season-level stats without recalculating each time

CREATE MATERIALIZED VIEW IF NOT EXISTS bbref_team_season_stats AS
SELECT 
  btgs.team_id,
  COUNT(DISTINCT btgs.game_id) as games_played,
  
  -- Scoring
  AVG(btgs.points) as avg_points,
  SUM(btgs.points) as total_points,
  AVG(CASE WHEN btgs.is_home THEN g.away_score ELSE g.home_score END) as avg_points_against,
  SUM(CASE WHEN btgs.is_home THEN g.away_score ELSE g.home_score END) as total_points_against,
  AVG(btgs.points) - AVG(CASE WHEN btgs.is_home THEN g.away_score ELSE g.home_score END) as scoring_differential,
  
  -- Field Goals
  AVG(btgs.field_goals_made::numeric / NULLIF(btgs.field_goals_attempted, 0)) * 100 as fg_pct,
  AVG(btgs.field_goals_made) as avg_fgm,
  SUM(btgs.field_goals_made) as total_fgm,
  AVG(btgs.field_goals_attempted) as avg_fga,
  SUM(btgs.field_goals_attempted) as total_fga,
  
  -- Three Pointers
  AVG(btgs.three_pointers_made::numeric / NULLIF(btgs.three_pointers_attempted, 0)) * 100 as three_pct,
  AVG(btgs.three_pointers_made) as avg_3pm,
  SUM(btgs.three_pointers_made) as total_3pm,
  AVG(btgs.three_pointers_attempted) as avg_3pa,
  SUM(btgs.three_pointers_attempted) as total_3pa,
  
  -- Free Throws
  AVG(btgs.free_throws_made::numeric / NULLIF(btgs.free_throws_attempted, 0)) * 100 as ft_pct,
  AVG(btgs.free_throws_made) as avg_ftm,
  SUM(btgs.free_throws_made) as total_ftm,
  AVG(btgs.free_throws_attempted) as avg_fta,
  SUM(btgs.free_throws_attempted) as total_fta,
  
  -- Rebounds
  AVG(btgs.rebounds) as avg_rebounds,
  SUM(btgs.rebounds) as total_rebounds,
  AVG(btgs.offensive_rebounds) as avg_orb,
  SUM(btgs.offensive_rebounds) as total_orb,
  AVG(btgs.defensive_rebounds) as avg_drb,
  SUM(btgs.defensive_rebounds) as total_drb,
  
  -- Other Stats
  AVG(btgs.assists) as avg_assists,
  SUM(btgs.assists) as total_assists,
  AVG(btgs.steals) as avg_steals,
  SUM(btgs.steals) as total_steals,
  AVG(btgs.blocks) as avg_blocks,
  SUM(btgs.blocks) as total_blocks,
  AVG(btgs.turnovers) as avg_turnovers,
  SUM(btgs.turnovers) as total_turnovers,
  AVG(btgs.personal_fouls) as avg_pf,
  SUM(btgs.personal_fouls) as total_pf,
  AVG(btgs.possessions) as avg_possessions,
  SUM(btgs.possessions) as total_possessions,
  
  -- Calculated Metrics
  AVG(btgs.possessions * 48.0 / NULLIF(btgs.minutes, 0)) as pace,
  
  -- Win/Loss Record
  SUM(CASE 
    WHEN (btgs.is_home AND g.home_score > g.away_score) 
      OR (NOT btgs.is_home AND g.away_score > g.home_score) 
    THEN 1 ELSE 0 
  END) as wins,
  SUM(CASE 
    WHEN (btgs.is_home AND g.home_score < g.away_score) 
      OR (NOT btgs.is_home AND g.away_score < g.home_score) 
    THEN 1 ELSE 0 
  END) as losses
  
FROM bbref_team_game_stats btgs
JOIN games g ON btgs.game_id = g.game_id
GROUP BY btgs.team_id;

-- Create index for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS bbref_team_season_stats_team_idx 
  ON bbref_team_season_stats (team_id);

-- Refresh function (call this after ETL runs or on schedule)
-- REFRESH MATERIALIZED VIEW bbref_team_season_stats;

