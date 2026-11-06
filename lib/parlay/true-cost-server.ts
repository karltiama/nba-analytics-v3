/**
 * Server read for the parlay true-cost panel: current prices for each leg across books.
 * Reads analytics.player_props_current the way Props Explorer does (over/under rows,
 * matched on game, player, prop and line). Read-only.
 */

import { query } from '@/lib/db';
import {
  quotesForLegs,
  type CurrentPropPriceRow,
  type TrueCostLegKey,
} from './true-cost-quotes';
import type { BookLegQuote } from './true-cost';

export async function loadCurrentLegQuotes(legs: TrueCostLegKey[]): Promise<BookLegQuote[][]> {
  if (legs.length === 0) return [];
  const gameIds = [...new Set(legs.map((l) => l.gameId))];
  const playerIds = [...new Set(legs.map((l) => l.playerId))];
  const rows = await query<CurrentPropPriceRow>(
    `SELECT p.game_id::text AS game_id, p.player_id::text AS player_id, p.sportsbook, p.prop_type,
            p.side, p.line_value::text AS line_value, p.odds_american, p.snapshot_at
       FROM analytics.player_props_current p
      WHERE p.game_id::text = ANY($1::text[])
        AND p.player_id::text = ANY($2::text[])
        AND lower(p.market_type) = 'over_under'
        AND p.line_value IS NOT NULL
        AND p.odds_american IS NOT NULL`,
    [gameIds, playerIds]
  );
  return quotesForLegs(legs, Array.isArray(rows) ? rows : []);
}
