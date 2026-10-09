import { z } from 'zod';
import { BDL_BASE } from './env';
import type { BdlPlayerPropRow } from './types';
import { fetchBdlLive, type FetchBdlLiveOptions } from './bdl-live-rate-limit';
import { createAttemptRecorder, type ProviderObservation } from './observation-clock';

const BdlMarketSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('over_under'),
    over_odds: z.number(),
    under_odds: z.number(),
  }),
  z.object({
    type: z.literal('milestone'),
    odds: z.number(),
  }),
]);

const BdlPlayerPropRowSchema = z.object({
  id: z.number(),
  game_id: z.number(),
  player_id: z.number(),
  vendor: z.string(),
  prop_type: z.string(),
  line_value: z.string(),
  market: BdlMarketSchema,
  updated_at: z.string().nullable().optional(),
});

const BdlPlayerPropsResponseSchema = z.object({
  data: z.array(BdlPlayerPropRowSchema),
  meta: z
    .object({ next_cursor: z.number().int().nullable().optional() })
    .passthrough()
    .nullable()
    .optional(),
});

/** Hard page cap per game. Exceeding it fails the whole fetch; a partial snapshot is never returned. */
export const PLAYER_PROPS_MAX_PAGES = 10;

export type PlayerPropsFetchResult = {
  rows: BdlPlayerPropRow[];
  observation: ProviderObservation;
};

/**
 * Follows meta.next_cursor through the shared limiter. Any non-OK or malformed page, a row for a
 * different game, a repeated cursor, or exceeding PLAYER_PROPS_MAX_PAGES throws, so the worker
 * retries the whole game.
 * Observation spans the first page's request start to the last page's response.
 */
export async function fetchPlayerPropsForGame(
  apiKey: string,
  bdlGameId: number,
  options: {
    limiter?: Omit<FetchBdlLiveOptions, 'fetchImpl' | 'worker'>;
    baseFetch?: typeof fetch;
    now?: () => Date;
  } = {}
): Promise<PlayerPropsFetchResult> {
  const recorder = createAttemptRecorder(options.baseFetch ?? globalThis.fetch, options.now);
  const rows: BdlPlayerPropRow[] = [];
  const seenCursors = new Set<number>();
  let firstRequestStartedAt: Date | null = null;
  let cursor: number | null = null;

  for (let page = 1; ; page += 1) {
    if (page > PLAYER_PROPS_MAX_PAGES) {
      throw new Error(`BDL /odds/player_props game ${bdlGameId}: exceeded ${PLAYER_PROPS_MAX_PAGES} pages`);
    }
    const url = new URL(`${BDL_BASE}/odds/player_props`);
    url.searchParams.set('game_id', String(bdlGameId));
    if (cursor != null) url.searchParams.set('cursor', String(cursor));

    const res = await fetchBdlLive(
      url.toString(),
      { headers: { Authorization: apiKey } },
      { ...options.limiter, fetchImpl: recorder.fetchImpl, worker: 'player-props-worker' }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`BDL /odds/player_props ${res.status} (page ${page}): ${body}`);
    }
    const pageObservation = recorder.observation();
    firstRequestStartedAt ??= pageObservation.requestStartedAt;

    const parsed = BdlPlayerPropsResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      throw new Error(`BDL /odds/player_props game ${bdlGameId}: malformed page ${page}`);
    }
    const foreign = parsed.data.data.find((row) => row.game_id !== bdlGameId);
    if (foreign) {
      throw new Error(
        `BDL /odds/player_props game ${bdlGameId}: page ${page} returned row for game ${foreign.game_id}`
      );
    }
    rows.push(...parsed.data.data);

    const next = parsed.data.meta?.next_cursor ?? null;
    if (next == null) {
      return {
        rows,
        observation: { ...pageObservation, requestStartedAt: firstRequestStartedAt },
      };
    }
    if (seenCursors.has(next)) {
      throw new Error(`BDL /odds/player_props game ${bdlGameId}: repeated cursor ${next}`);
    }
    seenCursors.add(next);
    cursor = next;
  }
}
