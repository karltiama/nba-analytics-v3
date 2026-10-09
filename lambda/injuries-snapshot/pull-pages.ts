/**
 * Bounded cursor pagination over BDL /nba/v1/player_injuries.
 * Rows are validated for the fields the transform needs, but the original provider
 * object is kept verbatim (unknown fields included) for raw.player_injuries.raw_payload.
 */

import { z } from 'zod';

export const BdlPlayerSchema = z
  .object({
    id: z.number(),
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    team_id: z.number().nullable().optional(),
    team: z.any().nullable().optional(),
  })
  .passthrough();

export const BdlPlayerInjurySchema = z
  .object({
    player: BdlPlayerSchema,
    return_date: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
  })
  .passthrough();

const BdlInjuriesPageSchema = z
  .object({
    data: z.array(z.unknown()),
    meta: z
      .object({
        next_cursor: z.number().nullable().optional(),
        per_page: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type BdlPlayerInjury = z.infer<typeof BdlPlayerInjurySchema>;

export type InjuryPullRecord = {
  row: BdlPlayerInjury;
  /** The provider's row exactly as received. */
  raw: unknown;
};

export const INJURY_MAX_PAGES_ENV = 'INJURY_MAX_PAGES';
export const DEFAULT_INJURY_MAX_PAGES = 20;
export const INJURY_MAX_PAGES_RANGE = { min: 1, max: 50 } as const;

/** Unset means 20 pages (2,000 rows at per_page=100). Invalid values throw before any provider call. */
export function resolveInjuryMaxPages(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_INJURY_MAX_PAGES;
  const trimmed = raw.trim();
  const n = Number(trimmed);
  const { min, max } = INJURY_MAX_PAGES_RANGE;
  if (!/^\d+$/.test(trimmed) || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`invalid ${INJURY_MAX_PAGES_ENV}=${trimmed}: expected an integer in [${min}, ${max}]`);
  }
  return n;
}

/**
 * Fetches every page or throws. A page cap, a repeated cursor, or a malformed page is an
 * incomplete pull and must never reach the transform (which could otherwise clear rows).
 */
export async function collectInjuryPages(
  fetchPage: (cursor: number | null) => Promise<unknown>,
  opts: { maxPages: number }
): Promise<{ records: InjuryPullRecord[]; pages: number }> {
  const records: InjuryPullRecord[] = [];
  const seenCursors = new Set<number>();
  let cursor: number | null = null;
  let pages = 0;

  while (true) {
    const page = BdlInjuriesPageSchema.parse(await fetchPage(cursor));
    pages += 1;
    for (const raw of page.data) {
      records.push({ row: BdlPlayerInjurySchema.parse(raw), raw });
    }
    const next = page.meta?.next_cursor ?? null;
    if (next == null) break;
    if (seenCursors.has(next)) {
      throw new Error(`injury pagination repeated cursor ${next} after ${pages} pages`);
    }
    if (pages >= opts.maxPages) {
      throw new Error(`injury pagination hit page cap ${opts.maxPages} with cursor ${next}; pull is incomplete`);
    }
    seenCursors.add(next);
    cursor = next;
  }

  return { records, pages };
}
