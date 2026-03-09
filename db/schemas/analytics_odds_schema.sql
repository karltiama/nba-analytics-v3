-- Analytics Odds Schema: clean odds tables for frontend consumption.
-- Populated by transform from raw.odds_snapshots.
-- Run after analytics_schema.sql (which creates analytics schema + analytics.games).

-- analytics.game_odds_current: one row per game with the latest odds (upserted).
-- This is the primary table the frontend reads for game cards.
create table if not exists analytics.game_odds_current (
  game_id            text primary key references analytics.games(game_id) on delete cascade,
  home_moneyline     integer,
  away_moneyline     integer,
  home_spread        numeric,
  home_spread_odds   integer,
  away_spread        numeric,
  away_spread_odds   integer,
  total              numeric,
  over_odds          integer,
  under_odds         integer,
  vendor             text not null,
  snapshot_at        timestamptz not null,
  pull_run_id        bigint,
  updated_at         timestamptz not null default now()
);

create index if not exists analytics_game_odds_current_snapshot_idx
  on analytics.game_odds_current (snapshot_at);

-- analytics.game_odds_history: append-only timeline of odds snapshots.
-- One row per game+vendor+snapshot_at. Unique constraint prevents dupe inserts on re-runs.
create table if not exists analytics.game_odds_history (
  id                 bigserial primary key,
  game_id            text not null references analytics.games(game_id) on delete cascade,
  home_moneyline     integer,
  away_moneyline     integer,
  home_spread        numeric,
  home_spread_odds   integer,
  away_spread        numeric,
  away_spread_odds   integer,
  total              numeric,
  over_odds          integer,
  under_odds         integer,
  vendor             text not null,
  snapshot_at        timestamptz not null,
  pull_run_id        bigint,
  created_at         timestamptz not null default now()
);

create unique index if not exists analytics_game_odds_history_unique_idx
  on analytics.game_odds_history (game_id, vendor, snapshot_at);
create index if not exists analytics_game_odds_history_game_idx
  on analytics.game_odds_history (game_id, snapshot_at);

-- analytics.game_line_movement_summary: convenience table for line movement at a glance.
-- One row per game. Refreshed from game_odds_history (open vs latest).
create table if not exists analytics.game_line_movement_summary (
  game_id              text primary key references analytics.games(game_id) on delete cascade,
  open_home_spread     numeric,
  open_total           numeric,
  open_home_ml         integer,
  current_home_spread  numeric,
  current_total        numeric,
  current_home_ml      integer,
  spread_movement      numeric,
  total_movement       numeric,
  snapshots_count      integer not null default 0,
  first_seen_at        timestamptz,
  last_seen_at         timestamptz,
  updated_at           timestamptz not null default now()
);
