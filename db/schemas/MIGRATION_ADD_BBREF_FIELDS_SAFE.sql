-- Migration: Add Basketball Reference fields to player_game_stats and team_game_stats
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql
-- 
-- This migration is safe to run multiple times (uses IF NOT EXISTS)

-- ============================================
-- STEP 1: Add new fields to player_game_stats
-- ============================================
ALTER TABLE player_game_stats
  ADD COLUMN IF NOT EXISTS offensive_rebounds int,
  ADD COLUMN IF NOT EXISTS defensive_rebounds int,
  ADD COLUMN IF NOT EXISTS personal_fouls int,
  ADD COLUMN IF NOT EXISTS source text;

-- Set default for existing rows (if source is NULL)
UPDATE player_game_stats
SET source = 'bbref'
WHERE source IS NULL;

-- Make source NOT NULL with default (after setting existing rows)
ALTER TABLE player_game_stats
  ALTER COLUMN source SET DEFAULT 'bbref',
  ALTER COLUMN source SET NOT NULL;

-- ============================================
-- STEP 2: Add constraint to player_game_stats
-- ============================================
-- Drop existing constraint if it exists
ALTER TABLE player_game_stats
  DROP CONSTRAINT IF EXISTS player_game_stats_source_check;

-- Add constraint to ensure source is always 'bbref'
ALTER TABLE player_game_stats
  ADD CONSTRAINT player_game_stats_source_check CHECK (source = 'bbref');

-- ============================================
-- STEP 3: Add source field to team_game_stats
-- ============================================
ALTER TABLE team_game_stats
  ADD COLUMN IF NOT EXISTS source text;

-- Set default for existing rows (if source is NULL)
UPDATE team_game_stats
SET source = 'bbref'
WHERE source IS NULL;

-- Make source NOT NULL with default (after setting existing rows)
ALTER TABLE team_game_stats
  ALTER COLUMN source SET DEFAULT 'bbref',
  ALTER COLUMN source SET NOT NULL;

-- ============================================
-- STEP 4: Add constraint to team_game_stats
-- ============================================
-- Drop existing constraint if it exists
ALTER TABLE team_game_stats
  DROP CONSTRAINT IF EXISTS team_game_stats_source_check;

-- Add constraint to ensure source is always 'bbref'
ALTER TABLE team_game_stats
  ADD CONSTRAINT team_game_stats_source_check CHECK (source = 'bbref');

-- ============================================
-- STEP 5: Create indexes
-- ============================================
CREATE INDEX IF NOT EXISTS player_game_stats_source_idx ON player_game_stats (source);
CREATE INDEX IF NOT EXISTS team_game_stats_source_idx ON team_game_stats (source);

-- ============================================
-- VERIFICATION: Check the changes
-- ============================================
-- Run these queries to verify:
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'player_game_stats'
--   AND column_name IN ('offensive_rebounds', 'defensive_rebounds', 'personal_fouls', 'source')
-- ORDER BY column_name;
--
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'team_game_stats'
--   AND column_name = 'source';

