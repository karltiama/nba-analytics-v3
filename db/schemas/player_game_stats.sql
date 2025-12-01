-- PLAYER GAME STATS
-- Stores box score level statistics per player per game.
-- Source: Basketball Reference only (all data from bbref.com)
create table if not exists player_game_stats (
  game_id                  text not null references games(game_id) on delete cascade,
  player_id                text not null references players(player_id) on delete cascade,
  team_id                  text not null references teams(team_id),
  minutes                  numeric,
  points                   int,
  rebounds                 int,
  offensive_rebounds       int,  -- Available from Basketball Reference
  defensive_rebounds       int,  -- Available from Basketball Reference
  assists                  int,
  steals                   int,
  blocks                   int,
  turnovers                int,
  personal_fouls           int,  -- Available from Basketball Reference
  field_goals_made         int,
  field_goals_attempted    int,
  three_pointers_made      int,
  three_pointers_attempted int,
  free_throws_made         int,
  free_throws_attempted    int,
  plus_minus               int,
  started                  boolean,
  dnp_reason               text,
  -- Source tracking (Basketball Reference only)
  source                   text not null default 'bbref',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  primary key (game_id, player_id),
  -- Ensure all data is from Basketball Reference
  constraint player_game_stats_source_check check (source = 'bbref')
);

create index if not exists player_game_stats_team_idx
  on player_game_stats (team_id);

