-- LIVE-CLOCK-P0A: player-prop true observation time.
-- STATUS: PREPARED, NOT APPLIED.
--
-- Additive only. No existing row is updated, deleted, or reinterpreted.
--   observed_at             response_received_at of the stored provider attempt (canonical)
--   controller_enqueued_at  raw.player_prop_game_runs.started_at (controller intent)
--   provider_updated_at     provider row updated_at
--   observation_clock       'RESPONSE_RECEIVED' on new rows; NULL = LEGACY_CONTROLLER_TIME
-- Existing fetched_at / snapshot_at keep their original controller-time meaning.
--
-- Activation order: apply this file, then deploy the player-props worker. The new worker refuses
-- to run (before any provider call) until these columns exist.

begin;

alter table raw.player_prop_snapshots_v2
  add column if not exists observed_at timestamptz,
  add column if not exists controller_enqueued_at timestamptz,
  add column if not exists provider_updated_at timestamptz,
  add column if not exists observation_clock text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'player_prop_snapshots_v2_observation_clock_check'
  ) then
    alter table raw.player_prop_snapshots_v2
      add constraint player_prop_snapshots_v2_observation_clock_check
      check (
        observation_clock is null
        or (observation_clock = 'RESPONSE_RECEIVED' and observed_at is not null)
      ) not valid;
  end if;
end $$;

alter table analytics.player_props_current
  add column if not exists observed_at timestamptz,
  add column if not exists controller_enqueued_at timestamptz,
  add column if not exists provider_updated_at timestamptz,
  add column if not exists observation_clock text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'player_props_current_observation_clock_check'
  ) then
    alter table analytics.player_props_current
      add constraint player_props_current_observation_clock_check
      check (
        observation_clock is null
        or (observation_clock = 'RESPONSE_RECEIVED' and observed_at is not null)
      ) not valid;
  end if;
end $$;

alter table research.prop_decision_lines
  add column if not exists decision_clock text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'prop_decision_lines_decision_clock_check'
  ) then
    alter table research.prop_decision_lines
      add constraint prop_decision_lines_decision_clock_check
      check (decision_clock is null or decision_clock in ('RESPONSE_RECEIVED', 'LEGACY_CONTROLLER_TIME'))
      not valid;
  end if;
end $$;

comment on column raw.player_prop_snapshots_v2.fetched_at is
  'LEGACY_CONTROLLER_TIME: controller enqueue time (player_prop_game_runs.started_at). Not the observation time.';
comment on column raw.player_prop_snapshots_v2.observed_at is
  'response_received_at of the stored provider attempt. Canonical for pre-tip, T-minus and decision close.';
comment on column analytics.player_props_current.snapshot_at is
  'LEGACY_CONTROLLER_TIME: controller enqueue time. Not the observation time.';
comment on column analytics.player_props_current.observed_at is
  'response_received_at of the stored provider attempt. Canonical for leakage checks.';
comment on column research.prop_decision_lines.decision_clock is
  'Clock that decided decision_at. NULL on rows materialized before this migration = LEGACY_CONTROLLER_TIME.';

-- Live fallback must use the same eligibility as MATERIALIZE_CLOSING_LINES_OBSERVED_SQL.
-- New column is appended at the end so CREATE OR REPLACE VIEW keeps existing columns.
create or replace view research.v_prop_decision_lines as
select
  game_id,
  player_id,
  player_name,
  team_id,
  sportsbook,
  prop_type,
  market_type,
  side,
  line_value,
  odds_american,
  odds_decimal,
  implied_probability,
  decision_at,
  game_start_time,
  coalesce(decision_clock, 'LEGACY_CONTROLLER_TIME') as decision_clock
from research.prop_decision_lines

union all

select * from (
  select distinct on (r.game_id, r.player_id, r.sportsbook, r.prop_type, r.side)
    g.game_id,
    r.player_id::text as player_id,
    r.player_name,
    r.team_id,
    r.sportsbook,
    r.prop_type,
    r.market_type,
    r.side,
    r.line_value,
    r.odds_american,
    r.odds_decimal,
    r.implied_probability,
    d.decision_at,
    g.start_time as game_start_time,
    d.decision_clock
  from raw.player_prop_snapshots_v2 r
  inner join analytics.games g on g.game_id = r.game_id::text
  cross join lateral (
    select
      case
        when r.observation_clock = 'RESPONSE_RECEIVED' then r.observed_at
        when r.observation_clock is null then r.fetched_at
      end as decision_at,
      case
        when r.observation_clock = 'RESPONSE_RECEIVED' then 'RESPONSE_RECEIVED'
        else 'LEGACY_CONTROLLER_TIME'
      end::text as decision_clock
  ) d
  where g.status = 'Final'
    and g.start_time is not null
    and d.decision_at is not null
    and d.decision_at < g.start_time
    and lower(coalesce(r.market_type, '')) = 'over_under'
    and lower(r.side) in ('over', 'under')
    and not exists (
      select 1 from research.prop_decision_lines m
      where m.game_id = g.game_id
        and m.player_id = r.player_id::text
        and m.sportsbook = r.sportsbook
        and m.prop_type = r.prop_type
        and m.side = r.side
    )
  order by
    r.game_id,
    r.player_id,
    r.sportsbook,
    r.prop_type,
    r.side,
    d.decision_at desc,
    r.pull_run_id desc nulls last
) live;

comment on view research.v_prop_decision_lines is
  'Decision close: materialized rows + live raw fallback. RESPONSE_RECEIVED rows use observed_at < tip; legacy rows use controller time.';

commit;
