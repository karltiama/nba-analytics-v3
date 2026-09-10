-- Market Movement v1 compact serving tables (Step 11B).
-- Empty until Step 11C historical backfill. Do not populate in this migration.
-- Not first-seen poll history. Do not confuse with:
--   analytics.player_prop_movement_summary
--   analytics.game_line_movement_summary
-- Safe to re-run (IF NOT EXISTS).

-- ---------------------------------------------------------------------------
-- Player props: one row per (game, player, canonical prop, vendor)
-- Historical v1: 3_hour_pre_tip → decision_close
-- ---------------------------------------------------------------------------
create table if not exists analytics.player_prop_market_movement (
  game_id text not null,
  player_id text not null,
  player_name text,
  prop_type text not null,
  vendor text not null,
  vendor_raw text,
  reference_kind text not null,
  reference_line numeric,
  reference_over_odds integer,
  reference_under_odds integer,
  reference_timestamp timestamptz,
  comparison_kind text not null,
  comparison_line numeric,
  comparison_over_odds integer,
  comparison_under_odds integer,
  comparison_timestamp timestamptz,
  line_delta numeric,
  over_implied_probability_delta numeric,
  under_implied_probability_delta numeric,
  movement_class text not null,
  backfill_revision text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint player_prop_market_movement_pk
    primary key (game_id, player_id, prop_type, vendor),
  constraint player_prop_mm_reference_kind_chk
    check (reference_kind = '3_hour_pre_tip'),
  constraint player_prop_mm_comparison_kind_chk
    check (comparison_kind in ('decision_close', 'live_current')),
  constraint player_prop_mm_class_chk
    check (movement_class in ('A', 'B', 'C', 'D', 'unclassified')),
  constraint player_prop_mm_vendor_chk
    check (vendor in ('betmgm', 'fanduel', 'draftkings', 'caesars')),
  constraint player_prop_mm_prop_chk
    check (prop_type in (
      'points',
      'rebounds',
      'assists',
      'threes',
      'points_rebounds',
      'points_assists',
      'points_rebounds_assists'
    ))
);

comment on table analytics.player_prop_market_movement is
  'Compact Market Movement v1 player-prop serving. Grain: game_id + player_id + prop_type + vendor. Reference is 3-Hour Pre-Tip, not first-seen history. Empty until Step 11C. Consensus is derived at read time, not stored.';

comment on column analytics.player_prop_market_movement.reference_kind is
  'Certified historical v1: 3_hour_pre_tip. Never market open / first print.';

comment on column analytics.player_prop_market_movement.comparison_kind is
  'Historical v1: decision_close (last pre-tip from research.prop_decision_lines). live_current reserved; not populated in 11B/11C.';

comment on column analytics.player_prop_market_movement.over_implied_probability_delta is
  'Raw implied-probability delta (comparison - reference), not vig-normalized, not American-odds subtraction.';

-- PK (game_id, player_id, prop_type, vendor) already serves:
--   by game, game+player, game+player+prop, and vendor rows for one market.
-- Extra index: player page lookups that are not game-prefixed.
create index if not exists analytics_player_prop_mm_player_game_idx
  on analytics.player_prop_market_movement (player_id, game_id);

-- ---------------------------------------------------------------------------
-- Game odds: one row per (game, vendor) with spread / total / moneyline
-- Historical v1: opening_snapshot → last_pre_tip_history
-- Certified window 2026-03-09 through 2026-03-22 only.
-- ---------------------------------------------------------------------------
create table if not exists analytics.game_odds_market_movement (
  game_id text not null,
  vendor text not null,
  vendor_raw text,
  outlier_class text,
  reference_kind text not null,
  certified_window_start date not null,
  certified_window_end date not null,
  reference_home_spread numeric,
  reference_home_spread_odds integer,
  reference_away_spread numeric,
  reference_away_spread_odds integer,
  reference_total numeric,
  reference_over_odds integer,
  reference_under_odds integer,
  reference_home_ml integer,
  reference_away_ml integer,
  reference_timestamp timestamptz,
  comparison_kind text not null,
  comparison_home_spread numeric,
  comparison_home_spread_odds integer,
  comparison_away_spread numeric,
  comparison_away_spread_odds integer,
  comparison_total numeric,
  comparison_over_odds integer,
  comparison_under_odds integer,
  comparison_home_ml integer,
  comparison_away_ml integer,
  comparison_timestamp timestamptz,
  spread_delta numeric,
  total_delta numeric,
  home_ml_implied_probability_delta numeric,
  away_ml_implied_probability_delta numeric,
  backfill_revision text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint game_odds_market_movement_pk
    primary key (game_id, vendor),
  constraint game_odds_mm_reference_kind_chk
    check (reference_kind = 'opening_snapshot'),
  constraint game_odds_mm_comparison_kind_chk
    check (comparison_kind in ('last_pre_tip_history', 'live_current')),
  constraint game_odds_mm_window_chk
    check (
      certified_window_start = date '2026-03-09'
      and certified_window_end = date '2026-03-22'
    )
);

comment on table analytics.game_odds_market_movement is
  'Compact Market Movement v1 game-odds serving. Grain: game_id + vendor. Opening Snapshot is certified 2026-03-09 through 2026-03-22 only — not season-wide opening history. Empty until Step 11C. Consensus is derived at read time, not stored.';

comment on column analytics.game_odds_market_movement.home_ml_implied_probability_delta is
  'Raw implied-probability delta for home moneyline. Do not use American-odds subtraction as a product metric.';

comment on column analytics.game_odds_market_movement.certified_window_start is
  'Fixed certified Opening Snapshot window start (2026-03-09). Coverage degrades beginning 2026-03-23.';

-- PK (game_id, vendor) already serves by-game and game+vendor lookups.
-- No extra game_id index: leftmost PK column covers WHERE game_id = $1.
