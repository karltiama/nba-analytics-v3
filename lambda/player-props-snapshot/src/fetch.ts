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
});

export type PlayerPropsFetchResult = {
  rows: BdlPlayerPropRow[];
  observation: ProviderObservation;
};

export async function fetchPlayerPropsForGame(
  apiKey: string,
  bdlGameId: number,
  options: {
    limiter?: Omit<FetchBdlLiveOptions, 'fetchImpl' | 'worker'>;
    baseFetch?: typeof fetch;
    now?: () => Date;
  } = {}
): Promise<PlayerPropsFetchResult> {
  const url = new URL(`${BDL_BASE}/odds/player_props`);
  url.searchParams.set('game_id', String(bdlGameId));
  const recorder = createAttemptRecorder(options.baseFetch ?? globalThis.fetch, options.now);
  const res = await fetchBdlLive(
    url.toString(),
    { headers: { Authorization: apiKey } },
    { ...options.limiter, fetchImpl: recorder.fetchImpl, worker: 'player-props-worker' }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BDL /odds/player_props ${res.status}: ${body}`);
  }
  const observation = recorder.observation();
  const json = await res.json();
  return { rows: BdlPlayerPropsResponseSchema.parse(json).data, observation };
}
