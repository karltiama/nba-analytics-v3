-- PREPARED ONLY / NOT APPLIED. Apply only with explicit approval.
--
-- Display-only sportsbook quotes for Today's Games (scoreboard.v1 `market`). Requires
-- MIGRATION_display_scoreboard.sql (display schema, display.scoreboard_games) and raw.acquisition_requests.
-- Written only by the scoreboard collector (lib/scoreboard/collector.ts); read only by GET /api/scoreboard.
-- Never read by analytics, projections, EV, calibration, or projection history. The frozen
-- odds-pre-game-snapshot pipeline (raw.odds_* / analytics.game_odds_*) is untouched.
--
-- One latest accepted row per (game, vendor, quote kind). This is not line history: every accepted
-- provider response is kept in the immutable S3 acquisition archive (entity=acq_scoreboard_odds),
-- referenced here by request_id.

begin;

create table if not exists display.scoreboard_game_odds (
  game_id               text not null references display.scoreboard_games(game_id) on delete cascade,
  vendor                text not null check (vendor ~ '^[a-z0-9_]{1,40}$'),
  quote_kind            text not null check (quote_kind in ('current', 'opening')),
  moneyline_home        integer check (moneyline_home is null or abs(moneyline_home) between 100 and 100000),
  moneyline_away        integer check (moneyline_away is null or abs(moneyline_away) between 100 and 100000),
  spread_home           numeric(4,1) check (spread_home is null or (abs(spread_home) <= 60 and spread_home * 2 = trunc(spread_home * 2))),
  spread_home_odds      integer check (spread_home_odds is null or abs(spread_home_odds) between 100 and 100000),
  spread_away           numeric(4,1) check (spread_away is null or (abs(spread_away) <= 60 and spread_away * 2 = trunc(spread_away * 2))),
  spread_away_odds      integer check (spread_away_odds is null or abs(spread_away_odds) between 100 and 100000),
  total                 numeric(4,1) check (total is null or (total between 100 and 400 and total * 2 = trunc(total * 2))),
  total_over_odds       integer check (total_over_odds is null or abs(total_over_odds) between 100 and 100000),
  total_under_odds      integer check (total_under_odds is null or abs(total_under_odds) between 100 and 100000),
  -- Provider sync time for this row (BDL updated_at). Not a line-change time.
  provider_updated_at   timestamptz,
  -- Newest provider sync time for the same vendor in the same acquisition; a row far behind it is lagging.
  vendor_synced_at      timestamptz,
  opened_at             timestamptz,
  -- Collection time of the acquisition that last contained this row.
  first_observed_at     timestamptz not null,
  observed_at           timestamptz not null,
  request_id            text not null references raw.acquisition_requests(request_id),
  -- Set when a later complete acquisition for this game no longer contains this vendor.
  withdrawn_at          timestamptz,
  withdrawn_request_id  text references raw.acquisition_requests(request_id),
  updated_at            timestamptz not null default now(),
  primary key (game_id, vendor, quote_kind),
  check (observed_at >= first_observed_at),
  check ((quote_kind = 'opening') = (opened_at is not null)),
  check ((withdrawn_at is null) = (withdrawn_request_id is null)),
  check (withdrawn_at is null or withdrawn_at > observed_at)
);

-- Odds polling state, separate from display.scoreboard_collector_state so a games request can
-- never reset odds eligibility.
create table if not exists display.scoreboard_odds_state (
  scope                    text primary key check (scope = 'current'),
  last_attempt_at          timestamptz not null,
  last_outcome             text not null check (last_outcome in ('started', 'success', 'failed')),
  last_success_at          timestamptz,
  last_success_request_id  text references raw.acquisition_requests(request_id),
  last_error               text,
  updated_at               timestamptz not null default now()
);

revoke all on display.scoreboard_game_odds from public, anon, authenticated;
revoke all on display.scoreboard_odds_state from public, anon, authenticated;

commit;

-- Rollback (display odds only; scoreboard games, raw.acquisition_requests and S3 archives are untouched):
-- begin;
-- drop table if exists display.scoreboard_odds_state;
-- drop table if exists display.scoreboard_game_odds;
-- commit;
