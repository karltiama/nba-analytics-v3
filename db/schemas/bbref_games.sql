-- BBREF GAMES
-- Standalone games table for Basketball Reference data
-- This is completely independent from the canonical games table
-- All BBRef stats and schedule data reference this table

create table if not exists bbref_games (
  bbref_game_id     text primary key,        -- Format: bbref_YYYYMMDDHHMM_AWAY_HOME
  game_date         date not null,           -- Date of the game (ET)
  season            text,                    -- Season (e.g., '2025-26')
  start_time         timestamptz,            -- Game start time (if available)
  status             text,                   -- 'Scheduled' | 'Final' | etc.
  home_team_id       text not null references teams(team_id),
  away_team_id       text not null references teams(team_id),
  home_team_abbr     text not null,          -- BBRef abbreviation (e.g., 'LAL')
  away_team_abbr     text not null,          -- BBRef abbreviation (e.g., 'NOP')
  home_score         int,                    -- Final score if game is complete
  away_score         int,                    -- Final score if game is complete
  venue              text,                   -- Venue name (if available)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint bbref_games_home_away_check check (home_team_id <> away_team_id)
);

-- Indexes for common queries
create index if not exists bbref_games_date_idx on bbref_games (game_date);
create index if not exists bbref_games_season_idx on bbref_games (season);
create index if not exists bbref_games_teams_idx on bbref_games (home_team_id, away_team_id);
create index if not exists bbref_games_status_idx on bbref_games (status);
create index if not exists bbref_games_start_time_idx on bbref_games (start_time);








