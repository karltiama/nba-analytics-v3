-- Persistent table for materialized closing lines (last pre-tip snapshot per market).
-- Fed by scripts/materialize-closing-lines.ts after games go Final.
-- Decouples research.v_prop_eval_units from raw.player_prop_snapshots_v2 retention.

create table if not exists research.prop_decision_lines (
  game_id             text        not null,
  player_id           text        not null,
  player_name         text,
  team_id             integer,
  sportsbook          text        not null,
  prop_type           text        not null,
  market_type         text,
  side                text        not null,
  line_value          numeric,
  odds_american       integer,
  odds_decimal        numeric,
  implied_probability numeric,
  decision_at         timestamptz not null,
  game_start_time     timestamptz not null,
  materialized_at     timestamptz not null default now(),

  constraint prop_decision_lines_pk
    primary key (game_id, player_id, sportsbook, prop_type, side)
);

create index if not exists prop_decision_lines_game_id_idx
  on research.prop_decision_lines (game_id);
