-- Per-game status tracking for fanout player props ingestion.
-- Run after raw_player_props_schema.sql.

create table if not exists raw.player_prop_game_runs (
  pull_run_id    bigint not null references raw.player_prop_pull_runs(pull_run_id) on delete cascade,
  game_id        text not null,
  status         text not null default 'started',
  rows_fetched   integer not null default 0,
  rows_stored    integer not null default 0,
  error_message  text,
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (pull_run_id, game_id),
  constraint player_prop_game_runs_status_check check (status in ('started', 'success', 'error'))
);

create index if not exists raw_player_prop_game_runs_game_idx
  on raw.player_prop_game_runs (game_id, started_at desc);

create index if not exists raw_player_prop_game_runs_status_idx
  on raw.player_prop_game_runs (status, started_at desc);
