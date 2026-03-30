-- Paper trading: single-tenant bet log (no auth in v1; apply RLS later if multi-user).
-- Run after analytics_schema.sql (needs analytics.games for settlement joins).

create schema if not exists paper;

create table if not exists paper.bets (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  status                 text not null check (status in ('open', 'settled')),
  game_id                text not null,
  player_id              text not null,
  player_name            text,
  sportsbook             text,
  prop_type              text,
  market_type            text,
  side                   text,
  line_value             numeric,
  odds_american          integer,
  implied_probability    numeric,
  stake_units            numeric not null default 1,
  ev                     numeric,
  confidence_tier        text,
  calibration_version    text,
  decision_snapshot_at   timestamptz not null,
  model_probability      numeric,
  projection             numeric,
  ev_selected_track      text,
  result                 text check (result is null or result in ('win', 'loss', 'push', 'void')),
  profit_units           numeric,
  settled_at             timestamptz
);

create index if not exists paper_bets_status_idx on paper.bets (status);
create index if not exists paper_bets_game_id_idx on paper.bets (game_id);
create index if not exists paper_bets_created_at_idx on paper.bets (created_at desc);
create index if not exists paper_bets_settled_at_idx on paper.bets (settled_at desc nulls last);

comment on table paper.bets is 'Paper trades snapshot from Props Explorer; settled against research.v_player_game_outcomes when game is Final.';
