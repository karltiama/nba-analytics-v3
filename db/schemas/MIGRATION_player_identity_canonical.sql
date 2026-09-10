-- 13R.2: Canonical identity lock — unique (entity, provider) + unresolved quarantine.
-- Additive only. Does not change analytics.players PK, product FKs, or URLs.
-- Does not GRANT to anon. Do not ENABLE ROW LEVEL SECURITY.

create schema if not exists analytics;

-- ---------------------------------------------------------------------------
-- 1. One provider namespace per canonical person
--    Pre-req (certified 13R.2 dry-run): 0 duplicate (player_entity_id, provider)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'analytics_player_provider_ids_entity_provider_uniq'
  ) then
    alter table analytics.player_provider_ids
      add constraint analytics_player_provider_ids_entity_provider_uniq
      unique (player_entity_id, provider);
  end if;
end $$;

-- Existing natural key (provider, provider_player_id) remains required.
-- Confirmed present as analytics_player_provider_ids_uniq.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'analytics_player_provider_ids_provider_chk'
  ) then
    alter table analytics.player_provider_ids
      add constraint analytics_player_provider_ids_provider_chk
      check (provider = any (array['balldontlie'::text, 'nba'::text, 'bbref'::text]));
  end if;
end $$;

comment on constraint analytics_player_provider_ids_entity_provider_uniq
  on analytics.player_provider_ids is
  'At most one id per provider on a canonical person. BDL remains optional.';

-- ---------------------------------------------------------------------------
-- 2. Unresolved / conflict quarantine (ingest observations, not product FKs)
-- ---------------------------------------------------------------------------
create table if not exists analytics.player_identity_unresolved (
  unresolved_id               uuid primary key default gen_random_uuid(),
  provider                    text not null,
  provider_player_id          text not null,
  source_context              text not null,
  status                      text not null default 'UNRESOLVED',
  first_seen_at               timestamptz not null default now(),
  last_seen_at                timestamptz not null default now(),
  occurrence_count            integer not null default 1,
  sample_game_id              text null,
  sample_team_id              text null,
  resolved_player_entity_id   uuid null
    references analytics.player_entities(player_entity_id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint player_identity_unresolved_uniq
    unique (provider, provider_player_id, source_context),
  constraint player_identity_unresolved_status_chk
    check (status = any (array['UNRESOLVED'::text, 'CONFLICT'::text, 'RESOLVED'::text])),
  constraint player_identity_unresolved_source_chk
    check (source_context = any (array[
      'BOX_SCORE'::text,
      'PLAYER_PROP'::text,
      'INJURY'::text,
      'ADVANCED'::text,
      'LINEUP'::text,
      'PLAYS'::text,
      'SEASON_AVERAGE'::text,
      'OTHER'::text
    ])),
  constraint player_identity_unresolved_provider_chk
    check (provider = any (array['balldontlie'::text, 'nba'::text, 'bbref'::text])),
  constraint player_identity_unresolved_count_chk
    check (occurrence_count >= 1)
);

comment on table analytics.player_identity_unresolved is
  'Operational quarantine for unresolved or conflicting provider player ids. Not a product serving table. No anon access.';

create index if not exists analytics_player_identity_unresolved_status_idx
  on analytics.player_identity_unresolved (status, last_seen_at desc);

create index if not exists analytics_player_identity_unresolved_provider_idx
  on analytics.player_identity_unresolved (provider, status);

-- Permissions: postgres owner default only. Do not ENABLE ROW LEVEL SECURITY.
-- Do not GRANT to anon.
