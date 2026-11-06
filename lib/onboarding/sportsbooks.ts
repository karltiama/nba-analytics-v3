/**
 * Sportsbook catalog for onboarding and settings.
 *
 * Only books Court Context carries odds for (ids match EXPLORER_BOOKS), plus the
 * prediction markets Kalshi and Polymarket. Add a book here when its odds ship.
 *
 * "Common in" only orders the list. It is not a legality claim and never hides a book.
 * Review it against regulator sites when books are added, and bump CATALOG_REVIEWED_ON.
 */

import { EXPLORER_BOOKS } from '@/lib/betting/props-explorer-filters';
import type { BettingCountry } from './regions';

export const CATALOG_REVIEWED_ON = '2026-11-06';

export type BookKind = 'sportsbook' | 'prediction_market';

export type SportsbookEntry = {
  id: string;
  label: string;
  kind: BookKind;
  /** Where this book is commonly used. 'all' = the whole country; otherwise subdivision codes. */
  commonIn: Partial<Record<Exclude<BettingCountry, 'OTHER'>, 'all' | readonly string[]>>;
};

export const SPORTSBOOK_CATALOG: readonly SportsbookEntry[] = [
  { id: 'draftkings', label: 'DraftKings', kind: 'sportsbook', commonIn: { US: 'all', CA: ['ON'] } },
  { id: 'fanduel', label: 'FanDuel', kind: 'sportsbook', commonIn: { US: 'all', CA: ['ON'] } },
  { id: 'betmgm', label: 'BetMGM', kind: 'sportsbook', commonIn: { US: 'all', CA: ['ON'] } },
  { id: 'caesars', label: 'Caesars', kind: 'sportsbook', commonIn: { US: 'all', CA: ['ON'] } },
  { id: 'betrivers', label: 'BetRivers', kind: 'sportsbook', commonIn: { US: 'all', CA: ['ON'] } },
  { id: 'fanatics', label: 'Fanatics', kind: 'sportsbook', commonIn: { US: 'all' } },
  { id: 'betparx', label: 'BetParx', kind: 'sportsbook', commonIn: { US: 'all' } },
  { id: 'ballybet', label: 'Bally Bet', kind: 'sportsbook', commonIn: { US: 'all' } },
  { id: 'betway', label: 'Betway', kind: 'sportsbook', commonIn: { CA: 'all' } },
  // Prediction markets: kept apart, and not in Props Explorer's book filter.
  { id: 'kalshi', label: 'Kalshi', kind: 'prediction_market', commonIn: {} },
  { id: 'polymarket', label: 'Polymarket', kind: 'prediction_market', commonIn: {} },
];

export const MAX_SELECTED_BOOKS = SPORTSBOOK_CATALOG.length;

const BY_ID = new Map(SPORTSBOOK_CATALOG.map((b) => [b.id, b]));
const ODDS_IDS = new Set<string>(EXPLORER_BOOKS.map((b) => b.id));

export function bookById(id: string): SportsbookEntry | undefined {
  return BY_ID.get(id);
}

/** True when Court Context has odds from this book (Props Explorer can filter to it). */
export function hasOddsData(id: string): boolean {
  return ODDS_IDS.has(id);
}

/** Known ids only, de-duplicated, catalog order. */
export function normalizeBookIds(ids: readonly unknown[] | null | undefined): string[] {
  if (!ids) return [];
  const wanted = new Set(ids.filter((v): v is string => typeof v === 'string'));
  return SPORTSBOOK_CATALOG.filter((b) => wanted.has(b.id)).map((b) => b.id);
}

/** The selected books Props Explorer can filter to. */
export function booksWithOdds(ids: readonly string[]): string[] {
  return ids.filter(hasOddsData);
}

export function isCommonIn(
  book: SportsbookEntry,
  country: BettingCountry | null | undefined,
  subdivision: string | null | undefined
): boolean {
  if (country !== 'US' && country !== 'CA') return false;
  const rule = book.commonIn[country];
  if (!rule) return false;
  if (rule === 'all') return true;
  return subdivision != null && rule.includes(subdivision);
}

export type GroupedBooks = {
  common: SportsbookEntry[];
  other: SportsbookEntry[];
  predictionMarkets: SportsbookEntry[];
};

/** Sportsbooks common in the user's region first, then every other sportsbook, then prediction markets. */
export function groupBooksForRegion(
  country: BettingCountry | null | undefined,
  subdivision: string | null | undefined
): GroupedBooks {
  const common: SportsbookEntry[] = [];
  const other: SportsbookEntry[] = [];
  const predictionMarkets: SportsbookEntry[] = [];
  for (const book of SPORTSBOOK_CATALOG) {
    if (book.kind === 'prediction_market') predictionMarkets.push(book);
    else if (isCommonIn(book, country, subdivision)) common.push(book);
    else other.push(book);
  }
  return { common, other, predictionMarkets };
}
