-- Compact historical Advanced serving (Step 12D).
-- Grain: one certified Advanced row per (game, player).
-- Source: read-only S3 advanced_stats_v2 pages for seasons 2023–2025.
-- Selected fields only. No raw payload. No player names. No current team IDs.
-- Safe to re-run (IF NOT EXISTS).

create table if not exists analytics.player_game_advanced (
  game_id                           text not null references analytics.games(game_id) on delete cascade,
  player_id                         text not null references analytics.players(player_id),
  season                            text not null,
  source                            text not null default 'bdl_advanced_stats_v2_archive',
  usage_percentage                  double precision,
  true_shooting_percentage          double precision,
  effective_field_goal_percentage   double precision,
  offensive_rating                  double precision,
  defensive_rating                  double precision,
  net_rating                        double precision,
  pace                              double precision,
  possessions                       double precision,
  assist_percentage                 double precision,
  rebound_percentage                double precision,
  turnover_ratio                    double precision,
  pie                               double precision,
  created_at                        timestamptz not null default now(),
  updated_at                        timestamptz not null default now(),
  constraint player_game_advanced_pk primary key (game_id, player_id)
);

comment on table analytics.player_game_advanced is
  'Compact certified player-game Advanced. Grain: game_id + player_id. Selected BDL advanced_stats_v2 fields only. Minutes stay on player_game_logs. Names join analytics.players at read time. Team context comes from the game log, not this table. Advanced-only identities may exist here without a matching PGL row; Explorer attaches Advanced only onto box-score players.';

comment on column analytics.player_game_advanced.season is
  'analytics.games.season for the game. Initial backfill is 2023–2025.';

comment on column analytics.player_game_advanced.usage_percentage is
  'Certified archive 0–1 fraction (0.14 = 14%). Do not rescale to 0–100 in serving.';

comment on column analytics.player_game_advanced.true_shooting_percentage is
  'Certified archive 0–1 fraction. Scoring efficiency including 2s/3s/FTs.';

comment on column analytics.player_game_advanced.effective_field_goal_percentage is
  'Certified archive 0–1 fraction. FG% adjusted for three-point value.';

comment on column analytics.player_game_advanced.offensive_rating is
  'Provider estimated points per 100 possessions. Do not clamp extremes.';

comment on column analytics.player_game_advanced.defensive_rating is
  'Provider estimated points allowed per 100 possessions. Do not clamp extremes.';

comment on column analytics.player_game_advanced.net_rating is
  'Provider estimated point differential per 100 possessions. Do not clamp extremes.';

comment on column analytics.player_game_advanced.pace is
  'Provider pace estimate. Low-possession samples can look extreme; do not clamp.';

comment on column analytics.player_game_advanced.possessions is
  'Player Advanced possessions (sample size). Preserve provider number; do not coerce null to 0.';

comment on column analytics.player_game_advanced.assist_percentage is
  'Certified archive 0–1 fraction.';

comment on column analytics.player_game_advanced.rebound_percentage is
  'Certified archive 0–1 fraction.';

comment on column analytics.player_game_advanced.turnover_ratio is
  'Provider turnover ratio as archived (not 0–1; sample 5.3). Not a computed TOV%.';

comment on column analytics.player_game_advanced.pie is
  'Certified archive 0–1 fraction (0.015 = 1.5%).';

-- PK (game_id, player_id) already covers: all Advanced rows for one historical game.
-- No extra indexes. player_id+season is not added until a concrete product query exists.

-- Permissions: postgres owner default only. Do not ENABLE ROW LEVEL SECURITY.
-- Do not GRANT to anon. Matches analytics.game_starters serving convention.
