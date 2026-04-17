-- =============================================================================
-- Research eval views — run this entire file once in Supabase SQL Editor
-- (fixes: relation "research.v_prop_eval_units" does not exist)
--
-- Prerequisites: analytics.games, analytics.player_game_logs, raw.player_prop_snapshots_v2
-- =============================================================================

create schema if not exists research;

-- Per-game outcomes (Final games)
create or replace view research.v_player_game_outcomes as
select
  l.game_id,
  l.player_id,
  l.game_date,
  g.start_time as game_start_time,
  l.points::numeric as pts,
  l.rebounds::numeric as reb,
  l.assists::numeric as ast,
  l.three_pointers_made::numeric as threes,
  (coalesce(l.points, 0) + coalesce(l.rebounds, 0) + coalesce(l.assists, 0))::numeric as pra,
  (coalesce(l.points, 0) + coalesce(l.assists, 0))::numeric as pa,
  (coalesce(l.points, 0) + coalesce(l.rebounds, 0))::numeric as pr,
  (coalesce(l.rebounds, 0) + coalesce(l.assists, 0))::numeric as ra
from analytics.player_game_logs l
inner join analytics.games g on g.game_id = l.game_id
where g.status = 'Final';

comment on view research.v_player_game_outcomes is
  'Box score outcomes for Final games; combo columns match lib/betting player-prop stat series.';

-- Closing-line proxy: materialized table + live raw fallback
create or replace view research.v_prop_decision_lines as
select
  game_id, player_id, player_name, team_id, sportsbook, prop_type,
  market_type, side, line_value, odds_american, odds_decimal,
  implied_probability, decision_at, game_start_time
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

-- Join lines to outcomes
create or replace view research.v_prop_eval_units as
with joined as (
  select
    d.game_id,
    d.player_id,
    d.player_name,
    o.game_date,
    d.sportsbook,
    d.prop_type,
    d.side,
    d.line_value,
    d.decision_at,
    d.odds_american,
    d.odds_decimal,
    d.implied_probability,
    d.game_start_time,
    case lower(trim(d.prop_type))
      when 'points' then o.pts
      when 'pts' then o.pts
      when 'rebounds' then o.reb
      when 'reb' then o.reb
      when 'assists' then o.ast
      when 'ast' then o.ast
      when 'threes' then o.threes
      when 'points_rebounds_assists' then o.pra
      when 'pra' then o.pra
      when 'points_assists' then o.pa
      when 'pa' then o.pa
      when 'points_rebounds' then o.pr
      when 'pr' then o.pr
      when 'rebounds_assists' then o.ra
      when 'ra' then o.ra
      else null
    end as stat_actual
  from research.v_prop_decision_lines d
  inner join research.v_player_game_outcomes o
    on o.game_id = d.game_id and o.player_id = d.player_id
)
select
  game_id,
  player_id,
  player_name,
  game_date,
  sportsbook,
  prop_type,
  side,
  line_value,
  decision_at,
  odds_american,
  odds_decimal,
  implied_probability,
  game_start_time,
  stat_actual,
  case
    when stat_actual is null then null
    when lower(side) = 'over' then stat_actual > line_value
    when lower(side) = 'under' then stat_actual < line_value
    else null
  end as bet_won
from joined;

comment on view research.v_prop_eval_units is
  'Pre-start line + outcome + win flag. Filter game_date for train/test holdout.';
