-- Compact historical game-flow serving (Step 12G).
-- Grain: one row per 2025 game. Derived from the certified Plays archive.
-- No raw event JSON. No player names. Official final stays on analytics.games.
-- Safe to re-run (IF NOT EXISTS).

create table if not exists analytics.game_flow (
  game_id                  text not null references analytics.games(game_id),
  season                   text not null,
  source                   text not null default 'bdl_plays_2025_canonical',
  timeline_available       boolean not null,
  score_reconciled         boolean not null,
  stream_complete          boolean not null,
  stream_class             text not null,
  quality_code             text not null,
  plays_final_home         integer,
  plays_final_away         integer,
  event_count              integer not null,
  period_count             integer not null,
  overtime_count           integer not null,
  lead_changes             integer,
  ties                     integer,
  largest_home_lead        integer,
  largest_away_lead        integer,
  largest_home_run         integer,
  largest_away_run         integer,
  home_points_by_period    integer[],
  away_points_by_period    integer[],
  rotation_available       boolean not null,
  rotation_failure_class   text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint game_flow_pk primary key (game_id)
);

comment on table analytics.game_flow is
  'Compact certified 2025 game-flow serving. Grain: game_id. Timeline / score / rotation quality are independent flags — never a single game_valid. Events stay on S3. Names join analytics.players at read time. Official header score stays on analytics.games.';

comment on column analytics.game_flow.timeline_available is
  'True when the Plays chronology is product-safe to display. Truncated streams are false even if events exist.';

comment on column analytics.game_flow.score_reconciled is
  'True when last Plays running score equals analytics.games official final. Independent of timeline_available.';

comment on column analytics.game_flow.stream_complete is
  'True when stream_class is complete. False for truncated or uncertain.';

comment on column analytics.game_flow.stream_class is
  'complete | truncated | uncertain. Truncated streams are not Timeline-eligible.';

comment on column analytics.game_flow.quality_code is
  'TIMELINE_OK | SCORE_MISMATCH | STREAM_TRUNCATED | MALFORMED_ORDER | NO_EVENTS. Not a generic game_valid.';

comment on column analytics.game_flow.plays_final_home is
  'Last Plays running home score. Not the official header.';

comment on column analytics.game_flow.plays_final_away is
  'Last Plays running away score. Not the official header.';

comment on column analytics.game_flow.lead_changes is
  'Count of home↔away lead switches after a scoring snapshot. Opening 0–0 is not a lead change. Taking the lead from a tie is not a lead change. Null when Timeline is not available.';

comment on column analytics.game_flow.ties is
  'Count of times the running score becomes tied after it was not. Opening 0–0 is not counted. Null when Timeline is not available.';

comment on column analytics.game_flow.largest_home_run is
  'Largest unanswered scoring run for the home team (consecutive points before the opponent scores). Score-sequence, not a possession run. Null when Timeline is not available.';

comment on column analytics.game_flow.largest_away_run is
  'Largest unanswered scoring run for the away team. Score-sequence, not a possession run. Null when Timeline is not available.';

comment on column analytics.game_flow.rotation_available is
  'Certified rotation reconstruction succeeded. Independent of Timeline. False for 36 rotation failures and 2 starter anomalies.';

comment on column analytics.game_flow.rotation_failure_class is
  'MISSING_PARTICIPANT | BOTH_OFF_COURT | BOTH_ON_COURT | STARTER_ANOMALY | null.';

-- PK (game_id) covers Historical Final lookups:
--   WHERE game_id = $1
-- No extra indexes. Table is ~1,322 rows.

-- Permissions: postgres owner default only. Do not ENABLE ROW LEVEL SECURITY.
-- Do not GRANT to anon. Matches analytics.player_role_profile serving convention.
