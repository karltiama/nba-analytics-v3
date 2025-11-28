-- STAGING EVENTS
-- Stores raw payloads from external APIs for replay, debugging, and audit trails
-- This follows the architecture pattern: store raw → validate → normalize → upsert

create table if not exists staging_events (
  id            bigserial primary key,
  source        text not null,                    -- 'oddsapi' | 'bdl' | 'nba' | etc.
  kind          text not null,                    -- 'odds' | 'boxscore' | 'schedule' | etc.
  cursor        text,                             -- Date, game_id, or other cursor for replay
  payload       jsonb not null,                   -- Raw API response
  fetched_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  -- Optional: link to processed entity
  processed     boolean not null default false,
  processed_at  timestamptz,
  error_message text                              -- If validation/processing failed
);

-- Indexes for efficient querying
create index if not exists staging_events_source_kind_idx on staging_events (source, kind);
create index if not exists staging_events_cursor_idx on staging_events (cursor) where cursor is not null;
create index if not exists staging_events_fetched_at_idx on staging_events (fetched_at);
create index if not exists staging_events_processed_idx on staging_events (processed, fetched_at) where not processed;

-- Index for replaying failed events
create index if not exists staging_events_error_idx on staging_events (source, kind, fetched_at) where error_message is not null;

