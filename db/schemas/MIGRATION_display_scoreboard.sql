-- PREPARED ONLY / NOT APPLIED. Apply only with explicit approval.
--
-- Display-only live scoreboard storage (scoreboard.v1). Written only by the scoreboard collector
-- (lib/scoreboard/collector.ts); read only by GET /api/scoreboard. Never read by analytics,
-- projections, EV, WOWY, calibration, or projection history. Preseason rows live here and nowhere else.
-- Season type is the provider request's season_type (season_type_source = 'request_season_type').
-- Every observation references its raw.acquisition_requests row (archived provider evidence).

begin;

create schema if not exists display;
revoke all on schema display from public, anon, authenticated;

create table if not exists display.scoreboard_games (
  game_id                text primary key,
  season                 integer not null check (season between 1900 and 2999),
  season_type            text not null check (season_type in ('preseason', 'regular', 'playin', 'playoffs')),
  season_type_source     text not null check (season_type_source = 'request_season_type'),
  et_date                date not null,
  scheduled_tip          timestamptz,
  home_team_id           text not null,
  home_abbr              text,
  home_name              text,
  home_score             integer,
  visitor_team_id        text not null,
  visitor_abbr           text,
  visitor_name           text,
  visitor_score          integer,
  provider_status        text,
  provider_status_state  text,
  period                 integer,
  clock                  text,
  overtime_periods       integer not null default 0 check (overtime_periods >= 0),
  lifecycle              text not null check (lifecycle in
                           ('scheduled', 'live', 'halftime', 'overtime', 'final', 'postponed', 'canceled', 'unknown')),
  games_request_id       text not null references raw.acquisition_requests(request_id),
  first_observed_at      timestamptz not null,
  last_observed_at       timestamptz not null,
  last_changed_at        timestamptz not null,
  terminal_confirmations integer not null default 0 check (terminal_confirmations >= 0),
  final_observed_at      timestamptz,
  polling_state          text not null check (polling_state in ('pending', 'active', 'complete', 'safety_stopped')),
  box_completeness       text not null default 'none'
                           check (box_completeness in ('none', 'live_partial', 'final_unverified', 'verified_final')),
  box_request_id         text references raw.acquisition_requests(request_id),
  box_observed_at        timestamptz,
  final_box_attempts     integer not null default 0 check (final_box_attempts >= 0),
  updated_at             timestamptz not null default now(),
  check (last_observed_at >= first_observed_at),
  check (box_completeness = 'none' or (box_request_id is not null and box_observed_at is not null))
);

create index if not exists display_scoreboard_games_date_idx
  on display.scoreboard_games (et_date, season_type);

create table if not exists display.scoreboard_player_lines (
  game_id    text not null references display.scoreboard_games(game_id) on delete cascade,
  player_id  text not null,
  team_id    text not null,
  name       text,
  min        text,
  pts        integer,
  reb        integer,
  ast        integer,
  primary key (game_id, player_id)
);

create table if not exists display.scoreboard_collector_state (
  season_type            text primary key check (season_type in ('preseason', 'regular', 'playin', 'playoffs')),
  last_games_request_at  timestamptz not null,
  last_games_request_id  text not null references raw.acquisition_requests(request_id),
  updated_at             timestamptz not null default now()
);

revoke all on all tables in schema display from public, anon, authenticated;

commit;

-- Rollback (display data only; raw.acquisition_requests evidence and S3 archives are untouched):
-- begin;
-- drop table if exists display.scoreboard_player_lines;
-- drop table if exists display.scoreboard_collector_state;
-- drop table if exists display.scoreboard_games;
-- drop schema if exists display;
-- commit;
