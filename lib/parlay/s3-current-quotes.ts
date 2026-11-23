import { quotesForLegs, type CurrentPropPriceRow, type TrueCostLegKey } from '@/lib/parlay/true-cost-quotes';
import type { BookLegQuote } from '@/lib/parlay/true-cost';
import { defaultCurrentBoardStore, readCurrentBoard, type CurrentBoardStore } from '@/lib/props/s3-current-board/read';

/**
 * Current parlay prices from verified boards only.
 * The frozen historical-board cohort stays on the PostgreSQL path.
 */
export async function loadS3CurrentLegQuotes(args: {
  legs: readonly TrueCostLegKey[];
  vendors: readonly (string | null)[];
  bestBookEnabled: boolean;
  now: Date;
  store?: CurrentBoardStore;
}): Promise<{ quotesPerLeg: BookLegQuote[][]; quoteSource: 's3.player_prop_current' }> {
  const store = args.store ?? defaultCurrentBoardStore();
  const gameIds = [...new Set(args.legs.map((leg) => leg.gameId))];
  const rows: CurrentPropPriceRow[] = [];
  for (const gameId of gameIds) {
    const board = await readCurrentBoard({ store, gameId, now: args.now.toISOString() });
    if (!board.available) continue;
    for (const row of board.rows) {
      if (row.line == null || row.oddsAmerican == null) continue;
      rows.push({
        game_id: board.gameId,
        player_id: row.playerId,
        sportsbook: row.sportsbook,
        prop_type: row.propType,
        side: row.side,
        line_value: row.line,
        odds_american: row.oddsAmerican,
        snapshot_at: board.observedAt,
      });
    }
  }
  const quotes = quotesForLegs(args.legs, rows);
  const quotesPerLeg = args.bestBookEnabled
    ? quotes
    : quotes.map((list, index) => list.filter((quote) => quote.vendor === args.vendors[index]));
  return { quotesPerLeg, quoteSource: 's3.player_prop_current' };
}
