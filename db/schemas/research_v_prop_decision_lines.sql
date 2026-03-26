-- Closing-line proxy: last raw snapshot strictly before game start per (game, player, book, prop, side).
-- Requires raw.player_prop_snapshots_v2 append history; missing pre-start rows = honest exclusion from eval.

create or replace view research.v_prop_decision_lines as
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
order by
  r.game_id,
  r.player_id,
  r.sportsbook,
  r.prop_type,
  r.side,
  r.fetched_at desc;

comment on view research.v_prop_decision_lines is
  'Last pre-tip O/U row per market from raw.player_prop_snapshots_v2 (closing-line proxy).';
