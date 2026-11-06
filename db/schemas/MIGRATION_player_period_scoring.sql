-- Player scoring by period, derived from BDL play-by-play. Safe to re-run (IF NOT EXISTS).
-- Grain: (game_id, player_id, period). Rows exist only for periods where the player scored.
-- A player in analytics.player_game_logs with no row for a period scored 0 in it
-- (minutes by period are not stored, so "did not play that quarter" is not distinguishable).
--
-- game_reconciled: every box-score player's points/FGM/3PM/FTM in this game equal the
-- play-by-play sums. Serve only reconciled games.

create table if not exists analytics.player_period_scoring (
  game_id          text not null references analytics.games(game_id),
  season           text not null,
  player_id        text not null,
  team_id          text,
  period           integer not null check (period >= 1),
  points           integer not null check (points >= 0),
  fgm              integer not null check (fgm >= 0),
  fg3m             integer not null check (fg3m >= 0),
  ftm              integer not null check (ftm >= 0),
  game_reconciled  boolean not null,
  source           text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint player_period_scoring_pk primary key (game_id, player_id, period)
);

create index if not exists player_period_scoring_player_season_idx
  on analytics.player_period_scoring (player_id, season, period);

comment on table analytics.player_period_scoring is
  'Player made-shot scoring by period from BDL play-by-play (period 1-4 = Q1-Q4, 5+ = OT). Scorers only. Attempts are not derived. Filter game_reconciled = true for serving.';

-- Permissions: postgres owner default only. Do not GRANT to anon.
