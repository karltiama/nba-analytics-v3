/**
 * Canonical NBA season window for compact historical serving backfill.
 * Storage/query season is the start year (same as WP2 isolation): 2024 = 2024–25.
 */

export type HistoricalSeasonWindow = {
  seasonStartYear: number;
  storedSeason: string;
  label: string;
  /** Inclusive lower bound; drops BDL preseason that can appear before opening night. */
  servingMinDate: string;
  /** Inclusive upper bound; includes playoffs, excludes the next season's opener. */
  servingMaxDate: string;
};

export function historicalSeasonWindow(seasonStartYear: number): HistoricalSeasonWindow {
  if (!Number.isInteger(seasonStartYear) || seasonStartYear < 1946 || seasonStartYear > 3000) {
    throw new Error(`Invalid historical season start year: ${seasonStartYear}`);
  }
  const next = seasonStartYear + 1;
  return {
    seasonStartYear,
    storedSeason: String(seasonStartYear),
    label: `${seasonStartYear}–${String(next).slice(-2)}`,
    servingMinDate: `${seasonStartYear}-10-15`,
    servingMaxDate: `${next}-06-30`,
  };
}

export function isDateInServingWindow(dateIso: string, window: HistoricalSeasonWindow): boolean {
  const d = dateIso.slice(0, 10);
  return d >= window.servingMinDate && d <= window.servingMaxDate;
}
