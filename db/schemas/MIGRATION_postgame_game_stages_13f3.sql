-- 13F.3 additive schedule columns. Do not apply to production in this step.
-- Safe to re-run (IF NOT EXISTS).

alter table analytics.postgame_game_stages
  add column if not exists last_attempt_at timestamptz;

alter table analytics.postgame_game_stages
  add column if not exists next_attempt_at timestamptz;

comment on column analytics.postgame_game_stages.last_attempt_at is
  'Set when a worker successfully claims QUEUED → RUNNING. Not incremented by scanner or failed claims.';

comment on column analytics.postgame_game_stages.next_attempt_at is
  'Scanner must not re-enqueue WAITING until this instant. Used for 15m / 1h / overnight retries instead of SQS redelivery.';
