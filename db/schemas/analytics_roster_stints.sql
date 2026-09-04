-- Phase 2.T.2B: NBA.com roster observations + analytics player-team stints.
-- Append-only raw snapshots; stint-aware canonical membership (observation dates, not trade timestamps).
-- Safe to run repeatedly (IF NOT EXISTS / OR REPLACE).

-- ---------------------------------------------------------------------------
-- 1. raw.nba_roster_snapshots — append-only membership observations
-- ---------------------------------------------------------------------------
create schema if not exists raw;

create table if not exists raw.nba_roster_snapshots (
  snapshot_at           timestamptz not null,
  snapshot_date         date not null,
  season_label          text not null,          -- provider/NBA label e.g. '2025-26'
  analytics_season      text not null,          -- start-year e.g. '2025'
  nba_team_id           text not null,
  nba_player_id         text not null,
  player_name           text,
  team_abbreviation     text,
  analytics_team_id     text,                   -- our analytics.teams.team_id when known
  jersey                text,
  position              text,
  roster_status         text,
  height                text,
  weight                text,
  experience            text,
  school                text,
  raw_payload           jsonb,
  created_at            timestamptz not null default now(),
  primary key (snapshot_date, season_label, nba_team_id, nba_player_id)
);

create index if not exists raw_nba_roster_snapshots_season_idx
  on raw.nba_roster_snapshots (analytics_season, snapshot_date);
create index if not exists raw_nba_roster_snapshots_player_idx
  on raw.nba_roster_snapshots (nba_player_id, analytics_season);
create index if not exists raw_nba_roster_snapshots_team_idx
  on raw.nba_roster_snapshots (nba_team_id, analytics_season);

comment on table raw.nba_roster_snapshots is
  'Append-only NBA.com CommonTeamRoster observations. snapshot_date+season+team+player is unique per calendar day; disappearing players are not deleted.';

-- ---------------------------------------------------------------------------
-- 2. analytics.player_team_stints — season-aware membership (observation semantics)
-- ---------------------------------------------------------------------------
create schema if not exists analytics;

create table if not exists analytics.player_team_stints (
  stint_id           bigserial primary key,
  season             text not null,             -- analytics start-year e.g. '2025'
  player_id          text not null references analytics.players(player_id),
  team_id            text not null references analytics.teams(team_id),
  observed_from      date not null,
  observed_to        date null,                 -- null = open/current observed stint
  source             text not null,             -- e.g. 'nba_stats'
  source_player_id   text null,                 -- NBA PLAYER_ID when source=nba_stats
  jersey             text null,
  position           text null,
  membership_type    text null,                 -- 'standard' | 'two_way' | null
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint analytics_player_team_stints_dates_check
    check (observed_to is null or observed_to >= observed_from)
);

create unique index if not exists analytics_player_team_stints_open_uniq
  on analytics.player_team_stints (player_id, season)
  where observed_to is null;

create unique index if not exists analytics_player_team_stints_identity_uniq
  on analytics.player_team_stints (player_id, team_id, season, observed_from);

create index if not exists analytics_player_team_stints_current_team_idx
  on analytics.player_team_stints (team_id, season)
  where observed_to is null;

create index if not exists analytics_player_team_stints_player_season_idx
  on analytics.player_team_stints (player_id, season);

create index if not exists analytics_player_team_stints_season_team_idx
  on analytics.player_team_stints (season, team_id);

comment on table analytics.player_team_stints is
  'Observed player-team membership stints. observed_from/to are roster-observation dates, NOT exact signing/trade timestamps.';

comment on column analytics.player_team_stints.observed_from is
  'First date we observed this player on this team roster (not necessarily signing date).';
comment on column analytics.player_team_stints.observed_to is
  'First date we observed the player no longer on that roster / moved elsewhere; NULL = still open.';

-- ---------------------------------------------------------------------------
-- 3. analytics.team_roster_current — open stints only
-- ---------------------------------------------------------------------------
create or replace view analytics.team_roster_current as
select
  season,
  team_id,
  player_id,
  jersey,
  position,
  membership_type,
  observed_from,
  source,
  source_player_id,
  stint_id
from analytics.player_team_stints
where observed_to is null;

comment on view analytics.team_roster_current is
  'Open (current) observed roster membership by team/season. Availability/injuries are separate.';
