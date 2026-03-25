export interface GameTarget {
  gameId: string;
  bdlGameId: number;
}

export type MarketType = 'over_under' | 'milestone';
export type OutcomeSide = 'over' | 'under' | 'milestone';

export interface BdlOverUnderMarket {
  type: 'over_under';
  over_odds: number;
  under_odds: number;
}

export interface BdlMilestoneMarket {
  type: 'milestone';
  odds: number;
}

export type BdlMarket = BdlOverUnderMarket | BdlMilestoneMarket;

export interface BdlPlayerPropRow {
  id: number;
  game_id: number;
  player_id: number;
  vendor: string;
  prop_type: string;
  line_value: string;
  market: BdlMarket;
  updated_at?: string | null;
}

export interface NormalizedPropRow {
  game_id: number;
  player_id: number;
  player_name: string | null;
  team_id: number | null;
  sportsbook: string;
  prop_type: string;
  market_type: MarketType;
  side: OutcomeSide;
  line_value: number | null;
  odds_american: number;
  odds_decimal: number;
  implied_probability: number;
  raw_json: object;
  provider_updated_at: Date | null;
}

export interface WorkerMessage {
  runId: number;
  gameId: string;
  bdlGameId: number;
  date: string;
}
