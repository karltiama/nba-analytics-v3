-- Analytics Injury Schema: clean injury tables for frontend consumption.
-- Populated by transform from raw.player_injuries.
-- Run after analytics_schema.sql (which creates analytics schema + analytics.players, analytics.teams).
--
-- Grain: player_injury_status_current = one row per player (latest state).
--        player_injury_status_history = one row per meaningful injury state change.

-- analytics.player_injury_status_current: one row per player with latest known injury state (upserted).
create table if not exists analytics.player_injury_status_current (
  player_id       text primary key references analytics.players(player_id) on delete cascade,
  team_id         text references analytics.teams(team_id),
  status          text,
  description     text,
  return_date_raw text,
  snapshot_at     timestamptz not null,
  pull_run_id     bigint,
  updated_at      timestamptz not null default now()
);

create index if not exists analytics_player_injury_status_current_team_idx
  on analytics.player_injury_status_current (team_id);
create index if not exists analytics_player_injury_status_current_status_idx
  on analytics.player_injury_status_current (status);

-- analytics.player_injury_status_history: append-only timeline of injury state changes.
-- Insert only when (status, description, return_date_raw, team_id) changed vs previous state.
create table if not exists analytics.player_injury_status_history (
  id               bigserial primary key,
  player_id        text not null references analytics.players(player_id) on delete cascade,
  team_id         text references analytics.teams(team_id),
  status          text,
  description     text,
  return_date_raw text,
  snapshot_at     timestamptz not null,
  pull_run_id     bigint,
  created_at      timestamptz not null default now()
);

create index if not exists analytics_player_injury_status_history_player_idx
  on analytics.player_injury_status_history (player_id, snapshot_at);
create index if not exists analytics_player_injury_status_history_team_idx
  on analytics.player_injury_status_history (team_id);

-- analytics.team_injury_summary_current: counts by team and status (view).
create or replace view analytics.team_injury_summary_current as
select
  team_id,
  status,
  count(*) as player_count
from analytics.player_injury_status_current
where team_id is not null
group by team_id, status;
