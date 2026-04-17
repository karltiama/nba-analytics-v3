-- Analytics Player Props Current (Prop Explorer): latest known prop rows per (game, player, sportsbook, prop, side, line).
-- Populated by lambda/player-props-snapshot from raw.player_prop_snapshots_v2.
-- Run after analytics_schema.sql (analytics schema must exist).
-- Frontend queries this table for Prop Explorer (by player_id or game_id).

create table if not exists analytics.player_props_current (
  id                  uuid primary key default gen_random_uuid(),
  game_id             integer not null,
  player_id           integer not null,
  player_name         text,
  team_id             integer,
  sportsbook          text,
  prop_type           text,
  market_type         text,
  side                text,
  line_value          numeric,
  odds_american       integer,
  odds_decimal        numeric,
  implied_probability numeric,
  snapshot_at         timestamptz not null,

  constraint player_props_current_unique unique (game_id, player_id, sportsbook, prop_type, side, line_value)
);

-- Dropped: game_id_idx (covered by unique constraint), snapshot_at_idx (queries always filter by game_id first).
create index if not exists analytics_player_props_current_player_id_idx
  on analytics.player_props_current (player_id);
create index if not exists analytics_player_props_current_player_prop_idx
  on analytics.player_props_current (player_id, prop_type);
