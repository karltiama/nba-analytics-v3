-- Joins closing-line snapshots to outcomes; stat_actual maps prop_type to the same series as the prop model.
-- bet_won: over wins if stat > line; under wins if stat < line; push (stat = line) => false for both.

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
  'Pre-start line + outcome + win flag. Filter game_date for train/test holdout; Track B probs are not stored here (phase 2).';
