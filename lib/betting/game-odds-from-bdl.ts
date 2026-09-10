/**
 * Map a BDL GET /v2/odds row onto per-market quotes without inventing prices.
 */

import {
  type GameOddsQuote,
  parseOptionalNumeric,
} from '@/lib/betting/game-odds-lifecycle';

export type BdlGameOddsRow = {
  id?: number | null;
  game_id?: number | string | null;
  vendor?: string | null;
  spread_home_value?: string | number | null;
  spread_home_odds?: number | null;
  spread_away_value?: string | number | null;
  spread_away_odds?: number | null;
  moneyline_home_odds?: number | null;
  moneyline_away_odds?: number | null;
  total_value?: string | number | null;
  total_over_odds?: number | null;
  total_under_odds?: number | null;
  updated_at?: string | null;
};

export function quotesFromBdlOddsRow(
  row: BdlGameOddsRow,
  observedAt: string
): GameOddsQuote[] {
  const gameId = row.game_id == null ? '' : String(row.game_id);
  const vendor = String(row.vendor ?? '').trim();
  const providerUpdatedAt = row.updated_at ? String(row.updated_at) : null;
  const base = {
    gameId,
    vendor,
    homeMoneyline: parseOptionalNumeric(row.moneyline_home_odds),
    awayMoneyline: parseOptionalNumeric(row.moneyline_away_odds),
    homeSpread: parseOptionalNumeric(row.spread_home_value),
    awaySpread: parseOptionalNumeric(row.spread_away_value),
    homeSpreadOdds: parseOptionalNumeric(row.spread_home_odds),
    awaySpreadOdds: parseOptionalNumeric(row.spread_away_odds),
    total: parseOptionalNumeric(row.total_value),
    overOdds: parseOptionalNumeric(row.total_over_odds),
    underOdds: parseOptionalNumeric(row.total_under_odds),
    providerUpdatedAt,
    observedAt,
  };

  return [
    { ...base, market: 'moneyline' as const },
    { ...base, market: 'spread' as const },
    { ...base, market: 'total' as const },
  ];
}
