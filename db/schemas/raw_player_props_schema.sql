-- Raw Player Props Schema: append-only historical player prop snapshots from BallDontLie /v2/odds/player_props.
-- Every pull appends new rows; nothing is updated or deleted.
-- Run after raw_schema.sql (which creates the raw schema).

-- raw.player_prop_pull_runs: one row per Lambda invocation / ingestion run.
create table if not exists raw.player_prop_pull_runs (
  pull_run_id     bigserial primary key,
  pulled_at       timestamptz not null default now(),
  provider        text not null default 'balldontlie',
  game_ids_queried text[],
  rows_returned   integer,
  rows_stored     integer,
  status          text not null default 'started',
  error_message   text,
  metadata        jsonb,
  completed_at    timestamptz,

  constraint player_prop_pull_runs_status_check check (
    status in ('started', 'success', 'error')
  )
);

create index if not exists raw_player_prop_pull_runs_pulled_at_idx
  on raw.player_prop_pull_runs (pulled_at);
create index if not exists raw_player_prop_pull_runs_status_idx
  on raw.player_prop_pull_runs (status);

-- raw.player_prop_snapshots: one row per BDL response row (game + player + vendor + prop market).
-- Mirrors the BDL /v2/odds/player_props shape, plus canonical IDs.
-- Append-only — no unique constraints, every pull adds new rows.
create table if not exists raw.player_prop_snapshots (
  snapshot_id          bigserial primary key,
  pull_run_id          bigint not null references raw.player_prop_pull_runs(pull_run_id),
  bdl_prop_id          bigint,
  bdl_game_id          integer not null,
  game_id              text not null,
  bdl_player_id        integer not null,
  player_id            text not null,
  vendor               text not null,
  prop_type            text not null,
  line_value           numeric not null,
  market_type          text not null,
  over_odds            integer,
  under_odds           integer,
  milestone_odds       integer,
  provider_updated_at  timestamptz,
  raw_payload          jsonb,
  created_at           timestamptz not null default now(),

  constraint player_prop_snapshots_market_type_check check (
    market_type in ('over_under', 'milestone')
  )
);

create index if not exists raw_player_prop_snapshots_pull_run_idx
  on raw.player_prop_snapshots (pull_run_id);
create index if not exists raw_player_prop_snapshots_game_id_idx
  on raw.player_prop_snapshots (game_id);
create index if not exists raw_player_prop_snapshots_player_id_idx
  on raw.player_prop_snapshots (player_id);
create index if not exists raw_player_prop_snapshots_game_player_idx
  on raw.player_prop_snapshots (game_id, player_id);
create index if not exists raw_player_prop_snapshots_created_at_idx
  on raw.player_prop_snapshots (created_at);

-- raw.player_prop_market_outcomes: normalized one-row-per-side for each snapshot.
-- Decomposes over_under into (over, under) rows and milestone into one row.
-- Useful for queries like "show me all over lines with odds > +120".
create table if not exists raw.player_prop_market_outcomes (
  outcome_id      bigserial primary key,
  snapshot_id     bigint not null references raw.player_prop_snapshots(snapshot_id),
  side            text not null,
  odds            integer not null,
  created_at      timestamptz not null default now(),

  constraint player_prop_outcome_side_check check (
    side in ('over', 'under', 'milestone')
  )
);

create index if not exists raw_player_prop_market_outcomes_snapshot_idx
  on raw.player_prop_market_outcomes (snapshot_id);
