-- Compact historical season Role Profile serving (Step 12F).
-- Grain: one certified Role Profile row per (player, season).
-- Source: read-only targeted Season Averages archive (regular, 2023–2025).
-- Selected fields only. No raw payload. No player names. No team IDs.
-- Playtype gp is not stored (qualifying games, not season GP).
-- Safe to re-run (IF NOT EXISTS).

create table if not exists analytics.player_role_profile (
  player_id                     text not null references analytics.players(player_id),
  season                        text not null,
  source                        text not null default 'bdl_season_averages_targeted_archive',
  isolation_poss_pct            double precision,
  isolation_ppp                 double precision,
  pnr_ball_handler_poss_pct     double precision,
  pnr_ball_handler_ppp          double precision,
  pnr_roll_man_poss_pct         double precision,
  pnr_roll_man_ppp              double precision,
  drives_per_game               double precision,
  drive_points_per_game         double precision,
  passes_per_game               double precision,
  potential_assists_per_game    double precision,
  restricted_area_fga           double precision,
  restricted_area_fg_pct        double precision,
  paint_non_ra_fga              double precision,
  paint_non_ra_fg_pct           double precision,
  midrange_fga                  double precision,
  midrange_fg_pct               double precision,
  corner_three_fga              double precision,
  corner_three_fg_pct           double precision,
  above_break_three_fga         double precision,
  above_break_three_fg_pct      double precision,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint player_role_profile_pk primary key (player_id, season)
);

comment on table analytics.player_role_profile is
  'Compact certified player-season Role Profile. Grain: player_id + season. Selected targeted Season Average fields only (isolation / PnR BH / PnR roll / drives / passing / by_zone). Names join analytics.players at read time. Null means unavailable or not qualified — do not coerce to 0. Shared later with Role Check. Not this-game Advanced.';

comment on column analytics.player_role_profile.season is
  'Provider/analytics season start year (2023/2024/2025). Regular season Role Profile only.';

comment on column analytics.player_role_profile.isolation_poss_pct is
  'Certified archive 0–1 share of offensive possessions that were isolation. Null = not qualified / missing, not zero role.';

comment on column analytics.player_role_profile.isolation_ppp is
  'Isolation points per possession this season. Not a percentage.';

comment on column analytics.player_role_profile.pnr_ball_handler_poss_pct is
  'Certified archive 0–1 share of offensive possessions that were PnR ball handler.';

comment on column analytics.player_role_profile.pnr_ball_handler_ppp is
  'PnR ball-handler points per possession this season.';

comment on column analytics.player_role_profile.pnr_roll_man_poss_pct is
  'Certified archive 0–1 share of offensive possessions that were PnR roll man.';

comment on column analytics.player_role_profile.pnr_roll_man_ppp is
  'PnR roll-man points per possession this season.';

comment on column analytics.player_role_profile.drives_per_game is
  'Provider drives per game. Null is not zero.';

comment on column analytics.player_role_profile.drive_points_per_game is
  'Provider points scored on drives per game.';

comment on column analytics.player_role_profile.passes_per_game is
  'Provider passes_made per game.';

comment on column analytics.player_role_profile.potential_assists_per_game is
  'Provider potential assists per game.';

comment on column analytics.player_role_profile.restricted_area_fga is
  'Restricted-area field-goal attempts per game.';

comment on column analytics.player_role_profile.restricted_area_fg_pct is
  'Restricted-area FG% as 0–1 fraction.';

comment on column analytics.player_role_profile.paint_non_ra_fga is
  'In-the-paint (non-RA) FGA per game.';

comment on column analytics.player_role_profile.paint_non_ra_fg_pct is
  'In-the-paint (non-RA) FG% as 0–1 fraction.';

comment on column analytics.player_role_profile.midrange_fga is
  'Mid-range FGA per game.';

comment on column analytics.player_role_profile.midrange_fg_pct is
  'Mid-range FG% as 0–1 fraction.';

comment on column analytics.player_role_profile.corner_three_fga is
  'Combined corner-3 FGA per game (provider corner_3, not left/right split).';

comment on column analytics.player_role_profile.corner_three_fg_pct is
  'Corner-3 FG% as 0–1 fraction.';

comment on column analytics.player_role_profile.above_break_three_fga is
  'Above-the-break 3 FGA per game.';

comment on column analytics.player_role_profile.above_break_three_fg_pct is
  'Above-the-break 3 FG% as 0–1 fraction.';

-- PK (player_id, season) covers Historical Final batch lookups:
--   WHERE season = $1 AND player_id = ANY($2)
-- No extra indexes. Table is ~1.8k rows.

-- Permissions: postgres owner default only. Do not ENABLE ROW LEVEL SECURITY.
-- Do not GRANT to anon. Matches analytics.player_game_advanced serving convention.
