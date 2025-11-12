-- PLAYER GAME STATS
-- Stores box score level statistics per player per game.
create table if not exists player_game_stats (
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
  field_goals_attempted    int,
  three_pointers_made      int,
  three_pointers_attempted int,
  free_throws_made         int,
  free_throws_attempted    int,
  plus_minus               int,
  started                  boolean,
  dnp_reason               text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  primary key (game_id, player_id)
);

create index if not exists player_game_stats_team_idx
  on player_game_stats (team_id);

