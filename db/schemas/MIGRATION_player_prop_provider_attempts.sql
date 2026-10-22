-- Player-props cumulative provider attempts for one game run.
-- STATUS: PREPARED, NOT APPLIED. Local P2 validated the file. Production is separate.
--
-- raw.player_prop_game_runs had no column that counts HTTP attempts across SQS
-- receives. rows_fetched is a result size, and it is reset by completeGameRun.
-- provider_attempts is incremented only by the worker's conditional UPDATE
-- before each provider page. completeGameRun does not touch it.
-- Existing rows become 0. Do not backfill. A re-run is safe (IF NOT EXISTS)
-- and must not reset a counter that the worker has already incremented.
--
-- Future production procedure, only under its own approval:
-- 1. Leave the props event-source mapping and all four schedules disabled.
-- 2. Record counts before the change:
--      SELECT count(*) FROM raw.player_prop_game_runs;
--      SELECT status, count(*) FROM raw.player_prop_game_runs GROUP BY 1 ORDER BY 1;
--      SELECT count(*) FROM raw.player_prop_snapshots_v2;
-- 3. Apply this file once, as written (its own transaction, lock_timeout 5s,
--    statement_timeout 60s). If the lock times out, stop. Do not loop.
-- 4. Read back:
--      column provider_attempts is integer NOT NULL DEFAULT 0;
--      constraint player_prop_game_runs_provider_attempts_check is present;
--      SELECT count(*) FROM raw.player_prop_game_runs WHERE provider_attempts <> 0;
--      that count is 0 on a database the worker has not yet incremented;
--      game-run and snapshots_v2 counts match step 2;
--      sampled status, rows_fetched, rows_stored, and error_message are unchanged.
-- 5. Do not enable the mapping in this step.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table raw.player_prop_game_runs
  add column if not exists provider_attempts integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'player_prop_game_runs_provider_attempts_check'
  ) then
    alter table raw.player_prop_game_runs
      add constraint player_prop_game_runs_provider_attempts_check
      check (provider_attempts >= 0);
  end if;
end $$;

comment on column raw.player_prop_game_runs.provider_attempts is
  'Cumulative BDL HTTP attempts for this pull_run_id and game_id, including SQS redeliveries. Not reset when the run is marked error.';

commit;
