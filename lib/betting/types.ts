/**
 * Types for player prop line shopping (analytics.player_prop_lines and comparison output).
 */

/** One row from analytics.player_prop_lines. */
export interface PlayerPropLineRow {
  id: string;
  game_id: string;
  player_id: string;
  player_name: string | null;
  team_id: string | null;
  sportsbook: string;
  market_type: string;
  side: 'over' | 'under';
  line_value: number;
  odds_american: number;
  odds_decimal: number;
  implied_probability: number;
  snapshot_at: string;
  created_at?: string;
}

/** Row returned by comparison query (all books for same prop). */
export interface PlayerPropLineComparisonRow {
  sportsbook: string;
  side: 'over' | 'under';
  line_value: number;
  odds_american: number;
  odds_decimal: number;
  implied_probability: number;
  snapshot_at: string;
  player_name?: string | null;
  game_id?: string;
}

/** One book entry in the line shopping response. */
export interface PlayerPropLineBookEntry {
  book: string;
  line: number;
  side: 'over' | 'under';
  odds: number;
}

/** Best line or best price entry. */
export interface PlayerPropLineBestEntry {
  book: string;
  line?: number;
  odds?: number;
}

/** Line shopping response: books + best over/under line and best price on same line. */
export interface PlayerPropLineShoppingResponse {
  player: string;
  market: string;
  books: PlayerPropLineBookEntry[];
  best_over_line: PlayerPropLineBestEntry | null;
  best_under_line: PlayerPropLineBestEntry | null;
  best_over_price_same_line: PlayerPropLineBestEntry | null;
  best_under_price_same_line: PlayerPropLineBestEntry | null;
}
