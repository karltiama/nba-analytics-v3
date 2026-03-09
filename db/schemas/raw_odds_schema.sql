-- Raw Odds Schema: append-only historical odds snapshots from BallDontLie /v2/odds.
-- Every pull appends new rows; nothing is updated or deleted.
-- Run after raw_schema.sql (which creates the raw schema).

-- raw.odds_pull_runs: one row per Lambda invocation / ingestion run.
create table if not exists raw.odds_pull_runs (
  pull_run_id     bigserial primary key,
  pulled_at       timestamptz not null default now(),
  provider        text not null default 'balldontlie',
  date_queried    text,
  rows_returned   integer,
  rows_stored     integer,
  status          text not null default 'started',
  error_message   text,
  metadata        jsonb,
  completed_at    timestamptz,

  constraint odds_pull_runs_status_check check (
    status in ('started', 'success', 'error')
  )
);

create index if not exists raw_odds_pull_runs_pulled_at_idx
  on raw.odds_pull_runs (pulled_at);
create index if not exists raw_odds_pull_runs_status_idx
  on raw.odds_pull_runs (status);

-- raw.odds_snapshots: one row per BDL response row (game + vendor).
-- Mirrors the BDL /v2/odds shape exactly, plus our canonical game_id.
-- Append-only — no unique constraints, every pull adds new rows.
create table if not exists raw.odds_snapshots (
  snapshot_id          bigserial primary key,
  pull_run_id          bigint not null references raw.odds_pull_runs(pull_run_id),
  bdl_odds_id          integer,
  bdl_game_id          integer not null,
  game_id              text not null,
  vendor               text not null,
  spread_home_value    numeric,
  spread_home_odds     integer,
  spread_away_value    numeric,
  spread_away_odds     integer,
  moneyline_home_odds  integer,
  moneyline_away_odds  integer,
  total_value          numeric,
  total_over_odds      integer,
  total_under_odds     integer,
  provider_updated_at  timestamptz,
  raw_payload          jsonb,
  created_at           timestamptz not null default now()
);

create index if not exists raw_odds_snapshots_pull_run_idx
  on raw.odds_snapshots (pull_run_id);
create index if not exists raw_odds_snapshots_game_id_idx
  on raw.odds_snapshots (game_id);
create index if not exists raw_odds_snapshots_game_vendor_idx
  on raw.odds_snapshots (game_id, vendor);
create index if not exists raw_odds_snapshots_created_at_idx
  on raw.odds_snapshots (created_at);
