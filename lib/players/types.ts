export type MetricKey = 'pts' | 'reb' | 'ast' | '3pm' | 'pra';

export const METRIC_LABELS: Record<MetricKey, string> = {
  pts: 'Points',
  reb: 'Rebounds',
  ast: 'Assists',
  '3pm': '3-Pointers Made',
  pra: 'PTS + REB + AST',
};

export interface GameLog {
  game_id: string;
  game_date: string;
  start_time: string;
  season: string;
  team_id: string;
  team_abbr: string;
  team_name: string;
  opponent_id: string;
  opponent_abbr: string;
  opponent_name: string;
  location: 'home' | 'away';
  result: 'W' | 'L' | null;
  team_score: number | null;
  opponent_score: number | null;
  minutes: number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  field_goals_made: number | null;
  field_goals_attempted: number | null;
  three_pointers_made: number | null;
  three_pointers_attempted: number | null;
  free_throws_made: number | null;
  free_throws_attempted: number | null;
  plus_minus: number | null;
  started: boolean | null;
  dnp_reason: string | null;
  offensive_rebounds: number | null;
  defensive_rebounds: number | null;
  personal_fouls: number | null;
  opponent_defensive_rankings?: {
    points_allowed_rank?: number;
    rebounds_allowed_rank?: number;
    assists_allowed_rank?: number;
    fg_pct_allowed_rank?: number;
    three_pct_allowed_rank?: number;
  };
}

export interface PlayerProfile {
  player_id: string;
  full_name: string;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  height?: string | null;
  weight?: string | null;
  dob?: string | null;
  active?: boolean | null;
}

export interface SeasonAverages {
  games_played?: number;
  games_active?: number;
  games_started?: number;
  avg_points?: number;
  avg_rebounds?: number;
  avg_assists?: number;
  avg_steals?: number;
  avg_blocks?: number;
  avg_turnovers?: number;
  avg_minutes?: number;
  avg_plus_minus?: number;
  fg_pct?: number;
  three_pct?: number;
  ft_pct?: number;
  efg_pct?: number;
  ts_pct?: number;
  total_points?: number;
  total_rebounds?: number;
  total_assists?: number;
  total_steals?: number;
  total_blocks?: number;
  total_turnovers?: number;
  total_fgm?: number;
  total_fga?: number;
  total_3pm?: number;
  total_3pa?: number;
  total_ftm?: number;
  total_fta?: number;
  total_minutes?: number;
  total_orb?: number;
  avg_orb?: number;
  total_drb?: number;
  avg_drb?: number;
  total_pf?: number;
  avg_pf?: number;
}

export interface SummaryResult {
  avg: number;
  last5: number;
  last10: number;
  high: number;
  low: number;
}

export interface HitRateResult {
  last10: number;
  last20: number;
}

export interface StreakResult {
  count: number;
  type: 'over' | 'under';
}
