-- GAMES
create table if not exists games (
  game_id        text primary key,        -- your canonical game ID (store provider id as text to start)
  season         text not null,           -- e.g. '2024-25'
  start_time     timestamptz,             -- UTC
  status         text,                    -- 'Scheduled' | 'InProgress' | 'Final' | etc.
  home_team_id   text not null references teams(team_id),
  away_team_id   text not null references teams(team_id),
  home_score     int,                     -- nullable; fill after game
  away_score     int,                     -- nullable
  venue          text,                    -- nullable
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint games_home_away_team_check check (home_team_id <> away_team_id)
);

create index if not exists games_season_start_time_idx on games (season, start_time);
