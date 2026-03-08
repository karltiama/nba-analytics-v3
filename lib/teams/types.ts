export interface TeamInfo {
  team_id: string;
  abbreviation: string;
  full_name: string;
  name: string;
  city: string | null;
  conference: string | null;
  division: string | null;
}

export interface TeamGameStats {
  team_id: string;
  game_id: string;
  season: string;
  game_date: string;
  opponent_team_id: string;
  opponent_abbr: string;
  opponent_name: string;
  is_home: boolean;
  team_points: number;
  team_rebounds: number;
  team_assists: number;
  team_steals: number;
  team_blocks: number;
  team_turnovers: number;
  team_fgm: number;
  team_fga: number;
  team_3pm: number;
  team_3pa: number;
  team_ftm: number;
  team_fta: number;
  points_allowed: number | null;
  result: 'W' | 'L' | null;
}

export interface TeamSeasonAverages {
  team_id: string;
  season: string;
  games_played: number;
  avg_points: number | null;
  avg_rebounds: number | null;
  avg_assists: number | null;
  avg_steals: number | null;
  avg_blocks: number | null;
  avg_turnovers: number | null;
  avg_fgm: number | null;
  avg_fga: number | null;
  avg_3pm: number | null;
  avg_3pa: number | null;
  avg_ftm: number | null;
  avg_fta: number | null;
  avg_points_allowed: number | null;
  wins: number;
  losses: number;
  win_pct: number | null;
  home_wins: number;
  home_losses: number;
  away_wins: number;
  away_losses: number;
  avg_offensive_rating: number | null;
  avg_defensive_rating: number | null;
  avg_pace: number | null;
  avg_efg_pct: number | null;
  avg_tov_pct: number | null;
  avg_orb_pct: number | null;
}

export interface TeamAdvancedMetrics {
  team_id: string;
  season: string;
  games_played: number;
  wins: number;
  losses: number;
  avg_offensive_rating: number | null;
  avg_defensive_rating: number | null;
  avg_pace: number | null;
  avg_efg_pct: number | null;
  avg_tov_pct: number | null;
  avg_orb_pct: number | null;
}

export interface TeamTrendPoint {
  game_date: string;
  opponent_abbr: string;
  is_home: boolean;
  team_points: number;
  points_allowed: number | null;
  result: 'W' | 'L' | null;
}
