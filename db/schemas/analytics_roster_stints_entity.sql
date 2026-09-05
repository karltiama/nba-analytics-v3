-- Phase 2.T.2D.1cC — Entity-based roster stints (additive + constraint cutover).
-- Apply via script in staged order: add column → backfill → validate → cutover.
-- Safe to re-run sections that use IF NOT EXISTS / IF EXISTS.

create schema if not exists analytics;

-- ---------------------------------------------------------------------------
-- Step A: add nullable player_entity_id (before backfill)
-- ---------------------------------------------------------------------------
alter table analytics.player_team_stints
  add column if not exists player_entity_id uuid null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'analytics_player_team_stints_player_entity_id_fkey'
  ) then
    alter table analytics.player_team_stints
      add constraint analytics_player_team_stints_player_entity_id_fkey
      foreign key (player_entity_id)
      references analytics.player_entities(player_entity_id);
  end if;
end $$;

create index if not exists analytics_player_team_stints_entity_idx
  on analytics.player_team_stints (player_entity_id);

create index if not exists analytics_player_team_stints_entity_season_idx
  on analytics.player_team_stints (player_entity_id, season);

comment on column analytics.player_team_stints.player_entity_id is
  'Canonical person identity. Required after 1cC cutover; BDL player_id is optional.';

-- ---------------------------------------------------------------------------
-- Step B (run AFTER backfill validation — gated by script):
--   - enforce player_entity_id NOT NULL
--   - swap uniqueness to entity keys
--   - allow player_id NULL
-- ---------------------------------------------------------------------------
-- See scripts/roster/migrate-stints-to-entities.ts for ordered cutover.
