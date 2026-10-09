-- Decision close: last pre-tip O/U snapshot per (game, player, book, prop, side).
-- Reads from the materialized table (research.prop_decision_lines) for historical Final games,
-- and falls back to live raw data for games not yet materialized.
--
-- Requires MIGRATION_player_prop_observation_clock.sql (observed_at, observation_clock,
-- decision_clock). Before that migration this file fails on the missing columns; it never
-- reinstalls the controller-time-only definition. Keep identical to the view in that migration.

create or replace view research.v_prop_decision_lines as
-- Materialized closing lines (backfilled + incremental)
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

-- Live fallback: Final games still in raw but not yet materialized
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
