-- Migration: Add Basketball Reference fields to player_game_stats and team_game_stats
-- Run this migration to add the new fields to existing tables

-- Add new fields to player_game_stats
ALTER TABLE player_game_stats
  ADD COLUMN IF NOT EXISTS offensive_rebounds int,
  ADD COLUMN IF NOT EXISTS defensive_rebounds int,
  ADD COLUMN IF NOT EXISTS personal_fouls int,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'bbref';

-- Add constraint to ensure source is always 'bbref'
ALTER TABLE player_game_stats
  DROP CONSTRAINT IF EXISTS player_game_stats_source_check;

ALTER TABLE player_game_stats
  ADD CONSTRAINT player_game_stats_source_check CHECK (source = 'bbref');

-- Add source field to team_game_stats (if not exists)
ALTER TABLE team_game_stats
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'bbref';

-- Add constraint to ensure source is always 'bbref'
ALTER TABLE team_game_stats
  DROP CONSTRAINT IF EXISTS team_game_stats_source_check;

ALTER TABLE team_game_stats
  ADD CONSTRAINT team_game_stats_source_check CHECK (source = 'bbref');

-- Note: offensive_rebounds, defensive_rebounds, and personal_fouls should already exist in team_game_stats
-- If they don't, add them:
-- ALTER TABLE team_game_stats
--   ADD COLUMN IF NOT EXISTS offensive_rebounds int,
--   ADD COLUMN IF NOT EXISTS defensive_rebounds int,
--   ADD COLUMN IF NOT EXISTS personal_fouls int;

-- Create index on source field for player_game_stats
CREATE INDEX IF NOT EXISTS player_game_stats_source_idx ON player_game_stats (source);

-- Create index on source field for team_game_stats
CREATE INDEX IF NOT EXISTS team_game_stats_source_idx ON team_game_stats (source);

