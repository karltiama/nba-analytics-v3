-- raw.injury_collection_baselines: one row per injury pull that restarts continuous
-- collection after a gap (INJURY_CONTINUITY_MAX_GAP_HOURS). injuries-snapshot refuses
-- to write a post-gap pull without it. Additive.
-- Applied to production 2026-11-03 before resuming live injury snapshots for 2026-27.

create table if not exists raw.injury_collection_baselines (
  baseline_pull_run_id   bigint primary key references raw.injury_pull_runs(pull_run_id),
  previous_pull_run_id   bigint references raw.injury_pull_runs(pull_run_id),
  previous_completed_at  timestamptz,
  observed_at            timestamptz not null,
  gap_seconds            bigint not null check (gap_seconds >= 0),
  reason                 text not null check (reason in ('collection_gap')),
  max_gap_hours          integer not null,
  present_count          integer not null,
  continuing_count       integer not null,
  new_count              integer not null,
  absent_marked_count    integer not null,
  absent_already_terminated_count integer not null,
  previous_current       jsonb not null,
  created_at             timestamptz not null default now()
);

comment on table raw.injury_collection_baselines is
  'Pull that restarted continuous collection after a gap. Players absent at the baseline left the report at an unknown time in (previous_completed_at, observed_at]. previous_current preserves the pre-baseline current table verbatim.';

-- At most one gap marker per player per pull (idempotency for the baseline write).
create unique index if not exists analytics_injury_history_gap_marker_uidx
  on analytics.player_injury_status_history (player_id, pull_run_id)
  where status = 'AbsentAfterCollectionGap';

-- Rollback (only before any baseline row exists):
--   drop index if exists analytics.analytics_injury_history_gap_marker_uidx;
--   drop table if exists raw.injury_collection_baselines;
