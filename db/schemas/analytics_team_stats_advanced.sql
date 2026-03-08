-- Migration: Add advanced team metrics columns.
-- Run after analytics_team_stats.sql. Safe to run multiple times (ADD COLUMN IF NOT EXISTS).

-- 1. analytics.team_game_stats — ORB/DRB, opponent stats, advanced metrics
alter table analytics.team_game_stats
  add column if not exists offensive_rebounds integer not null default 0,
  add column if not exists defensive_rebounds integer not null default 0,
  add column if not exists opponent_fgm integer not null default 0,
  add column if not exists opponent_fga integer not null default 0,
  add column if not exists opponent_3pm integer not null default 0,
  add column if not exists opponent_3pa integer not null default 0,
  add column if not exists opponent_ftm integer not null default 0,
  add column if not exists opponent_fta integer not null default 0,
  add column if not exists opponent_turnovers integer not null default 0,
  add column if not exists opponent_offensive_rebounds integer not null default 0,
  add column if not exists opponent_defensive_rebounds integer not null default 0,
  add column if not exists estimated_possessions numeric,
  add column if not exists offensive_rating numeric,
  add column if not exists defensive_rating numeric,
  add column if not exists pace numeric,
  add column if not exists efg_pct numeric,
  add column if not exists tov_pct numeric,
  add column if not exists orb_pct numeric;

-- 2. analytics.team_season_averages — home/away splits and advanced averages
alter table analytics.team_season_averages
  add column if not exists home_wins integer not null default 0,
  add column if not exists home_losses integer not null default 0,
  add column if not exists away_wins integer not null default 0,
  add column if not exists away_losses integer not null default 0,
  add column if not exists avg_offensive_rating numeric,
  add column if not exists avg_defensive_rating numeric,
  add column if not exists avg_pace numeric,
  add column if not exists avg_efg_pct numeric,
  add column if not exists avg_tov_pct numeric,
  add column if not exists avg_orb_pct numeric;
