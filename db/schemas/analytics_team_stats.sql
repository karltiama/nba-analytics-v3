-- Derived team-level tables for analytics schema.
-- Populated by scripts/compute-team-stats.ts from player_game_logs + games.
-- Run after analytics_schema.sql and analytics_schema_migration.sql.

-- 1. analytics.team_game_stats — one row per team per game
create table if not exists analytics.team_game_stats (
  team_id           text not null references analytics.teams(team_id),
  game_id           text not null references analytics.games(game_id) on delete cascade,
  season            text not null,
  game_date         date,
  opponent_team_id  text not null references analytics.teams(team_id),
  is_home           boolean not null,
  team_points       integer not null default 0,
  team_rebounds      integer not null default 0,
  team_assists       integer not null default 0,
  team_steals        integer not null default 0,
  team_blocks        integer not null default 0,
  team_turnovers     integer not null default 0,
  team_fgm           integer not null default 0,
  team_fga           integer not null default 0,
  team_3pm           integer not null default 0,
  team_3pa           integer not null default 0,
  team_ftm           integer not null default 0,
  team_fta           integer not null default 0,
  points_allowed     integer,
  result             text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (team_id, game_id)
);

create index if not exists analytics_tgs_season_idx on analytics.team_game_stats (season);
create index if not exists analytics_tgs_game_date_idx on analytics.team_game_stats (game_date);
create index if not exists analytics_tgs_team_season_idx on analytics.team_game_stats (team_id, season);

-- 2. analytics.team_season_averages — one row per team per season
create table if not exists analytics.team_season_averages (
  team_id            text not null references analytics.teams(team_id),
  season             text not null,
  games_played       integer not null default 0,
  avg_points         numeric,
  avg_rebounds       numeric,
  avg_assists        numeric,
  avg_steals         numeric,
  avg_blocks         numeric,
  avg_turnovers      numeric,
  avg_fgm            numeric,
  avg_fga            numeric,
  avg_3pm            numeric,
  avg_3pa            numeric,
  avg_ftm            numeric,
  avg_fta            numeric,
  avg_points_allowed numeric,
  wins               integer not null default 0,
  losses             integer not null default 0,
  win_pct            numeric,
  updated_at         timestamptz not null default now(),
  primary key (team_id, season)
);

create index if not exists analytics_tsa_season_idx on analytics.team_season_averages (season);
