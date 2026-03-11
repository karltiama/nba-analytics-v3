-- Raw Injury Schema: append-only historical injury snapshots from BallDontLie /nba/v1/player_injuries.
-- Every pull appends new rows; nothing is updated or deleted.
-- Run after raw_schema.sql (which creates the raw schema).
--
-- Grain: raw.injury_pull_runs = one row per ingestion run.
--        raw.player_injuries = one row per provider injury row per pull.

-- raw.injury_pull_runs: one row per Lambda invocation / ingestion run.
create table if not exists raw.injury_pull_runs (
  pull_run_id     bigserial primary key,
  pulled_at       timestamptz not null default now(),
  provider        text not null default 'balldontlie',
  rows_returned   integer,
  rows_stored     integer,
  status          text not null default 'started',
  error_message   text,
  metadata        jsonb,
  completed_at    timestamptz,

  constraint injury_pull_runs_status_check check (
    status in ('started', 'success', 'error')
  )
);

create index if not exists raw_injury_pull_runs_pulled_at_idx
  on raw.injury_pull_runs (pulled_at);
create index if not exists raw_injury_pull_runs_status_idx
  on raw.injury_pull_runs (status);

-- raw.player_injuries: one row per BDL response row per pull.
-- Append-only — no unique constraints, every pull adds new rows.
-- return_date_raw: store exactly as returned; do not assume parseable date.
create table if not exists raw.player_injuries (
  snapshot_id          bigserial primary key,
  pull_run_id          bigint not null references raw.injury_pull_runs(pull_run_id),
  provider_player_id   integer not null,
  provider_team_id     integer,
  status               text,
  description          text,
  return_date_raw      text,
  raw_payload          jsonb,
  created_at           timestamptz not null default now()
);

create index if not exists raw_player_injuries_pull_run_idx
  on raw.player_injuries (pull_run_id);
create index if not exists raw_player_injuries_provider_player_idx
  on raw.player_injuries (provider_player_id);
create index if not exists raw_player_injuries_created_at_idx
  on raw.player_injuries (created_at);
