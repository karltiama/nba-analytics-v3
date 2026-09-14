-- Additive archive metadata for player-prop game runs + pull_run_id on snapshots.
-- Safe to re-run. Does not rewrite historical snapshot rows (pull_run_id stays null = legacy).

alter table raw.player_prop_game_runs
  add column if not exists rows_archived integer not null default 0;

alter table raw.player_prop_game_runs
  add column if not exists archive_object_count integer not null default 0;

alter table raw.player_prop_game_runs
  add column if not exists archive_completed_at timestamptz;

alter table raw.player_prop_game_runs
  add column if not exists archive_status text not null default 'pending';

alter table raw.player_prop_game_runs
  add column if not exists archive_error text;

alter table raw.player_prop_game_runs
  add column if not exists archive_key text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'player_prop_game_runs_archive_status_check'
  ) then
    alter table raw.player_prop_game_runs
      add constraint player_prop_game_runs_archive_status_check
      check (archive_status in ('pending', 'archived', 'failed'));
  end if;
end $$;

create index if not exists raw_player_prop_game_runs_archive_status_idx
  on raw.player_prop_game_runs (archive_status, started_at desc);

alter table raw.player_prop_snapshots_v2
  add column if not exists pull_run_id bigint;

create index if not exists raw_player_prop_snapshots_v2_pull_run_idx
  on raw.player_prop_snapshots_v2 (pull_run_id, game_id)
  where pull_run_id is not null;
