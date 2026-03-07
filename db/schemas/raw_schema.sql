-- Raw schema: mirrors BallDontLie API response structure.
-- No FKs to other schemas; data is loaded as-is from the API.
-- Run this before populating from the seed script.

create schema if not exists raw;

-- raw.teams (GET /v1/teams)
create table if not exists raw.teams (
  id            integer primary key,
  abbreviation  text,
  city          text,
  conference    text,
  division      text,
  full_name     text,
  name          text,
  created_at    timestamptz not null default now()
);

-- raw.players (GET /nba/v1/players) - NBAPlayer shape
create table if not exists raw.players (
  id            integer primary key,
  first_name    text,
  last_name     text,
  position      text,
  height        text,
  weight        text,
  jersey_number text,
  college       text,
  country       text,
  draft_year    integer,
  draft_round   integer,
  draft_number  integer,
  team_id       integer,              -- denormalized from nested team.id
  created_at    timestamptz not null default now()
);

create index if not exists raw_players_team_id_idx on raw.players (team_id);

-- raw.games (GET /v1/games) - NBAGame shape; nested teams stored as jsonb
create table if not exists raw.games (
  id                integer primary key,
  date              date,
  season            integer,
  status            text,
  period            integer,
  time              text,
  period_detail     text,
  datetime          timestamptz,
  postseason        boolean default false,
  home_team_score   integer,
  visitor_team_score integer,
  home_team         jsonb,             -- full team object from API
  visitor_team      jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists raw_games_season_date_idx on raw.games (season, date);
create index if not exists raw_games_status_idx on raw.games (status);

-- raw.player_game_stats (GET /nba/v1/stats) - NBAStats shape; nested player/team/game as jsonb
create table if not exists raw.player_game_stats (
  id          integer primary key,
  min         text,
  fgm         integer,
  fga         integer,
  fg_pct      numeric,
  fg3m        integer,
  fg3a        integer,
  fg3_pct     numeric,
  ftm         integer,
  fta         integer,
  ft_pct      numeric,
  oreb        integer,
  dreb        integer,
  reb         integer,
  ast         integer,
  stl         integer,
  blk         integer,
  turnover    integer,
  pf          integer,
  pts         integer,
  plus_minus  integer,
  player_id   integer,                 -- denormalized from nested player.id
  team_id     integer,                 -- denormalized from nested team.id
  game_id     integer,                 -- denormalized from nested game.id
  player      jsonb,
  team        jsonb,
  game        jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists raw_player_game_stats_game_id_idx on raw.player_game_stats (game_id);
create index if not exists raw_player_game_stats_player_id_idx on raw.player_game_stats (player_id);

-- raw.season_averages (GET /nba/v1/season_averages) - NBASeasonAverages shape
create table if not exists raw.season_averages (
  id            serial primary key,
  player_id     integer not null,
  season        integer not null,
  games_played  integer,
  pts           numeric,
  ast           numeric,
  reb           numeric,
  stl           numeric,
  blk           numeric,
  turnover      numeric,
  min           text,
  fgm           numeric,
  fga           numeric,
  fg_pct        numeric,
  fg3m          numeric,
  fg3a          numeric,
  fg3_pct       numeric,
  ftm           numeric,
  fta           numeric,
  ft_pct        numeric,
  oreb          numeric,
  dreb          numeric,
  created_at    timestamptz not null default now(),
  unique (player_id, season)
);

create index if not exists raw_season_averages_player_season_idx on raw.season_averages (player_id, season);
