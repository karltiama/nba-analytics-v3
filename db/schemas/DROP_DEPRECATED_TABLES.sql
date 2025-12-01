-- Drop Deprecated Tables
-- ⚠️ WARNING: Run CHECK_DEPRECATED_TABLES.sql FIRST to verify it's safe!
-- ⚠️ This will PERMANENTLY DELETE these tables and all their data!
-- 
-- Only run this if:
-- 1. You've checked the tables have no important data (or data has been migrated)
-- 2. You've updated all scripts that reference these tables
-- 3. You're sure you want to delete them

-- ============================================
-- STEP 1: Drop foreign key constraints first
-- ============================================

-- Drop constraints on bbref_player_game_stats (if any)
ALTER TABLE bbref_player_game_stats
  DROP CONSTRAINT IF EXISTS bbref_player_game_stats_game_id_fkey,
  DROP CONSTRAINT IF EXISTS bbref_player_game_stats_player_id_fkey,
  DROP CONSTRAINT IF EXISTS bbref_player_game_stats_team_id_fkey;

-- Drop constraints on bbref_team_game_stats (if any)
ALTER TABLE bbref_team_game_stats
  DROP CONSTRAINT IF EXISTS bbref_team_game_stats_game_id_fkey,
  DROP CONSTRAINT IF EXISTS bbref_team_game_stats_team_id_fkey;

-- Drop constraints on scraped_boxscores (if any)
-- Note: scraped_boxscores might not have foreign keys

-- Drop constraints on bbref_boxscores_csv (if any)
ALTER TABLE bbref_boxscores_csv
  DROP CONSTRAINT IF EXISTS bbref_boxscores_csv_game_id_fkey,
  DROP CONSTRAINT IF EXISTS bbref_boxscores_csv_player_id_fkey;

-- ============================================
-- STEP 2: Drop the tables
-- ============================================

-- Drop deprecated box score tables
DROP TABLE IF EXISTS bbref_player_game_stats CASCADE;
DROP TABLE IF EXISTS bbref_team_game_stats CASCADE;
DROP TABLE IF EXISTS scraped_boxscores CASCADE;
DROP TABLE IF EXISTS bbref_boxscores_csv CASCADE;

-- ============================================
-- VERIFICATION: Confirm tables are dropped
-- ============================================
-- Run this to verify:
-- SELECT table_name 
-- FROM information_schema.tables 
-- WHERE table_schema = 'public' 
--   AND table_name IN (
--     'bbref_player_game_stats',
--     'bbref_team_game_stats', 
--     'scraped_boxscores',
--     'bbref_boxscores_csv'
--   );
-- 
-- Should return 0 rows if tables are successfully dropped

