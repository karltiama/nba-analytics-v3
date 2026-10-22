-- Eastern-day props HTTP attempt budget.
-- STATUS: PREPARED, NOT APPLIED. Do not run this against production in the
-- October 21 catch-up. Apply it once before the worker that reserves the
-- counter is deployed, with the props mapping and four schedules disabled.
--
-- One row per America/New_York date. The worker's conditional upsert is the
-- only writer. 300 is the application cap (225 planned requests plus 75 of
-- headroom). This table does not store that cap.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists raw.player_prop_daily_attempts (
  et_day     date primary key,
  attempts   integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint player_prop_daily_attempts_check check (attempts >= 0)
);

comment on table raw.player_prop_daily_attempts is
  'Props-owned count of BallDontLie HTTP attempts for one Eastern calendar day.';

commit;
