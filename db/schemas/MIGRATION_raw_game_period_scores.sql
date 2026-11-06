-- Per-period team scores from the BDL /v1/games payload (home_q1..q4, home_ot1..ot3, visitor_*).
-- Grain: one row per Final BDL game. Written by nightly-bdl-updater and
-- scripts/ingestion/backfill-game-period-scores.ts. Safe to re-run (IF NOT EXISTS).
--
-- Apply BEFORE deploying the nightly-bdl-updater build that writes this table,
-- or the nightly raw.games step fails.

create table if not exists raw.game_period_scores (
  game_id           integer not null references raw.games(id),
  season            integer not null,
  home_periods      integer[] not null,
  visitor_periods   integer[] not null,
  period_count      integer not null check (period_count >= 4),
  overtime_count    integer not null check (overtime_count >= 0),
  reconciled        boolean not null,
  source            text not null default 'bdl_games',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint game_period_scores_pk primary key (game_id)
);

create index if not exists game_period_scores_season_idx on raw.game_period_scores (season);

comment on table raw.game_period_scores is
  'Team points by period from BDL /v1/games. Index 1 = Q1 … 4 = Q4, 5+ = OT1.. (Postgres arrays are 1-based). Final games only.';

comment on column raw.game_period_scores.reconciled is
  'True when sum(home_periods) = home_team_score and sum(visitor_periods) = visitor_team_score from the same payload.';

-- Permissions: postgres owner default only. Do not GRANT to anon.
