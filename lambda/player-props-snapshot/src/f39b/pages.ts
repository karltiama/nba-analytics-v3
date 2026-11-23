import type { BdlPlayerPropRow } from '../types';

/** Same page cap as fetchPlayerPropsForGame. A partial board is never returned. */
export const PROPS_PAGE_CAP = 10;

export type ProviderPage = {
  httpStatus: number;
  payload: unknown;
};

export type PageEvidence = {
  pagesRead: number;
  pageCap: number;
  cursorClosed: boolean;
  repeatedCursor: boolean;
  foreignGame: boolean;
  malformed: boolean;
  badPage: boolean;
  truncatedAtCap: boolean;
};

export type PageValidation =
  | { ok: true; rows: BdlPlayerPropRow[]; evidence: PageEvidence }
  | { ok: false; reason: 'incomplete_pagination'; evidence: PageEvidence };

const closedEvidence = (partial: Partial<PageEvidence>): PageEvidence => ({
  pagesRead: 0,
  pageCap: PROPS_PAGE_CAP,
  cursorClosed: false,
  repeatedCursor: false,
  foreignGame: false,
  malformed: false,
  badPage: false,
  truncatedAtCap: false,
  ...partial,
});

function isProviderRow(value: unknown, gameId: number): value is BdlPlayerPropRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as BdlPlayerPropRow;
  if (row.game_id !== gameId || typeof row.player_id !== 'number' || typeof row.vendor !== 'string') return false;
  if (typeof row.prop_type !== 'string' || typeof row.line_value !== 'string') return false;
  const market = row.market;
  if (!market || typeof market !== 'object') return false;
  if (market.type === 'over_under') {
    return typeof market.over_odds === 'number' && typeof market.under_odds === 'number';
  }
  if (market.type === 'milestone') return typeof market.odds === 'number';
  return false;
}

/**
 * Mirrors the fetch loop: a non-OK page, a malformed page, a foreign game,
 * a repeated cursor, or a cursor that remains at the page cap fails the pull.
 */
export function validateProviderPull(pages: readonly ProviderPage[], bdlGameId: number): PageValidation {
  const rows: BdlPlayerPropRow[] = [];
  const seenCursors = new Set<number>();
  let cursor: number | null = null;

  for (let index = 0; index < pages.length; index += 1) {
    const pageNumber = index + 1;
    if (pageNumber > PROPS_PAGE_CAP) {
      return {
        ok: false,
        reason: 'incomplete_pagination',
        evidence: closedEvidence({ pagesRead: PROPS_PAGE_CAP, truncatedAtCap: true }),
      };
    }
    const page = pages[index];
    if (!page || page.httpStatus !== 200) {
      return {
        ok: false,
        reason: 'incomplete_pagination',
        evidence: closedEvidence({ pagesRead: pageNumber, badPage: true }),
      };
    }
    const payload = page.payload;
    if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { data?: unknown }).data)) {
      return {
        ok: false,
        reason: 'incomplete_pagination',
        evidence: closedEvidence({ pagesRead: pageNumber, malformed: true }),
      };
    }
    const data = (payload as { data: unknown[] }).data;
    for (const row of data) {
      if (!isProviderRow(row, bdlGameId)) {
        const foreign = !!row && typeof row === 'object' && (row as { game_id?: unknown }).game_id !== bdlGameId;
        return {
          ok: false,
          reason: 'incomplete_pagination',
          evidence: closedEvidence({
            pagesRead: pageNumber,
            foreignGame: foreign,
            malformed: !foreign,
          }),
        };
      }
      rows.push(row);
    }
    const next = (payload as { meta?: { next_cursor?: unknown } }).meta?.next_cursor;
    if (next == null) {
      return {
        ok: true,
        rows,
        evidence: closedEvidence({ pagesRead: pageNumber, cursorClosed: true }),
      };
    }
    if (typeof next !== 'number' || seenCursors.has(next) || next === cursor) {
      return {
        ok: false,
        reason: 'incomplete_pagination',
        evidence: closedEvidence({ pagesRead: pageNumber, repeatedCursor: true }),
      };
    }
    if (pageNumber === PROPS_PAGE_CAP) {
      return {
        ok: false,
        reason: 'incomplete_pagination',
        evidence: closedEvidence({ pagesRead: pageNumber, truncatedAtCap: true }),
      };
    }
    seenCursors.add(next);
    cursor = next;
  }

  return {
    ok: false,
    reason: 'incomplete_pagination',
    evidence: closedEvidence({ pagesRead: pages.length, cursorClosed: false }),
  };
}
