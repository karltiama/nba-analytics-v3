-- Provider-tagged roster observations.
-- BallDontLie player and team ids stay in provider_* columns.
-- They are not written to raw.nba_roster_snapshots.nba_player_id.
-- Safe to re-run. Does not GRANT to anon or authenticated.
-- Do not ENABLE ROW LEVEL SECURITY here.
-- Applying this file is a separate authorization. This commit of the file does not apply it.

create schema if not exists raw;

create table if not exists raw.roster_observation_batches (
  batch_id            uuid primary key,
  provider            text not null,
  season_label        text not null,
  collected_at        timestamptz not null,
  snapshot_date       date not null,
  endpoint            text not null,
  status              text not null,
  request_count       integer not null,
  page_count          integer not null,
  player_count        integer not null,
  team_count          integer not null,
  min_team_size       integer not null,
  max_team_size       integer not null,
  gate_ok             boolean not null,
  completeness_scope  text not null,
  created_at          timestamptz not null default now(),
  constraint roster_observation_batches_provider_chk
    check (provider = 'balldontlie'),
  constraint roster_observation_batches_status_chk
    check (status = 'complete'),
  constraint roster_observation_batches_gate_chk
    check (gate_ok),
  constraint roster_observation_batches_endpoint_chk
    check (endpoint = '/nba/v1/players/active'),
  constraint roster_observation_batches_scope_chk
    check (completeness_scope = 'response_integrity'),
  constraint roster_observation_batches_counts_chk
    check (
      request_count >= 1
      and page_count >= 1
      and player_count >= 1
      and team_count = 30
      and min_team_size >= 1
      and max_team_size >= min_team_size
    ),
  constraint roster_observation_batches_id_provider_uniq
    unique (batch_id, provider),
  constraint roster_observation_batches_provider_collected_uniq
    unique (provider, collected_at)
);

create table if not exists raw.roster_observation_members (
  batch_id             uuid not null,
  provider             text not null,
  provider_player_id   text not null,
  provider_team_id     text not null,
  team_abbreviation    text not null,
  constraint roster_observation_members_pk
    primary key (batch_id, provider_player_id),
  constraint roster_observation_members_batch_fk
    foreign key (batch_id, provider)
    references raw.roster_observation_batches (batch_id, provider),
  constraint roster_observation_members_provider_chk
    check (provider = 'balldontlie'),
  constraint roster_observation_members_player_chk
    check (provider_player_id ~ '^[0-9]{1,16}$'),
  constraint roster_observation_members_team_chk
    check (provider_team_id ~ '^[0-9]{1,8}$'),
  constraint roster_observation_members_abbr_chk
    check (team_abbreviation ~ '^[A-Z]{2,4}$')
);

create index if not exists roster_observation_batches_lookup_idx
  on raw.roster_observation_batches (provider, season_label, collected_at desc);

create index if not exists roster_observation_members_team_idx
  on raw.roster_observation_members (batch_id, team_abbreviation);

comment on table raw.roster_observation_batches is
  'One completed BallDontLie active-player collection. status=complete means the response-integrity gate passed. It is not an official league roster, an injury report, or a transaction feed. Incomplete collections are not inserted. snapshot_date is the UTC calendar date of collected_at and is not the pregame eligibility rule.';

comment on column raw.roster_observation_batches.collected_at is
  'UTC timestamp of the collection. Two collections on the same UTC date stay distinct. A later batch does not replace an earlier one.';

comment on column raw.roster_observation_batches.completeness_scope is
  'response_integrity: pagination and coverage checks passed. This does not certify NBA game-day eligibility.';

comment on table raw.roster_observation_members is
  'Players observed in one roster batch. provider_player_id is the BallDontLie player id. provider_team_id is the BallDontLie team id. Neither column is an NBA.com id or analytics.teams.team_id. One row per player per batch, so a player cannot be stored on two teams in the same observation.';

comment on column raw.roster_observation_members.team_abbreviation is
  'Abbreviation returned with the provider team. Readers join raw.teams to analytics.teams on abbreviation for current East/West franchises. Do not treat provider_team_id as analytics.teams.team_id.';

create or replace function raw.roster_observations_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'roster observations are append-only';
end;
$$;

drop trigger if exists roster_observation_batches_append_only on raw.roster_observation_batches;
create trigger roster_observation_batches_append_only
  before update or delete on raw.roster_observation_batches
  for each row
  execute function raw.roster_observations_append_only();

drop trigger if exists roster_observation_batches_no_truncate on raw.roster_observation_batches;
create trigger roster_observation_batches_no_truncate
  before truncate on raw.roster_observation_batches
  for each statement
  execute function raw.roster_observations_append_only();

drop trigger if exists roster_observation_members_append_only on raw.roster_observation_members;
create trigger roster_observation_members_append_only
  before update or delete on raw.roster_observation_members
  for each row
  execute function raw.roster_observations_append_only();

drop trigger if exists roster_observation_members_no_truncate on raw.roster_observation_members;
create trigger roster_observation_members_no_truncate
  before truncate on raw.roster_observation_members
  for each statement
  execute function raw.roster_observations_append_only();

revoke all on function raw.roster_observations_append_only() from public, anon, authenticated, service_role;
revoke all on table raw.roster_observation_batches from public, anon, authenticated, service_role;
revoke all on table raw.roster_observation_members from public, anon, authenticated, service_role;
