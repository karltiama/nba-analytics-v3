-- Per-game player stat outcomes for settled games (Final).
-- Join key: (game_id, player_id) text — matches analytics.player_game_logs.

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
