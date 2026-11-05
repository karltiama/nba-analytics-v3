/**
 * Matches current prop rows (analytics.player_props_current) to parlay legs, per book.
 * Pure: the server module runs the query and passes rows in.
 *
 * A quote only matches the exact game, player, market and line of the leg. A book that
 * prices the same player at a different line is not the same bet and is left out.
 */

import { canonicalizePropType } from '@/lib/betting/market-movement';
import { parseLineValue, parsePropSide } from '@/lib/betting/prop-market-compare';
import { canonicalizeSportsbook } from '@/lib/parlay-xray/resolution/sportsbook';
import type { BookLegQuote } from './true-cost';

export type TrueCostLegKey = {
  gameId: string;
  playerId: string;
  /** Canonical prop type (points, rebounds, ...). */
  market: string;
  side: 'over' | 'under';
  line: number;
};

export type CurrentPropPriceRow = {
  game_id: string | number;
  player_id: string | number;
  sportsbook: string | null;
  prop_type: string | null;
  side: string | null;
  line_value: string | number | null;
  odds_american: number | string | null;
  snapshot_at?: string | Date | null;
};

export type LegBookQuotes = {
  quotes: BookLegQuote[];
};

function toPrice(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/** Per leg (same order as `legs`), one quote per supported book that prices the chosen side. */
export function quotesForLegs(legs: TrueCostLegKey[], rows: CurrentPropPriceRow[]): BookLegQuote[][] {
  type Cell = { vendor: string; displayName: string; over: number | null; under: number | null };
  const cells = new Map<string, Cell>();
  const keyOf = (gameId: string, playerId: string, market: string, line: number, vendor: string) =>
    `${gameId}|${playerId}|${market}|${line}|${vendor}`;

  for (const row of rows) {
    const market = canonicalizePropType(row.prop_type);
    const side = parsePropSide(row.side);
    const line = parseLineValue(row.line_value);
    const book = canonicalizeSportsbook(row.sportsbook);
    if (!market || !side || line == null || !book) continue;
    const key = keyOf(String(row.game_id), String(row.player_id), market, line, book.vendor);
    const cell = cells.get(key) ?? { vendor: book.vendor, displayName: book.displayName, over: null, under: null };
    cell[side] = toPrice(row.odds_american);
    cells.set(key, cell);
  }

  return legs.map((leg) => {
    const out: BookLegQuote[] = [];
    for (const [key, cell] of cells) {
      if (!key.startsWith(`${leg.gameId}|${leg.playerId}|${leg.market}|${leg.line}|`)) continue;
      const price = leg.side === 'over' ? cell.over : cell.under;
      if (price == null) continue;
      out.push({
        vendor: cell.vendor,
        displayName: cell.displayName,
        priceAmerican: price,
        oppositeAmerican: leg.side === 'over' ? cell.under : cell.over,
      });
    }
    out.sort((a, b) => a.vendor.localeCompare(b.vendor));
    return out;
  });
}

/** Best-single-book view is on unless PARLAY_TRUE_COST_BEST_BOOK is "0" / "false" / "off". */
export function isBestBookViewEnabled(raw: string | null | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}
