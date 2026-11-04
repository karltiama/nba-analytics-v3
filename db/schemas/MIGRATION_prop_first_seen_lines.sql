-- First-seen (earliest captured pre-tip) line per market, kept next to research.prop_decision_lines
-- (the last pre-tip line). Together they give line movement and CLV after raw prune.
-- "First seen" is the earliest snapshot this pipeline captured (usually the 08:00 ET broad wave),
-- NOT the sportsbook's market open.
-- Same grain and decision clock as prop_decision_lines. Fed by materializeFirstSeenLines()
-- in lib/prune/closing-lines.ts from the prune-props cron (materialize gate only).
-- Safe to re-run (IF NOT EXISTS). Rollback: drop table research.prop_first_seen_lines.

create table if not exists research.prop_first_seen_lines (
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
  first_seen_at       timestamptz not null,
  first_seen_clock    text        not null,
  game_start_time     timestamptz not null,
  materialized_at     timestamptz not null default now(),

  constraint prop_first_seen_lines_pk
    primary key (game_id, player_id, sportsbook, prop_type, side),
  constraint prop_first_seen_lines_clock_chk
    check (first_seen_clock in ('RESPONSE_RECEIVED', 'LEGACY_CONTROLLER_TIME')),
  constraint prop_first_seen_lines_pre_tip_chk
    check (first_seen_at < game_start_time)
);

create index if not exists prop_first_seen_lines_game_id_idx
  on research.prop_first_seen_lines (game_id);

comment on table research.prop_first_seen_lines is
  'Earliest captured pre-tip over/under line per (game, player, book, prop, side). Pipeline first-seen, not market open. Pair with research.prop_decision_lines (closing) for movement and CLV.';
