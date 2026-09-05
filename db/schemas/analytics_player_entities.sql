-- Phase 2.T.2D.1cB: Provider-agnostic player entity registry + provider ids.
-- Additive only. Does not change provider_id_map or player_team_stints.
-- Safe to run repeatedly (IF NOT EXISTS).

create schema if not exists analytics;

-- ---------------------------------------------------------------------------
-- 1. analytics.player_entities — canonical person identity (no provider ids)
-- ---------------------------------------------------------------------------
create table if not exists analytics.player_entities (
  player_entity_id uuid primary key default gen_random_uuid(),
  display_name     text not null,
  first_name       text null,
  last_name        text null,
  position         text null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists analytics_player_entities_display_name_idx
  on analytics.player_entities (display_name);

comment on table analytics.player_entities is
  'Provider-agnostic canonical player identity. No NBA/BDL ids stored here.';

-- ---------------------------------------------------------------------------
-- 2. analytics.player_provider_ids — provider → entity mappings
-- ---------------------------------------------------------------------------
create table if not exists analytics.player_provider_ids (
  player_entity_id   uuid not null
    references analytics.player_entities(player_entity_id) on delete cascade,
  provider           text not null,
  provider_player_id text not null,
  is_primary         boolean not null default false,
  metadata           jsonb null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint analytics_player_provider_ids_uniq
    unique (provider, provider_player_id)
);

create index if not exists analytics_player_provider_ids_entity_idx
  on analytics.player_provider_ids (player_entity_id);

create index if not exists analytics_player_provider_ids_provider_idx
  on analytics.player_provider_ids (provider, provider_player_id);

comment on table analytics.player_provider_ids is
  'Maps provider player ids (nba, balldontlie, ...) to canonical player_entity_id. BDL is optional.';

-- ---------------------------------------------------------------------------
-- 3. Optional bridge on analytics.players (BDL analytics id → entity)
-- ---------------------------------------------------------------------------
alter table analytics.players
  add column if not exists player_entity_id uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'analytics_players_player_entity_id_fkey'
  ) then
    alter table analytics.players
      add constraint analytics_players_player_entity_id_fkey
      foreign key (player_entity_id)
      references analytics.player_entities(player_entity_id)
      on delete set null;
  end if;
end $$;

create index if not exists analytics_players_player_entity_id_idx
  on analytics.players (player_entity_id);

comment on column analytics.players.player_entity_id is
  'Optional bridge from BDL-backed analytics.players to provider-agnostic player_entities. Nullable during migration.';
