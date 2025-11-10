-- PROVIDER ID MAP
-- Maps canonical IDs in our system to provider-specific identifiers for quick cross-referencing.
create table if not exists provider_id_map (
  entity_type   text not null,               -- 'team' | 'player' | 'game'
  internal_id   text not null,               -- canonical id (team_id / player_id / game_id)
  provider      text not null,               -- e.g. 'bdl' | 'apisports' | 'oddsapi'
  provider_id   text not null,               -- provider-specific identifier (as text)
  metadata      jsonb,                       -- optional provider payload or attributes for debugging
  fetched_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (entity_type, provider, provider_id)
);

-- Fast reverse lookups (provider → internal)
create index if not exists provider_map_internal_idx
  on provider_id_map (entity_type, internal_id);

