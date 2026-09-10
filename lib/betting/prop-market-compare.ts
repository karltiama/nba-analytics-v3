/**
 * Prop market comparison (line shopping).
 * Market research only — not EV, edge, or a recommended bet.
 *
 * Live freshness window matches the existing injury-opportunity near-tip
 * stale check (30 minutes). Observed analytics.player_prop_lines cadence on
 * 2026-03-09 was ~57 snapshots in ~64 minutes (~1 min). 30 minutes is
 * conservative versus that poll rate.
 */

import {
  propsLineLabel,
  type PropsMarketContext,
} from '@/lib/betting/props-market-context';

export const LIVE_SHOPPING_FRESHNESS_MINUTES = 30;
export const PROP_MARKET_BOOK_CAP = 40;

export type PropSide = 'over' | 'under';

export type PropMarketBookRow = {
  sportsbook: string;
  side: PropSide;
  lineValue: number;
  oddsAmerican: number;
  snapshotAt: string;
};

export type PropMarketLinePick = {
  sportsbook: string;
  side: PropSide;
  lineValue: number;
  oddsAmerican: number;
};

export type LiveShoppingAvailability =
  | { ok: true }
  | {
      ok: false;
      reason: 'frozen_current' | 'stale_current' | 'missing_shopping_data';
    };

/** 0 is a valid sportsbook line; only null/NaN/non-finite are missing. */
export function isPresentLineValue(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

export function parseLineValue(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function parsePropSide(raw: string | null | undefined): PropSide | null {
  const side = (raw ?? '').trim().toLowerCase();
  if (side === 'over' || side === 'under') return side;
  return null;
}

/** Higher American odds are a better price at the same line (-105 beats -120). */
export function isBetterAmericanPrice(candidate: number, baseline: number): boolean {
  return candidate > baseline;
}

export function propsComparisonLabel(context: PropsMarketContext): string {
  return context === 'historical'
    ? 'Historical sportsbook comparison'
    : 'Current market comparison';
}

export function shoppingUnavailableMessage(): string {
  return 'Line comparison unavailable';
}

function normalizeBook(name: string): string {
  return name.trim().toLowerCase();
}

function betterLine(candidate: number, current: number, side: PropSide): boolean {
  return side === 'over' ? candidate < current : candidate > current;
}

function preferBookRow(candidate: PropMarketBookRow, current: PropMarketBookRow): boolean {
  if (candidate.oddsAmerican !== current.oddsAmerican) {
    return isBetterAmericanPrice(candidate.oddsAmerican, current.oddsAmerican);
  }
  return normalizeBook(candidate.sportsbook) < normalizeBook(current.sportsbook);
}

export function pickBestLine(
  rows: PropMarketBookRow[],
  side: PropSide
): PropMarketLinePick | null {
  const sideRows = rows.filter((r) => r.side === side && isPresentLineValue(r.lineValue));
  if (sideRows.length === 0) return null;
  const best = sideRows.reduce((acc, row) => {
    if (betterLine(row.lineValue, acc.lineValue, side)) return row;
    if (row.lineValue === acc.lineValue && preferBookRow(row, acc)) return row;
    return acc;
  });
  return {
    sportsbook: best.sportsbook,
    side: best.side,
    lineValue: best.lineValue,
    oddsAmerican: best.oddsAmerican,
  };
}

export function pickBestPriceAtLine(
  rows: PropMarketBookRow[],
  side: PropSide,
  lineValue: number
): PropMarketLinePick | null {
  if (!isPresentLineValue(lineValue)) return null;
  const atLine = rows.filter(
    (r) => r.side === side && isPresentLineValue(r.lineValue) && r.lineValue === lineValue
  );
  if (atLine.length === 0) return null;
  const best = atLine.reduce((acc, row) => (preferBookRow(row, acc) ? row : acc));
  return {
    sportsbook: best.sportsbook,
    side: best.side,
    lineValue: best.lineValue,
    oddsAmerican: best.oddsAmerican,
  };
}

export function summarizeComparableBoard(
  rows: PropMarketBookRow[],
  selected: { side: PropSide; lineValue: number; sportsbook: string }
): {
  bestAvailableOverLine: PropMarketLinePick | null;
  bestAvailableUnderLine: PropMarketLinePick | null;
  bestPriceAtSelectedLine: PropMarketLinePick | null;
  marketMinLine: number | null;
  marketMaxLine: number | null;
  bookCount: number;
  latestSnapshotAt: string | null;
  books: PropMarketBookRow[];
} | null {
  const sideRows = rows.filter((r) => r.side === selected.side && isPresentLineValue(r.lineValue));
  if (sideRows.length === 0) return null;

  const lines = sideRows.map((r) => r.lineValue);
  const books = [...sideRows]
    .sort((a, b) => {
      if (a.lineValue !== b.lineValue) return a.lineValue - b.lineValue;
      return normalizeBook(a.sportsbook).localeCompare(normalizeBook(b.sportsbook));
    })
    .slice(0, PROP_MARKET_BOOK_CAP);

  const snapshots = rows
    .map((r) => r.snapshotAt)
    .filter((ts) => ts.trim() !== '')
    .sort();

  return {
    bestAvailableOverLine: pickBestLine(rows, 'over'),
    bestAvailableUnderLine: pickBestLine(rows, 'under'),
    bestPriceAtSelectedLine: pickBestPriceAtLine(rows, selected.side, selected.lineValue),
    marketMinLine: Math.min(...lines),
    marketMaxLine: Math.max(...lines),
    bookCount: new Set(sideRows.map((r) => normalizeBook(r.sportsbook))).size,
    latestSnapshotAt: snapshots.length > 0 ? snapshots[snapshots.length - 1] : null,
    books,
  };
}

export function liveShoppingAvailability(input: {
  frozen: boolean;
  newestSnapshotAt: string | null;
  selectedSnapshotAt: string | null;
  now: Date;
  windowMinutes?: number;
}): LiveShoppingAvailability {
  if (input.frozen) return { ok: false, reason: 'frozen_current' };
  if (!input.newestSnapshotAt) return { ok: false, reason: 'missing_shopping_data' };

  const windowMs = (input.windowMinutes ?? LIVE_SHOPPING_FRESHNESS_MINUTES) * 60 * 1000;
  const newest = new Date(input.newestSnapshotAt);
  if (Number.isNaN(newest.getTime())) return { ok: false, reason: 'stale_current' };
  if (input.now.getTime() - newest.getTime() > windowMs) {
    return { ok: false, reason: 'stale_current' };
  }

  if (input.selectedSnapshotAt) {
    const selected = new Date(input.selectedSnapshotAt);
    if (
      !Number.isNaN(selected.getTime()) &&
      Math.abs(newest.getTime() - selected.getTime()) > windowMs
    ) {
      return { ok: false, reason: 'stale_current' };
    }
  }

  return { ok: true };
}

export function marketContextLabels(context: PropsMarketContext): {
  lineLabel: string;
  comparisonLabel: string;
} {
  return {
    lineLabel: propsLineLabel(context),
    comparisonLabel: propsComparisonLabel(context),
  };
}
