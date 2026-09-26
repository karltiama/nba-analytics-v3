-- Forward-only raw prop tape.
-- One observation per pull_run_id + game + player + sportsbook + prop + side + line.
-- Does not delete or rewrite existing rows.
-- Drops the hourly unique index so a later poll in the same UTC hour can keep a new price.

create unique index if not exists raw_player_prop_snapshots_v2_pull_observation_uidx
  on raw.player_prop_snapshots_v2 (
    pull_run_id,
    game_id,
    player_id,
    sportsbook,
    prop_type,
    side,
    line_value
  )
  where pull_run_id is not null;

drop index if exists raw.raw_player_prop_snapshots_v2_hourly_unique_idx;

alter table raw.player_prop_game_runs
  add column if not exists universe text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'player_prop_game_runs_universe_check'
  ) then
    alter table raw.player_prop_game_runs
      add constraint player_prop_game_runs_universe_check
      check (universe is null or universe in ('broad', 'near_tip'));
  end if;
end $$;
