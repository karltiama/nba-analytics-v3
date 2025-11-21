-- BASKETBALL REFERENCE BOX SCORES (CSV SOURCE)
-- Fresh table for storing box score data scraped from Basketball Reference CSV exports
-- This provides a clean start for box score data collection

create table if not exists bbref_boxscores_csv (
  id                      bigserial primary key,
  game_id                 text not null references games(game_id) on delete cascade,
  bbref_game_id           text,  -- From bbref_schedule for reference
  team_code               text not null,  -- 3-letter team code (e.g., 'HOU', 'OKC')
  player_name             text not null,  -- Full player name as scraped
  player_id               text references players(player_id),  -- Resolved player ID (nullable)
  mp                      text,  -- Minutes played (as string from CSV, e.g., "34:12")
  minutes                 numeric,  -- Parsed decimal minutes
  fg                      int,  -- Field goals made
  fga                      int,  -- Field goals attempted
  fg_pct                   numeric,  -- Field goal percentage
  three_p                 int,  -- 3-pointers made
  three_pa                int,  -- 3-pointers attempted
  three_p_pct             numeric,  -- 3-point percentage
  ft                      int,  -- Free throws made
  fta                     int,  -- Free throws attempted
  ft_pct                  numeric,  -- Free throw percentage
  orb                     int,  -- Offensive rebounds
  drb                     int,  -- Defensive rebounds
  trb                     int,  -- Total rebounds
  ast                     int,  -- Assists
  stl                     int,  -- Steals
  blk                     int,  -- Blocks
  tov                     int,  -- Turnovers
  pf                      int,  -- Personal fouls
  pts                     int,  -- Points
  plus_minus              int,  -- Plus/minus
  started                 boolean,  -- Whether player started
  dnp_reason              text,  -- "Did Not Play" reason if applicable
  raw_csv_row             jsonb,  -- Store raw CSV row for debugging/reference
  scraped_at              timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists bbref_boxscores_csv_game_id_idx 
  on bbref_boxscores_csv (game_id);
  
create index if not exists bbref_boxscores_csv_player_id_idx 
  on bbref_boxscores_csv (player_id) where player_id is not null;
  
create index if not exists bbref_boxscores_csv_team_code_idx 
  on bbref_boxscores_csv (team_code);
  
create index if not exists bbref_boxscores_csv_bbref_game_id_idx 
  on bbref_boxscores_csv (bbref_game_id) where bbref_game_id is not null;

-- Unique constraint: one row per game + team + player
create unique index if not exists bbref_boxscores_csv_unique_idx 
  on bbref_boxscores_csv (game_id, team_code, player_name);


