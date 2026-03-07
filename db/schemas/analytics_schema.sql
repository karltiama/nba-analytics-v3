-- Analytics schema: normalized tables for the app.
-- Populated by transform from raw.* (to be implemented later).
-- Separate from existing public tables so new data stays isolated.

create schema if not exists analytics;

-- analytics.teams
create table if not exists analytics.teams (
  team_id       text primary key,
  abbreviation  text not null,
  full_name     text not null,
  name          text not null,
  city          text,
  conference    text,
  division      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists analytics_teams_abbreviation_key on analytics.teams (abbreviation);

-- analytics.players
create table if not exists analytics.players (
  player_id     text primary key,
  full_name     text not null,
  first_name    text,
  last_name     text,
  position      text,
  height        text,
  weight        text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists analytics_players_full_name_idx on analytics.players (full_name);

-- analytics.games (references analytics.teams)
create table if not exists analytics.games (
  game_id        text primary key,
  season         text not null,
  start_time     timestamptz,
  status         text,
  home_team_id   text not null references analytics.teams(team_id),
  away_team_id   text not null references analytics.teams(team_id),
  home_score     integer,
  away_score     integer,
  venue          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint analytics_games_home_away_check check (home_team_id <> away_team_id)
);

create index if not exists analytics_games_season_start_idx on analytics.games (season, start_time);

-- analytics.player_game_logs (box score stats per player per game)
create table if not exists analytics.player_game_logs (
  game_id                  text not null references analytics.games(game_id) on delete cascade,
  player_id                text not null references analytics.players(player_id) on delete cascade,
  team_id                  text not null references analytics.teams(team_id),
  minutes                  text,
  points                   integer,
  rebounds                 integer,
  offensive_rebounds       integer,
  defensive_rebounds       integer,
  assists                  integer,
  steals                   integer,
  blocks                   integer,
  turnovers                integer,
  personal_fouls           integer,
  field_goals_made         integer,
  field_goals_attempted    integer,
  three_pointers_made      integer,
  three_pointers_attempted integer,
  free_throws_made         integer,
  free_throws_attempted    integer,
  plus_minus               integer,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  primary key (game_id, player_id)
);

create index if not exists analytics_player_game_logs_team_idx on analytics.player_game_logs (team_id);
create index if not exists analytics_player_game_logs_player_idx on analytics.player_game_logs (player_id);
