-- Check Deprecated Tables Before Dropping
-- Run this FIRST to see what data exists in deprecated tables
-- This will help you decide if you need to migrate data before dropping

-- ============================================
-- 1. Check bbref_player_game_stats
-- ============================================
SELECT 
  'bbref_player_game_stats' as table_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT game_id) as unique_games,
  COUNT(DISTINCT player_id) as unique_players,
  MIN(created_at) as earliest_data,
  MAX(created_at) as latest_data
FROM bbref_player_game_stats;

-- Sample of recent data
SELECT 
  game_id,
  player_id,
  points,
  rebounds,
  created_at
FROM bbref_player_game_stats
ORDER BY created_at DESC
LIMIT 5;

-- ============================================
-- 2. Check bbref_team_game_stats
-- ============================================
SELECT 
  'bbref_team_game_stats' as table_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT game_id) as unique_games,
  COUNT(DISTINCT team_id) as unique_teams,
  MIN(created_at) as earliest_data,
  MAX(created_at) as latest_data
FROM bbref_team_game_stats;

-- Sample of recent data
SELECT 
  game_id,
  team_id,
  points,
  rebounds,
  created_at
FROM bbref_team_game_stats
ORDER BY created_at DESC
LIMIT 5;

-- ============================================
-- 3. Check scraped_boxscores
-- ============================================
SELECT 
  'scraped_boxscores' as table_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT game_id) as unique_games,
  COUNT(DISTINCT player_id) as unique_players_with_id,
  COUNT(*) FILTER (WHERE player_id IS NULL) as players_without_id,
  MIN(created_at) as earliest_data,
  MAX(created_at) as latest_data
FROM scraped_boxscores;

-- Sample of recent data
SELECT 
  game_id,
  player_name,
  player_id,
  points,
  source,
  created_at
FROM scraped_boxscores
ORDER BY created_at DESC
LIMIT 5;

-- ============================================
-- 4. Check bbref_boxscores_csv
-- ============================================
SELECT 
  'bbref_boxscores_csv' as table_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT game_id) as unique_games,
  COUNT(DISTINCT player_id) as unique_players,
  MIN(created_at) as earliest_data,
  MAX(created_at) as latest_data
FROM bbref_boxscores_csv;

-- ============================================
-- 5. Compare with main tables
-- ============================================
-- Check if main tables have data
SELECT 
  'player_game_stats (main)' as table_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT game_id) as unique_games,
  COUNT(DISTINCT player_id) as unique_players
FROM player_game_stats;

SELECT 
  'team_game_stats (main)' as table_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT game_id) as unique_games,
  COUNT(DISTINCT team_id) as unique_teams
FROM team_game_stats;

-- ============================================
-- 6. Check for games in deprecated tables that aren't in main tables
-- ============================================
-- Games in bbref_player_game_stats but not in player_game_stats
SELECT 
  'Games in bbref_player_game_stats but NOT in player_game_stats' as check_type,
  COUNT(DISTINCT bpgs.game_id) as missing_games
FROM bbref_player_game_stats bpgs
LEFT JOIN player_game_stats pgs ON bpgs.game_id = pgs.game_id
WHERE pgs.game_id IS NULL;

-- Games in scraped_boxscores but not in player_game_stats
SELECT 
  'Games in scraped_boxscores but NOT in player_game_stats' as check_type,
  COUNT(DISTINCT sb.game_id) as missing_games
FROM scraped_boxscores sb
LEFT JOIN player_game_stats pgs ON sb.game_id = pgs.game_id
WHERE pgs.game_id IS NULL;

