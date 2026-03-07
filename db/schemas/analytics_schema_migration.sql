-- Migration: Add derived columns to analytics.player_game_logs and create analytics.player_season_averages.
-- Run after analytics_schema.sql. Safe to run multiple times (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS where supported).

-- 1. Add columns to analytics.player_game_logs (derived by transform script)
alter table analytics.player_game_logs
  add column if not exists opponent_team_id text references analytics.teams(team_id),
  add column if not exists is_home boolean,
  add column if not exists game_date date,
  add column if not exists season text,
  add column if not exists pra integer;

create index if not exists analytics_player_game_logs_player_season_idx on analytics.player_game_logs (player_id, season);
create index if not exists analytics_player_game_logs_game_date_idx on analytics.player_game_logs (game_date);

-- 2. Create analytics.player_season_averages (populated by compute-player-season-averages.ts)
create table if not exists analytics.player_season_averages (
  player_id     text not null references analytics.players(player_id) on delete cascade,
  season        text not null,
  games_played   integer not null default 0,
  pts_avg        numeric,
  reb_avg        numeric,
  ast_avg        numeric,
  stl_avg        numeric,
  blk_avg        numeric,
  turnover_avg   numeric,
  pra_avg        numeric,
  fg_pct         numeric,
  fg3_pct        numeric,
  ft_pct         numeric,
  updated_at     timestamptz not null default now(),
  primary key (player_id, season)
);

create index if not exists analytics_player_season_averages_season_idx on analytics.player_season_averages (season);
