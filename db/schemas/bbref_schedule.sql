-- BASKETBALL REFERENCE SCHEDULE
-- This table stores the schedule from Basketball Reference as the source of truth
-- It can be used to validate and enrich the main games table

create table if not exists bbref_schedule (
  bbref_game_id     text primary key,        -- Format: bbref_YYYYMMDDHHMM_AWAY_HOME
  game_date         date not null,           -- Date of the game (ET)
  home_team_abbr    text not null,          -- Home team abbreviation (e.g., 'LAL')
  away_team_abbr    text not null,          -- Away team abbreviation (e.g., 'NOP')
  home_team_id      text references teams(team_id),  -- Mapped to internal team_id
  away_team_id      text references teams(team_id),  -- Mapped to internal team_id
  canonical_game_id text references games(game_id),   -- Link to canonical game if matched
  season            text,                    -- Season (e.g., '2025-26')
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint bbref_schedule_home_away_check check (home_team_id <> away_team_id)
);

create index if not exists bbref_schedule_date_idx on bbref_schedule (game_date);
create index if not exists bbref_schedule_canonical_idx on bbref_schedule (canonical_game_id) where canonical_game_id is not null;
create index if not exists bbref_schedule_teams_idx on bbref_schedule (home_team_id, away_team_id) where home_team_id is not null and away_team_id is not null;
