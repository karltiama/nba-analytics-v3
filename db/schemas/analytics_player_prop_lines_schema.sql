-- Analytics Player Prop Lines: flattened over/under lines for line shopping.
-- One row per (game, player, sportsbook, market_type, side, line_value, snapshot_at).
-- Populated by transform from raw.player_prop_snapshots (over_under only).
-- Run after analytics_schema.sql (analytics.games, analytics.players).

-- Helper: American odds -> decimal odds
create or replace function analytics.american_to_decimal(odds_american integer)
returns numeric
language sql
immutable
as $$
  select case
    when odds_american > 0 then 1 + (odds_american::numeric / 100)
    when odds_american < 0 then 1 + (100::numeric / abs(odds_american))
    else null
  end;
$$;

-- Helper: American odds -> implied probability
create or replace function analytics.american_to_implied_prob(odds_american integer)
returns numeric
language sql
immutable
as $$
  select case
    when odds_american <= 0 then abs(odds_american)::numeric / (abs(odds_american) + 100)
    when odds_american > 0 then 100::numeric / (odds_american + 100)
    else null
  end;
$$;

create table if not exists analytics.player_prop_lines (
  id                  uuid primary key default gen_random_uuid(),
  game_id             text not null references analytics.games(game_id) on delete cascade,
  player_id            text not null references analytics.players(player_id) on delete cascade,
  player_name          text,
  team_id             text references analytics.teams(team_id),
  sportsbook          text not null,
  market_type         text not null,
  side                text not null,
  line_value          numeric not null,
  odds_american       integer not null,
  odds_decimal        numeric not null,
  implied_probability numeric not null,
  snapshot_at         timestamptz not null,
  created_at          timestamptz not null default now(),

  constraint player_prop_lines_side_check check (side in ('over', 'under'))
);

create unique index if not exists analytics_player_prop_lines_unique_idx
  on analytics.player_prop_lines (game_id, player_id, sportsbook, market_type, side, line_value, snapshot_at);

create index if not exists analytics_player_prop_lines_lookup_idx
  on analytics.player_prop_lines (game_id, player_id, market_type);

create index if not exists analytics_player_prop_lines_snapshot_at_idx
  on analytics.player_prop_lines (snapshot_at);
