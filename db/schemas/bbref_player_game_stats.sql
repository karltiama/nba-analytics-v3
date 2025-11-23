-- BBREF PLAYER GAME STATS
-- Normalized table for player game statistics from Basketball Reference scraped data
-- This table is separate from player_game_stats to maintain data source integrity
-- IMPORTANT: This table ONLY contains data from Basketball Reference sources
-- All entries must have source = 'bbref' and game_id must exist in bbref_schedule
create table if not exists bbref_player_game_stats (
  game_id                  text not null references games(game_id) on delete cascade,
  player_id                text not null references players(player_id) on delete cascade,
  team_id                  text not null references teams(team_id),
  minutes                  numeric,
  points                   int,
  rebounds                 int,
  assists                  int,
  steals                   int,
  blocks                   int,
  turnovers                int,
  field_goals_made         int,
  field_goals_attempted     int,
  three_pointers_made       int,
  three_pointers_attempted  int,
  free_throws_made          int,
  free_throws_attempted     int,
  offensive_rebounds       int,  -- Available from bbref
  defensive_rebounds       int,  -- Available from bbref
  personal_fouls            int,  -- Available from bbref
  plus_minus               int,
  started                  boolean,
  dnp_reason               text,
  -- Source tracking
  source                   text not null default 'bbref',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  primary key (game_id, player_id),
  -- Ensure source is always 'bbref' to prevent data mixing
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


