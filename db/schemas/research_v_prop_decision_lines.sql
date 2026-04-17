-- Closing-line proxy: last pre-tip O/U snapshot per (game, player, book, prop, side).
-- Reads from the materialized table (research.prop_decision_lines) for historical Final games,
-- and falls back to live raw data for games not yet materialized.

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
  game_start_time
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
    r.fetched_at as decision_at,
    g.start_time as game_start_time
  from raw.player_prop_snapshots_v2 r
  inner join analytics.games g on g.game_id = r.game_id::text
  where g.status = 'Final'
    and g.start_time is not null
    and r.fetched_at < g.start_time
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
    r.fetched_at desc
) live;

comment on view research.v_prop_decision_lines is
  'Closing-line proxy: materialized rows + live raw fallback for unmaterialized Final games.';
