-- PREPARED ONLY. Do not apply in this slice.
-- Reviewed for shadow PTS C / REB C: membership, as-of columns, lineup
-- snapshots, prediction snapshots + settlements. Fail-closed: no schedules.

-- 1. Injury pull-run health (completeness already implied by rows_stored/returned/status)
alter table raw.injury_pull_runs
  add column if not exists completeness_reason text,
  add column if not exists health_class text;

comment on column raw.injury_pull_runs.completeness_reason is
  'Planner reason from evaluateInjuryPullCompleteness. Failed/incomplete pulls stay in this table.';
comment on column raw.injury_pull_runs.health_class is
  'ok | degraded_failed_latest | incomplete_latest. Never rewrite previous successful pulls.';

-- Provider publication time when the payload contains one. observed time remains created_at.
alter table raw.player_injuries
  add column if not exists source_published_at timestamptz;

comment on column raw.player_injuries.source_published_at is
  'Provider-published timestamp when present. Do not copy created_at (observed_at) into this column.';

-- Report membership for a pull without duplicating injury payload rows for healthy absences.
create table if not exists raw.injury_pull_membership (
  pull_run_id bigint not null references raw.injury_pull_runs(pull_run_id) on delete cascade,
  provider_player_id text not null,
  analytics_player_id text,
  in_report boolean not null,
  observed_at timestamptz not null,
  primary key (pull_run_id, provider_player_id)
);

comment on table raw.injury_pull_membership is
  'Players present or explicitly absent on a pull. Absence is not Available/healthy.';

-- History: keep change rows; add observation vs publication, membership, optional game link.
alter table analytics.player_injury_status_history
  add column if not exists observed_at timestamptz,
  add column if not exists source_published_at timestamptz,
  add column if not exists report_membership text,
  add column if not exists game_id text,
  add column if not exists game_link_provenance text;

comment on column analytics.player_injury_status_history.observed_at is
  'When Court Context observed the state. Prefer this for as-of joins.';
comment on column analytics.player_injury_status_history.source_published_at is
  'Provider publication time when present; null if unknown.';
comment on column analytics.player_injury_status_history.report_membership is
  'in_report | removed_from_report | not_in_report | unknown.';
comment on column analytics.player_injury_status_history.game_id is
  'Optional slate join. Null unless provenance is recorded.';
comment on column analytics.player_injury_status_history.game_link_provenance is
  'none | scheduled_slate_join | provider_game_id | inferred_team_date.';

-- 2. Lineup snapshots at team/game grain (identity + completeness), then players.
create table if not exists analytics.lineup_snapshots (
  snapshot_id           text primary key,
  game_id               text not null references analytics.games(game_id) on delete cascade,
  team_id               text not null references analytics.teams(team_id),
  source_kind           text not null,
  observed_at           timestamptz not null,
  source_published_at   timestamptz,
  completeness          text not null,
  expected_starters     integer not null default 5,
  starter_count         integer not null default 0,
  player_count          integer not null default 0,
  raw_payload_ref       text,
  created_at            timestamptz not null default now(),
  constraint lineup_snapshots_source_kind_check check (
    source_kind in ('heuristic_projected', 'provider_projected', 'provider_post_tip_confirmed')
  ),
  constraint lineup_snapshots_completeness_check check (
    completeness in ('complete_starters', 'partial', 'empty', 'failed')
  )
);

create unique index if not exists analytics_lineup_snapshots_natural_idx
  on analytics.lineup_snapshots (game_id, team_id, source_kind, observed_at);

comment on table analytics.lineup_snapshots is
  'Team/game lineup snapshot identity. Heuristic projected is not a provider observation. Post-tip confirmed is not pregame.';

create table if not exists analytics.lineup_snapshot_players (
  snapshot_id text not null references analytics.lineup_snapshots(snapshot_id) on delete cascade,
  player_id   text not null references analytics.players(player_id),
  role        text not null,
  slot        integer,
  primary key (snapshot_id, player_id),
  constraint lineup_snapshot_players_role_check check (
    role in ('projected_starter', 'confirmed_starter', 'listed_bench', 'inactive', 'unknown')
  )
);

