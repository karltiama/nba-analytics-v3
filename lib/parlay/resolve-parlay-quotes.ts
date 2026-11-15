/**
 * The production True Cost quote choice. SQL quotes stay. An empty SQL list
 * for a frozen archived game may be filled from the historical board.
 * Callers choose the SQL source. This module does not invent one.
 */
import { archiveQuotesForEmptyLegs } from '@/lib/parlay/historical-board-quotes';
import type { BookLegQuote } from '@/lib/parlay/true-cost';
import type { TrueCostLegKey } from '@/lib/parlay/true-cost-quotes';
import type { HistoricalBoardSource } from '@/lib/props/historical-board-config';
import {
  fillEmptyLegQuotes,
  type HistoricalBoardObjectStore,
} from '@/lib/props/historical-board-archive';

export type ParlayQuoteSourceName = 'historical-board-archive' | 'analytics.player_props_current';

export async function resolveParlayQuoteFallback(args: {
  legs: readonly TrueCostLegKey[];
  vendors: readonly (string | null)[];
  bestBookEnabled: boolean;
  source: HistoricalBoardSource;
  loadSqlQuotes: (legs: readonly TrueCostLegKey[]) => Promise<BookLegQuote[][]>;
  store?: HistoricalBoardObjectStore;
}): Promise<{
  quotesPerLeg: BookLegQuote[][];
  quoteSource: ParlayQuoteSourceName;
  sqlRowCount: number;
}> {
  const sqlQuotes = await args.loadSqlQuotes(args.legs);
  const archiveQuotes = await archiveQuotesForEmptyLegs(args.source, args.legs, sqlQuotes, args.store);
  const merged = fillEmptyLegQuotes(sqlQuotes, archiveQuotes);
  const quotesPerLeg = args.bestBookEnabled
    ? merged
    : merged.map((quotes, index) => quotes.filter((quote) => quote.vendor === args.vendors[index]));
  const sqlRowCount = sqlQuotes.reduce((sum, quotes) => sum + quotes.length, 0);
  const usedArchive = args.source.mode !== 'off'
    && sqlQuotes.some((quotes, index) => quotes.length === 0 && (merged[index]?.length ?? 0) > 0);
  return {
    quotesPerLeg,
    quoteSource: usedArchive ? 'historical-board-archive' : 'analytics.player_props_current',
    sqlRowCount,
  };
}
