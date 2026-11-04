-- Allow the 'closing' props universe (T-10 closing pull) on raw.player_prop_game_runs.
-- Apply BEFORE deploying the controller build that sends universe = "closing"; otherwise
-- createGameRun violates the check constraint and the closing wave fails to claim.
-- Idempotent: drops and re-adds the same named constraint inside one transaction.
-- Rollback: re-add the constraint without 'closing' after deleting or nulling closing rows.

begin;

alter table raw.player_prop_game_runs
  drop constraint if exists player_prop_game_runs_universe_check;

alter table raw.player_prop_game_runs
  add constraint player_prop_game_runs_universe_check
  check (universe is null or universe in ('broad', 'near_tip', 'closing'));

commit;
