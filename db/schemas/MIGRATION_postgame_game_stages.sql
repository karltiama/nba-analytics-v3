-- Compact postgame orchestration state (Step 13F.2).
-- Grain: one row per (game_id, stage). Serving tables remain the product source of truth.
-- This table stores WAITING / QUEUED / RUNNING / READY / BLOCKED / EXPECTED_ABSENCE / FAILED
-- so operators can distinguish those from "row missing in player_game_logs".
-- Safe to re-run (IF NOT EXISTS). Do not seed. Do not GRANT to anon.

create table if not exists analytics.postgame_game_stages (
  game_id           text not null references analytics.games(game_id),
  season            text not null,
  stage             text not null,
  status            text not null,
  attempts          integer not null default 0,
  reason_code       text,
  input_count       integer,
  output_count      integer,
  identity_skipped  integer,
  provider_http     integer,
  started_at        timestamptz,
  finished_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint postgame_game_stages_pk primary key (game_id, stage),
  constraint postgame_game_stages_stage_chk check (
    stage in ('box', 'starters', 'advanced', 'plays', 'game_flow')
  ),
  constraint postgame_game_stages_status_chk check (
    status in (
      'WAITING',
      'QUEUED',
      'RUNNING',
      'READY',
      'BLOCKED',
      'EXPECTED_ABSENCE',
      'FAILED'
    )
  ),
  constraint postgame_game_stages_attempts_chk check (attempts >= 0)
);

comment on table analytics.postgame_game_stages is
  'Per-game postgame orchestration state. Grain: game_id + stage. Not a product Historical Explorer flag table. Role Profile, injuries, odds, props, and Market Movement are out of scope. No payloads, API keys, or stack traces.';

comment on column analytics.postgame_game_stages.stage is
  'box | starters | advanced | plays | game_flow. game_flow waits on certified plays.';

comment on column analytics.postgame_game_stages.status is
  'WAITING | QUEUED | RUNNING | READY | BLOCKED | EXPECTED_ABSENCE | FAILED. BLOCKED is subscription-gated, not a generic crash. EXPECTED_ABSENCE is terminal acceptable absence (e.g. truncated Plays).';

comment on column analytics.postgame_game_stages.reason_code is
  'Stable taxonomy from lib/postgame (PROVIDER_NOT_READY, SUBSCRIPTION_BLOCKED, ...). Null when WAITING with no attempt yet.';

comment on column analytics.postgame_game_stages.provider_http is
  'Bounded HTTP status if relevant. Never a response body.';

create index if not exists postgame_game_stages_status_updated_idx
  on analytics.postgame_game_stages (status, updated_at);

create index if not exists postgame_game_stages_season_status_idx
  on analytics.postgame_game_stages (season, status);

-- Permissions: postgres owner default only. Do not ENABLE ROW LEVEL SECURITY.
-- Do not GRANT to anon.
