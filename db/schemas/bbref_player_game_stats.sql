-- BBREF PLAYER GAME STATS
-- Authoritative table for player game statistics from Basketball Reference
-- This is the PRIMARY source of truth for all BBRef box score data
-- All BBRef scrapers should write to this table
create table if not exists bbref_player_game_stats (
  game_id                  text not null references bbref_games(bbref_game_id) on delete cascade,
  player_id                text not null references players(player_id) on delete cascade,
  team_id                  text not null references teams(team_id),
  minutes                  numeric,
  points                   int,
  rebounds                 int,
  offensive_rebounds       int,  -- Available from bbref
  defensive_rebounds       int,  -- Available from bbref
  assists                  int,
  steals                   int,
  blocks                   int,
  turnovers                int,
  personal_fouls           int,  -- Available from bbref
  field_goals_made         int,
  field_goals_attempted     int,
  three_pointers_made       int,
  three_pointers_attempted  int,
  free_throws_made          int,
  free_throws_attempted     int,
  plus_minus               int,
  started                  boolean,
  dnp_reason               text,
  -- Source tracking (always 'bbref' for this table)
  source                   text not null default 'bbref',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  primary key (game_id, player_id),
  -- Ensure source is always 'bbref' to maintain data integrity
  constraint bbref_player_game_stats_source_check check (source = 'bbref')
);

create index if not exists bbref_player_game_stats_team_idx
  on bbref_player_game_stats (team_id);

create index if not exists bbref_player_game_stats_player_idx
  on bbref_player_game_stats (player_id);

create index if not exists bbref_player_game_stats_game_idx
  on bbref_player_game_stats (game_id);

create index if not exists bbref_player_game_stats_source_idx
  on bbref_player_game_stats (source);

