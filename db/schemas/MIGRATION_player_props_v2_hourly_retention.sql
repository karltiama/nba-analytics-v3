-- Enforce hourly dedupe for raw.player_prop_snapshots_v2.
-- Keeps newest row per (game, player, sportsbook, prop, side, line, hour bucket).

-- 1) Backfill dedupe so unique index creation succeeds.
with ranked as (
  select
    id,
    row_number() over (
      partition by game_id, player_id, sportsbook, prop_type, side, line_value, date_trunc('hour', fetched_at at time zone 'UTC')
      order by fetched_at desc, id desc
    ) as rn
  from raw.player_prop_snapshots_v2
)
delete from raw.player_prop_snapshots_v2 t
using ranked r
where t.id = r.id
  and r.rn > 1;

-- 2) Enforce hourly uniqueness for future writes.
create unique index if not exists raw_player_prop_snapshots_v2_hourly_unique_idx
  on raw.player_prop_snapshots_v2 (
    game_id,
    player_id,
    sportsbook,
    prop_type,
    side,
    line_value,
    (date_trunc('hour', fetched_at at time zone 'UTC'))
  );
