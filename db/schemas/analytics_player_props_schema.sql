-- Analytics Player Props Schema: clean player prop tables for frontend consumption.
-- Populated by transform from raw.player_prop_snapshots.
-- Run after analytics_schema.sql (which creates analytics schema + analytics.games + analytics.players).

-- analytics.player_prop_current: latest known state for each prop market.
-- The primary table the frontend reads for player prop display.
-- For over_under markets the transform does delete-then-insert per game
-- to avoid stale lines when a line_value moves.
create table if not exists analytics.player_prop_current (
  id                 bigserial primary key,
  game_id            text not null references analytics.games(game_id) on delete cascade,
  player_id          text not null references analytics.players(player_id) on delete cascade,
  player_name        text,
  vendor             text not null,
  prop_type          text not null,
  line_value         numeric not null,
  market_type        text not null,
  over_odds          integer,
  under_odds         integer,
  milestone_odds     integer,
  bdl_prop_id        bigint,
  snapshot_at        timestamptz not null,
  pull_run_id        bigint,
  updated_at         timestamptz not null default now(),

  constraint player_prop_current_market_type_check check (
    market_type in ('over_under', 'milestone')
  )
);

create unique index if not exists analytics_player_prop_current_unique_idx
  on analytics.player_prop_current (game_id, player_id, vendor, prop_type, market_type, line_value);
create index if not exists analytics_player_prop_current_game_idx
  on analytics.player_prop_current (game_id);
create index if not exists analytics_player_prop_current_player_idx
  on analytics.player_prop_current (player_id);
create index if not exists analytics_player_prop_current_game_player_idx
  on analytics.player_prop_current (game_id, player_id);
create index if not exists analytics_player_prop_current_prop_type_idx
  on analytics.player_prop_current (prop_type);

-- analytics.player_prop_history: append-only timeline of prop snapshots.
-- One row per unique market state. Unique constraint prevents dupe inserts on re-runs.
create table if not exists analytics.player_prop_history (
  id                 bigserial primary key,
  game_id            text not null references analytics.games(game_id) on delete cascade,
  player_id          text not null references analytics.players(player_id) on delete cascade,
  player_name        text,
  vendor             text not null,
  prop_type          text not null,
  line_value         numeric not null,
  market_type        text not null,
  over_odds          integer,
  under_odds         integer,
  milestone_odds     integer,
  bdl_prop_id        bigint,
  snapshot_at        timestamptz not null,
  pull_run_id        bigint,
  created_at         timestamptz not null default now(),

  constraint player_prop_history_market_type_check check (
    market_type in ('over_under', 'milestone')
  )
);

create unique index if not exists analytics_player_prop_history_unique_idx
  on analytics.player_prop_history (game_id, player_id, vendor, prop_type, market_type, line_value, snapshot_at);
create index if not exists analytics_player_prop_history_game_idx
  on analytics.player_prop_history (game_id, snapshot_at);
create index if not exists analytics_player_prop_history_player_idx
  on analytics.player_prop_history (player_id, snapshot_at);
create index if not exists analytics_player_prop_history_game_player_idx
  on analytics.player_prop_history (game_id, player_id);

-- analytics.player_prop_movement_summary: convenience table for prop line movement at a glance.
-- One row per (game, player, vendor, prop_type) for over_under markets.
-- Compares the opening line to the latest line from preferred vendor.
create table if not exists analytics.player_prop_movement_summary (
  id                   bigserial primary key,
  game_id              text not null references analytics.games(game_id) on delete cascade,
  player_id            text not null references analytics.players(player_id) on delete cascade,
  player_name          text,
  vendor               text not null,
  prop_type            text not null,
  open_line            numeric,
  open_over_odds       integer,
  open_under_odds      integer,
  current_line         numeric,
  current_over_odds    integer,
  current_under_odds   integer,
  line_movement        numeric,
  snapshots_count      integer not null default 0,
  first_seen_at        timestamptz,
  last_seen_at         timestamptz,
  updated_at           timestamptz not null default now()
);

create unique index if not exists analytics_player_prop_movement_unique_idx
  on analytics.player_prop_movement_summary (game_id, player_id, vendor, prop_type);
create index if not exists analytics_player_prop_movement_game_idx
  on analytics.player_prop_movement_summary (game_id);
create index if not exists analytics_player_prop_movement_player_idx
  on analytics.player_prop_movement_summary (player_id);
