-- Raw Player Props Schema v2: append-only snapshots with flattened rows per (game, player, sportsbook, prop, side).
-- One row per sportsbook/prop/side/line with odds_american, odds_decimal, implied_probability.
-- Populated by lambda/player-props-snapshot. Run after raw_schema.sql (raw schema must exist).

-- raw.player_prop_snapshots_v2: append-only; no unique constraint.
create table if not exists raw.player_prop_snapshots_v2 (
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
  fetched_at          timestamptz not null default now(),
  raw_json            jsonb
);

-- Dropped: game_id_idx (covered by game_player_prop composite), player_id_idx (no standalone queries).
create index if not exists raw_player_prop_snapshots_v2_fetched_at_idx
  on raw.player_prop_snapshots_v2 (fetched_at);
create index if not exists raw_player_prop_snapshots_v2_game_player_prop_idx
  on raw.player_prop_snapshots_v2 (game_id, player_id, prop_type);
