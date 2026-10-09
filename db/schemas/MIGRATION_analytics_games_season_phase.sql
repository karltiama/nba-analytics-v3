-- PREPARED ONLY (STEP 14D.DATA2E.1). NOT APPLIED. Do not run without an explicit apply step.
--
-- analytics.games season-phase labels (DATA1 §8.4).
--   season_phase         PRESEASON | REGULAR | IST | PLAYIN | PLAYOFFS | UNCLASSIFIED
--   season_phase_source  request_season_type | provider_ist_stage | provider_postseason_flag
--                        | historical_backfill_v1 | NULL
--
-- Existing rows become UNCLASSIFIED (never REGULAR). No backfill in this file; the optional
-- historical backfill (2023–2025 only) is MIGRATION_analytics_games_season_phase_backfill.sql.
-- Constant default → metadata-only column add on PG 11+ (no table rewrite).
-- Writer: lib/games/status-sync-db.ts APPLY_SEASON_PHASE_SQL only fills UNCLASSIFIED rows.
--
-- Release order: deploy the 1B.2 game-status-sync first. Older status-sync never labels a game,
-- so with this column every 2026 game stays UNCLASSIFIED and prospective loaders select nothing.
--
-- Rollback: readers detect the column at runtime and fall back to date rules when it is absent.
--   alter table analytics.games drop column if exists season_phase_source, drop column if exists season_phase;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table analytics.games
  add column if not exists season_phase text not null default 'UNCLASSIFIED',
  add column if not exists season_phase_source text;

alter table analytics.games
  drop constraint if exists games_season_phase_check,
  add constraint games_season_phase_check
    check (season_phase in ('PRESEASON', 'REGULAR', 'IST', 'PLAYIN', 'PLAYOFFS', 'UNCLASSIFIED'));

alter table analytics.games
  drop constraint if exists games_season_phase_source_check,
  add constraint games_season_phase_source_check
    check (season_phase_source is null
           or season_phase_source in ('request_season_type', 'provider_ist_stage', 'provider_postseason_flag',
                                      'historical_backfill_v1'));

alter table analytics.games
  drop constraint if exists games_season_phase_has_source,
  add constraint games_season_phase_has_source
    check (season_phase = 'UNCLASSIFIED' or season_phase_source is not null);

comment on column analytics.games.season_phase is
  'Competition phase from the acquisition request/provider (DATA1 §8.4). UNCLASSIFIED = unknown; never assumed REGULAR.';
comment on column analytics.games.season_phase_source is
  'Evidence for season_phase: request_season_type (explicit season_type param), provider_ist_stage, provider_postseason_flag, historical_backfill_v1 (calendar + provider postseason flag, 2023–2025 only).';

commit;
