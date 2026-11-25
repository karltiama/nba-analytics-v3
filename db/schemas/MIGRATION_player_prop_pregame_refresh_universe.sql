-- NOT APPLIED. Do not run this against production from this change.
--
-- What it changes
--   Adds 'pregame_refresh' to player_prop_game_runs_universe_check.
--   Leaves null, broad, near_tip, and closing valid.
--   Does not drop or rewrite any other check or the pull_run_id foreign key.
--   Adds one partial unique index so a game cannot have two status='started'
--   rows across broad, near_tip, pregame_refresh, and closing.
--
-- Permissions and lock
--   The role needs ALTER on raw.player_prop_game_runs and CREATE on schema raw.
--   CREATE INDEX takes a write lock for the build. The game-run table is small.
--   Do this with every player-props schedule disabled. CONCURRENTLY is not used;
--   it cannot run inside this transaction.
--
-- Existing duplicate started rows
--   If one game already has two started rows in those universes, this file
--   raises and changes nothing. Do not delete those rows from this script.
--   Leave them until an operator confirms no worker can still execute the pull,
--   then mark the abandoned row error with error_message operator_abandoned.
--
-- Stuck runs
--   A started row is never reclaimed by age. Failed workers, lost acks, a
--   disabled event-source mapping, delayed delivery, and timeouts all leave
--   the row started on purpose. Clearing it while the message can still run
--   would fetch the provider twice.
--
-- Deploy order
--   1. Apply this file while every player-props schedule stays disabled.
--      Broad stays disabled for the whole refresh rollout.
--   2. Deploy the controller that knows pregame_refresh. That controller
--      reads pg_get_constraintdef and refuses the new universe until this
--      check text contains pregame_refresh. It does not enqueue first.
--   3. Do not add or enable a schedule in the same change. Existing code
--      that only writes broad, near_tip, or closing still accepts those values.
--      A second started row for the same game now fails that insert. The new
--      controller skips the game. An older controller rolls the wave back.
--      Either result avoids a second provider fetch.
--
-- Rollback
--   Stop any caller that inserts pregame_refresh first.
--   The new check still accepts the old values, so leaving it in place is safe.
--   Restoring the previous check fails while any pregame_refresh row exists.
--   Delete those rows only after the caller is stopped, then restore the old
--   check and drop raw_player_prop_game_runs_one_active_observation.

begin;

do $$
declare
  duplicates integer;
begin
  select count(*) into duplicates
    from (
      select game_id
        from raw.player_prop_game_runs
       where status = 'started'
         and universe in ('broad', 'near_tip', 'pregame_refresh', 'closing')
       group by game_id
      having count(*) > 1
    ) existing;
  if duplicates > 0 then
    raise exception
      'pregame refresh migration refused: % game(s) already have more than one started row across broad, near_tip, pregame_refresh, and closing. Resolve those rows manually. No rows were changed.',
      duplicates;
  end if;
end $$;

alter table raw.player_prop_game_runs
  drop constraint if exists player_prop_game_runs_universe_check;

alter table raw.player_prop_game_runs
  add constraint player_prop_game_runs_universe_check
  check (universe is null or universe in ('broad', 'near_tip', 'closing', 'pregame_refresh'));

create unique index if not exists raw_player_prop_game_runs_one_active_observation
  on raw.player_prop_game_runs (game_id)
  where status = 'started'
    and universe in ('broad', 'near_tip', 'pregame_refresh', 'closing');

commit;
