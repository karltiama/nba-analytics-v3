-- SCRAPED BOX SCORES
-- Clean table for storing box score data scraped from Basketball Reference
-- This is a fresh start, separate from existing player_game_stats table

create table if not exists scraped_boxscores (
  id                      bigserial primary key,
  game_id                 text not null,  -- Reference to games table (no FK to allow flexibility)
  game_date               date not null,  -- Game date for easy querying
  team_code               text not null,  -- 3-letter team code (e.g., 'HOU', 'OKC')
  player_name             text not null,  -- Full player name as scraped
  player_id               text,  -- Resolved player ID (nullable, can be filled later)
  
  -- Basic stats
  minutes                 numeric,  -- Minutes played (decimal, e.g., 34.5)
  points                  int,
  rebounds                int,
  assists                 int,
  steals                  int,
  blocks                  int,
  turnovers               int,
  
  -- Shooting stats
  field_goals_made        int,
  field_goals_attempted   int,
  field_goal_pct          numeric,
  three_pointers_made     int,
  three_pointers_attempted int,
  three_point_pct         numeric,
  free_throws_made        int,
  free_throws_attempted   int,
  free_throw_pct          numeric,
  
  -- Rebounding breakdown
  offensive_rebounds      int,
  defensive_rebounds      int,
  
  -- Other stats
  personal_fouls          int,
  plus_minus              int,
  
  -- Metadata
  started                 boolean,  -- Whether player started
  dnp_reason              text,  -- "Did Not Play" reason if applicable
  
  -- Source tracking
  source                  text not null default 'bbref_csv',  -- Source of data
  raw_data                jsonb,  -- Store raw scraped data for debugging
  
  -- Timestamps
  scraped_at              timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Indexes for common queries
create index if not exists scraped_boxscores_game_id_idx 
  on scraped_boxscores (game_id);
  
create index if not exists scraped_boxscores_game_date_idx 
  on scraped_boxscores (game_date);
  
create index if not exists scraped_boxscores_player_id_idx 
  on scraped_boxscores (player_id) where player_id is not null;
  
create index if not exists scraped_boxscores_team_code_idx 
  on scraped_boxscores (team_code);
  
create index if not exists scraped_boxscores_source_idx 
  on scraped_boxscores (source);

-- Unique constraint: one row per game + team + player
-- This prevents duplicates when re-scraping
create unique index if not exists scraped_boxscores_unique_idx 
  on scraped_boxscores (game_id, team_code, player_name, source);

-- Index for querying by date range
create index if not exists scraped_boxscores_date_range_idx 
  on scraped_boxscores (game_date, team_code);

