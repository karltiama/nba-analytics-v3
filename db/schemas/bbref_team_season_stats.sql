-- BBREF TEAM SEASON STATS (Materialized View)
-- Aggregated season statistics from bbref_team_game_stats
-- This provides fast queries for season-level stats without recalculating each time

CREATE MATERIALIZED VIEW IF NOT EXISTS bbref_team_season_stats AS
WITH team_games AS (
  -- Count all Final games for each team from bbref_games
  SELECT 
    team_id,
    COUNT(DISTINCT bbref_game_id) as total_games_played
  FROM (
    SELECT home_team_id as team_id, bbref_game_id FROM bbref_games WHERE status = 'Final'
    UNION ALL
    SELECT away_team_id as team_id, bbref_game_id FROM bbref_games WHERE status = 'Final'
  ) all_team_games
  GROUP BY team_id
),
team_stats AS (
  -- Aggregate stats from games that have stats
  SELECT 
    btgs.team_id,
    COUNT(DISTINCT btgs.game_id) as games_with_stats,
    
    -- Scoring
    AVG(btgs.points) as avg_points,
    SUM(btgs.points) as total_points,
    AVG(CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END) as avg_points_against,
    SUM(CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END) as total_points_against,
    AVG(btgs.points) - AVG(CASE WHEN btgs.is_home THEN bg.away_score ELSE bg.home_score END) as scoring_differential,
    
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
    AVG(btgs.possessions * 48.0 / NULLIF(btgs.minutes, 0)) as pace
    
  FROM bbref_team_game_stats btgs
  JOIN bbref_games bg ON btgs.game_id = bg.bbref_game_id
  WHERE btgs.source = 'bbref'
    AND bg.status = 'Final'
  GROUP BY btgs.team_id
),
team_wins_losses AS (
  -- Calculate wins/losses from all Final games (not just games with stats)
  SELECT 
    team_id,
    SUM(CASE 
      WHEN (is_home AND home_score > away_score) 
        OR (NOT is_home AND away_score > home_score) 
      THEN 1 ELSE 0 
    END) as wins,
    SUM(CASE 
      WHEN (is_home AND home_score < away_score) 
        OR (NOT is_home AND away_score < home_score) 
      THEN 1 ELSE 0 
    END) as losses
  FROM (
    SELECT 
      bg.home_team_id as team_id,
      bg.bbref_game_id,
      true as is_home,
      bg.home_score,
      bg.away_score
    FROM bbref_games bg
    WHERE bg.status = 'Final'
    UNION ALL
    SELECT 
      bg.away_team_id as team_id,
      bg.bbref_game_id,
      false as is_home,
      bg.home_score,
      bg.away_score
    FROM bbref_games bg
    WHERE bg.status = 'Final'
  ) all_games
  GROUP BY team_id
)
SELECT 
  COALESCE(tg.team_id, ts.team_id, twl.team_id) as team_id,
  COALESCE(tg.total_games_played, 0) as games_played,
  
  -- Stats (from games with stats)
  ts.avg_points,
  ts.total_points,
  ts.avg_points_against,
  ts.total_points_against,
  ts.scoring_differential,
  ts.fg_pct,
  ts.avg_fgm,
  ts.total_fgm,
  ts.avg_fga,
  ts.total_fga,
  ts.three_pct,
  ts.avg_3pm,
  ts.total_3pm,
  ts.avg_3pa,
  ts.total_3pa,
  ts.ft_pct,
  ts.avg_ftm,
  ts.total_ftm,
  ts.avg_fta,
  ts.total_fta,
  ts.avg_rebounds,
  ts.total_rebounds,
  ts.avg_orb,
  ts.total_orb,
  ts.avg_drb,
  ts.total_drb,
  ts.avg_assists,
  ts.total_assists,
  ts.avg_steals,
  ts.total_steals,
  ts.avg_blocks,
  ts.total_blocks,
  ts.avg_turnovers,
  ts.total_turnovers,
  ts.avg_pf,
  ts.total_pf,
  ts.avg_possessions,
  ts.total_possessions,
  ts.pace,
  
  -- Win/Loss Record (from all Final games)
  COALESCE(twl.wins, 0) as wins,
  COALESCE(twl.losses, 0) as losses
  
FROM team_games tg
FULL OUTER JOIN team_stats ts ON tg.team_id = ts.team_id
FULL OUTER JOIN team_wins_losses twl ON COALESCE(tg.team_id, ts.team_id) = twl.team_id;

-- Create index for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS bbref_team_season_stats_team_idx 
  ON bbref_team_season_stats (team_id);

-- Refresh function (call this after ETL runs or on schedule)
-- REFRESH MATERIALIZED VIEW bbref_team_season_stats;

