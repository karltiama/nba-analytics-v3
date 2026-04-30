/**
 * Slice 7 schema helpers for player_game_features_v1.
 */

export const FEATURE_VERSION = 'player_game_features_v1' as const;

export const PLAYER_GAME_FEATURE_COLUMNS = [
  'season',
  'game_id',
  'game_date',
  'player_id',
  'player_name',
  'team_id',
  'team_abbr',
  'opponent_team_id',
  'opponent_abbr',
  'prior_games',
  'points_season_avg_before_game',
  'points_l5_avg_before_game',
  'points_l10_avg_before_game',
  'rebounds_season_avg_before_game',
  'rebounds_l5_avg_before_game',
  'rebounds_l10_avg_before_game',
  'assists_season_avg_before_game',
  'assists_l5_avg_before_game',
  'assists_l10_avg_before_game',
  'threes_season_avg_before_game',
  'threes_l5_avg_before_game',
  'threes_l10_avg_before_game',
  'pra_season_avg_before_game',
  'pra_l5_avg_before_game',
  'pra_l10_avg_before_game',
  'minutes_l5_avg_before_game',
  'minutes_l10_avg_before_game',
  'actual_points',
  'actual_rebounds',
  'actual_assists',
  'actual_threes',
  'actual_pra',
] as const;

export type PlayerGameFeature = {
  season: string;
  game_id: string;
  game_date: string;
  player_id: string;
  player_name: string | null;
  team_id: string | null;
  team_abbr: string | null;
  opponent_team_id: string | null;
  opponent_abbr: string | null;
  prior_games: number;
  points_season_avg_before_game: number | null;
  points_l5_avg_before_game: number | null;
  points_l10_avg_before_game: number | null;
  rebounds_season_avg_before_game: number | null;
  rebounds_l5_avg_before_game: number | null;
  rebounds_l10_avg_before_game: number | null;
  assists_season_avg_before_game: number | null;
  assists_l5_avg_before_game: number | null;
  assists_l10_avg_before_game: number | null;
  threes_season_avg_before_game: number | null;
  threes_l5_avg_before_game: number | null;
  threes_l10_avg_before_game: number | null;
  pra_season_avg_before_game: number | null;
  pra_l5_avg_before_game: number | null;
  pra_l10_avg_before_game: number | null;
  minutes_l5_avg_before_game: number | null;
  minutes_l10_avg_before_game: number | null;
  actual_points: number | null;
  actual_rebounds: number | null;
  actual_assists: number | null;
  actual_threes: number | null;
  actual_pra: number | null;
};

export const KEY_FEATURE_COLUMNS = [
  'points_l5_avg_before_game',
  'points_l10_avg_before_game',
  'minutes_l5_avg_before_game',
  'minutes_l10_avg_before_game',
  'rebounds_l5_avg_before_game',
  'assists_l5_avg_before_game',
  'threes_l5_avg_before_game',
  'pra_l5_avg_before_game',
] as const;

export type KeyFeatureColumn = (typeof KEY_FEATURE_COLUMNS)[number];

export function dedupeKey(playerId: string, gameId: string): string {
  return `${playerId}::${gameId}`;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}
