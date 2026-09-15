-- Game-level WOWY v1 supporting indexes.
-- DO NOT APPLY TO PRODUCTION in this slice.
-- Existing indexes already cover the bounded pair query:
--   player_game_logs_pkey (game_id, player_id)
--   analytics_player_game_logs_player_season_idx (player_id, season)
--   analytics_games_season_start_idx (season, start_time)
--
-- Optional follow-up if pair/teammate pages show sequential scans on (player_id, season, team_id):

create index concurrently if not exists analytics_player_game_logs_player_season_team_idx
  on analytics.player_game_logs (player_id, season, team_id);

comment on index analytics_player_game_logs_player_season_team_idx is
  'Optional WOWY pair/teammate lookup. Not applied in game-level WOWY v1.';
