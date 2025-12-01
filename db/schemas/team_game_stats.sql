-- TEAM GAME STATS
-- Stores team-level aggregated statistics per game.
-- Source: Basketball Reference only (aggregated from player_game_stats)
-- This table is populated by aggregating player_game_stats, ensuring we own the calculation.
create table if not exists team_game_stats (
  game_id                  text not null references games(game_id) on delete cascade,
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
  offensive_rebounds       int,  -- Needed for Pace calculation (from Basketball Reference)
  defensive_rebounds       int,  -- Needed for Pace calculation (from Basketball Reference)
  assists                  int,
  steals                   int,
  blocks                   int,
  turnovers                int,
  personal_fouls           int,  -- From Basketball Reference
  -- Calculated fields
  possessions              numeric,  -- Calculated: FGA + 0.44 * FTA - ORB + TOV
  minutes                  numeric,  -- Team total minutes (sum of player minutes)
  -- Metadata
  is_home                  boolean,  -- True if this team is home_team_id in games table
  -- Source tracking (Basketball Reference only)
  source                   text not null default 'bbref',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  primary key (game_id, team_id),
  -- Ensure all data is from Basketball Reference
  constraint team_game_stats_source_check check (source = 'bbref')
);

-- Indexes for common queries
create index if not exists team_game_stats_team_idx on team_game_stats (team_id);
create index if not exists team_game_stats_game_idx on team_game_stats (game_id);
create index if not exists team_game_stats_team_season_idx on team_game_stats (team_id, game_id);

-- Index for filtering by home/away
create index if not exists team_game_stats_home_idx on team_game_stats (team_id, is_home);

-- Composite index for season queries (via games join)
-- Note: We'll join with games table for season filtering, so this helps

-- Helper function to calculate possessions
-- Formula: FGA + 0.44 * FTA - ORB + TOV
-- Note: If offensive_rebounds is NULL, we'll estimate it (see backfill script)

-- Backfill script (run this after creating the table to populate from existing player_game_stats):
/*
INSERT INTO team_game_stats (
  game_id,
  team_id,
  points,
  field_goals_made,
  field_goals_attempted,
  three_pointers_made,
  three_pointers_attempted,
  free_throws_made,
  free_throws_attempted,
  rebounds,
  offensive_rebounds,  -- Will be NULL initially until ETL adds ORB/DRB to player_game_stats
  defensive_rebounds,  -- Will be NULL initially until ETL adds ORB/DRB to player_game_stats
  assists,
  steals,
  blocks,
  turnovers,
  minutes,
  is_home,
  possessions
)
SELECT 
  pgs.game_id,
  pgs.team_id,
  SUM(pgs.points) as points,
  SUM(pgs.field_goals_made) as field_goals_made,
  SUM(pgs.field_goals_attempted) as field_goals_attempted,
  SUM(pgs.three_pointers_made) as three_pointers_made,
  SUM(pgs.three_pointers_attempted) as three_pointers_attempted,
  SUM(pgs.free_throws_made) as free_throws_made,
  SUM(pgs.free_throws_attempted) as free_throws_attempted,
  SUM(pgs.rebounds) as rebounds,
  NULL as offensive_rebounds,  -- TODO: Add ORB/DRB to player_game_stats in ETL
  NULL as defensive_rebounds,  -- TODO: Add ORB/DRB to player_game_stats in ETL
  SUM(pgs.assists) as assists,
  SUM(pgs.steals) as steals,
  SUM(pgs.blocks) as blocks,
  SUM(pgs.turnovers) as turnovers,
  SUM(pgs.minutes) as minutes,
  (pgs.team_id = g.home_team_id) as is_home,
  -- Estimate possessions: FGA + 0.44 * FTA - (estimated ORB) + TOV
  -- Using 0.3 * total rebounds as rough ORB estimate (NBA average ~30% ORB%)
  SUM(pgs.field_goals_attempted) + 
  0.44 * SUM(pgs.free_throws_attempted) - 
  (0.3 * SUM(pgs.rebounds)) + 
  SUM(pgs.turnovers) as possessions
FROM player_game_stats pgs
JOIN games g ON pgs.game_id = g.game_id
WHERE pgs.dnp_reason IS NULL  -- Exclude DNP players
GROUP BY pgs.game_id, pgs.team_id, g.home_team_id
ON CONFLICT (game_id, team_id) DO UPDATE SET
  points = EXCLUDED.points,
  field_goals_made = EXCLUDED.field_goals_made,
  field_goals_attempted = EXCLUDED.field_goals_attempted,
  three_pointers_made = EXCLUDED.three_pointers_made,
  three_pointers_attempted = EXCLUDED.three_pointers_attempted,
  free_throws_made = EXCLUDED.free_throws_made,
  free_throws_attempted = EXCLUDED.free_throws_attempted,
  rebounds = EXCLUDED.rebounds,
  assists = EXCLUDED.assists,
  steals = EXCLUDED.steals,
  blocks = EXCLUDED.blocks,
  turnovers = EXCLUDED.turnovers,
  minutes = EXCLUDED.minutes,
  possessions = EXCLUDED.possessions,
  updated_at = now();
*/