-- 3. Prediction snapshots: never backdate generated_at to intended cutoff.
create table if not exists analytics.prediction_snapshots (
  snapshot_id            bigserial primary key,
  player_id              text not null references analytics.players(player_id),
  game_id                text not null references analytics.games(game_id) on delete cascade,
  scheduled_tipoff       timestamptz not null,
  intended_cutoff_at     timestamptz not null,
  generated_at           timestamptz not null,
  late                   boolean not null,
  model_version          text not null,
  feature_spec_version   text not null,
  feature_values         jsonb,
  feature_ref            text,
  predictions            jsonb not null,
  minutes_late           numeric,
  created_at             timestamptz not null default now()
);

create index if not exists analytics_prediction_snapshots_game_idx
  on analytics.prediction_snapshots (game_id, player_id, generated_at);

comment on table analytics.prediction_snapshots is
  'Append-only model outputs. generated_at is the real clock; late rows keep that timestamp.';
comment on column analytics.prediction_snapshots.generated_at is
  'Actual generation time. Do not rewrite to intended_cutoff_at.';
comment on column analytics.prediction_snapshots.feature_values is
  'Reconstructable feature map at generation, or null when feature_ref is used.';
comment on column analytics.prediction_snapshots.minutes_late is
  'Freshness: minutes generated_at is after intended_cutoff_at; 0 if on time. Never backdate generated_at.';

alter table analytics.prediction_snapshots
  add column if not exists delivery_status text,
  add column if not exists eligibility text,
  add column if not exists feature_order jsonb,
  add column if not exists feature_checksum text,
  add column if not exists model_checksums jsonb,
  add column if not exists source_freshness jsonb,
  add column if not exists tipoff_revision integer not null default 0,
  add column if not exists pred_a jsonb,
  add column if not exists pred_b jsonb;

create unique index if not exists analytics_prediction_snapshots_logical_uidx
  on analytics.prediction_snapshots (player_id, game_id, model_version, intended_cutoff_at);

comment on index analytics.analytics_prediction_snapshots_logical_uidx is
  'First snapshot for a logical prediction wins. Retries must not insert duplicates.';

create table if not exists analytics.prediction_settlements (
  settlement_id bigserial primary key,
  snapshot_id bigint not null references analytics.prediction_snapshots(snapshot_id),
  settled_at timestamptz not null,
  outcome_class text not null,
  actual_pts numeric,
  actual_reb numeric,
  constraint prediction_settlements_outcome_check check (
    outcome_class in ('played', 'dnp', 'postponed', 'cancelled', 'unresolved')
  ),
  constraint prediction_settlements_snapshot_uidx unique (snapshot_id)
);

comment on table analytics.prediction_settlements is
  'Settlement is append-only and never updates prediction_snapshots.';

-- 4. Structured shadow run records and first-RS-tipoff window anchors.
create table if not exists analytics.shadow_run_records (
  run_id bigserial primary key,
  run_at timestamptz not null default now(),
  finished_at timestamptz,
  action text not null,
  status text not null,
  due_count integer not null default 0,
  on_time_count integer not null default 0,
  late_count integer not null default 0,
  failed_count integer not null default 0,
  missing_count integer not null default 0,
  ineligible_count integer not null default 0,
  settled_count integer not null default 0,
  settlement_backlog integer,
  schema_mode text,
  schema_enrichment text,
  feature_input_age_hours numeric,
  details jsonb,
  constraint shadow_run_records_action_check check (action in ('score', 'settle')),
  constraint shadow_run_records_status_check check (
    status in ('success', 'error', 'skipped', 'preflight_failed')
  )
);

create index if not exists analytics_shadow_run_records_finished_idx
  on analytics.shadow_run_records (finished_at desc);

comment on table analytics.shadow_run_records is
  'One row per shadow worker invocation. Used for ops health, not model selection.';

create table if not exists analytics.shadow_window_anchors (
  season text not null,
  first_regular_season_tipoff timestamptz not null,
  observed_at timestamptz not null,
  source text not null,
  revision integer not null default 1,
  previous_tipoff timestamptz,
  primary key (season, revision)
);

comment on table analytics.shadow_window_anchors is
  'Authoritative first scheduled regular-season tipoff for the prospective window. Revisions append; they do not rewrite earlier rows.';

