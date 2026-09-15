-- Disposable local schema for shadow/injury collection tests. Not for production.

create schema if not exists raw;
create schema if not exists analytics;

create table if not exists analytics.teams (
  team_id text primary key
);

create table if not exists analytics.players (
  player_id text primary key
);

create table if not exists analytics.games (
  game_id text primary key,
  season text,
  start_time timestamptz,
  home_team_id text references analytics.teams(team_id),
  away_team_id text references analytics.teams(team_id),
  status text
);

create table if not exists analytics.player_game_logs (
  player_id text references analytics.players(player_id),
  game_id text references analytics.games(game_id),
  team_id text,
  game_date date,
  minutes text,
  points numeric,
  rebounds numeric,
  assists numeric,
  three_pointers_made numeric,
  field_goals_attempted numeric,
  three_pointers_attempted numeric,
  free_throws_attempted numeric,
  primary key (player_id, game_id)
);

create table if not exists analytics.team_game_stats (
  game_id text,
  team_id text,
  opponent_team_id text,
  season text,
  team_points numeric,
  team_fga numeric,
  team_3pa numeric,
  team_fta numeric,
  team_turnovers numeric,
  offensive_rebounds numeric,
  points_allowed numeric,
  opponent_fga numeric,
  opponent_fta numeric,
  opponent_turnovers numeric,
  opponent_offensive_rebounds numeric,
  primary key (game_id, team_id)
);

create table if not exists raw.injury_pull_runs (
  pull_run_id bigserial primary key,
  pulled_at timestamptz not null default now(),
  provider text not null default 'balldontlie',
  rows_returned integer,
  rows_stored integer,
  status text not null default 'started',
  error_message text,
  metadata jsonb,
  completed_at timestamptz
);

create table if not exists raw.player_injuries (
  snapshot_id          bigserial primary key,
  pull_run_id          bigint not null references raw.injury_pull_runs(pull_run_id),
  provider_player_id   integer not null,
  provider_team_id     integer,
  status               text,
  description          text,
  return_date_raw      text,
  raw_payload          jsonb,
  created_at           timestamptz not null default now()
);

create table if not exists analytics.player_injury_status_history (
  id               bigserial primary key,
  player_id        text not null references analytics.players(player_id) on delete cascade,
  team_id          text references analytics.teams(team_id),
  status           text,
  description      text,
  return_date_raw  text,
  snapshot_at      timestamptz not null,
  pull_run_id      bigint,
  created_at       timestamptz not null default now()
);
