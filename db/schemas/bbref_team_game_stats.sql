-- BBREF TEAM GAME STATS
-- Authoritative table for team-level aggregated statistics from Basketball Reference
-- This is the PRIMARY source of truth for all BBRef team game stats
-- Populated by aggregating from bbref_player_game_stats
create table if not exists bbref_team_game_stats (
  game_id                  text not null references bbref_games(bbref_game_id) on delete cascade,
  team_id                  text not null references teams(team_id),
  -- Scoring
  points                   int,
  field_goals_made         int,
  field_goals_attempted    int,
  three_pointers_made      int,
  three_pointers_attempted int,
  free_throws_made         int,
  free_throws_attempted    int,
  -- Other stats
  rebounds                 int,
  offensive_rebounds       int,  -- Available from bbref
  defensive_rebounds       int,  -- Available from bbref
  assists                  int,
  steals                   int,
  blocks                   int,
  turnovers                int,
  personal_fouls           int,  -- Available from bbref
  plus_minus               int,  -- Team plus/minus (sum of player +/-)
  -- Calculated fields
  possessions              numeric,  -- Calculated: FGA + 0.44 * FTA - ORB + TOV
  minutes                  numeric,  -- Team total minutes (sum of player minutes)
  -- Metadata
  is_home                  boolean,  -- True if this team is home_team_id in bbref_games
  -- Source tracking (always 'bbref' for this table)
  source                   text not null default 'bbref',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  primary key (game_id, team_id),
  -- Ensure source is always 'bbref' to maintain data integrity
  constraint bbref_team_game_stats_source_check check (source = 'bbref')
);

-- Indexes for common queries
create index if not exists bbref_team_game_stats_team_idx on bbref_team_game_stats (team_id);
create index if not exists bbref_team_game_stats_game_idx on bbref_team_game_stats (game_id);
create index if not exists bbref_team_game_stats_team_season_idx on bbref_team_game_stats (team_id, game_id);
create index if not exists bbref_team_game_stats_home_idx on bbref_team_game_stats (team_id, is_home);
create index if not exists bbref_team_game_stats_source_idx on bbref_team_game_stats (source);








