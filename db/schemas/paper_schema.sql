-- Paper trading: one bet row per insert. user_id is the authenticated owner.
-- Pre-multi-user rows may have NULL user_id (unknown owner; not shown to users).
-- Run after analytics_schema.sql (needs analytics.games for settlement joins).
-- Existing databases: also apply MIGRATION_paper_bets_user_id.sql.

create schema if not exists paper;

create table if not exists paper.bets (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  user_id                uuid references auth.users(id) on delete cascade,
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
create index if not exists paper_bets_user_id_created_idx on paper.bets (user_id, created_at desc);

comment on table paper.bets is 'Paper trades snapshot from Props Explorer; settled against research.v_player_game_outcomes when game is Final. Each row belongs to at most one user_id.';
comment on column paper.bets.user_id is 'Authenticated owner (auth.users.id). NULL = pre-multi-user / unknown owner; hidden from user-facing queries.';

alter table paper.bets enable row level security;

drop policy if exists paper_bets_select_own on paper.bets;
create policy paper_bets_select_own
on paper.bets
for select
using (user_id = auth.uid());

drop policy if exists paper_bets_insert_own on paper.bets;
create policy paper_bets_insert_own
on paper.bets
for insert
with check (user_id = auth.uid());

drop policy if exists paper_bets_update_own on paper.bets;
create policy paper_bets_update_own
on paper.bets
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists paper_bets_delete_own on paper.bets;
create policy paper_bets_delete_own
on paper.bets
for delete
using (user_id = auth.uid());
