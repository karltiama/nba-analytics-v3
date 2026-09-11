import { BdlRateLimitError, fetchBdlLive, shouldSkipLiveBdlHttp } from '@/lib/balldontlie/live-rate-limit';
import { LINEUPS_PATH, BDL_LINEUPS_BASE } from '@/lib/balldontlie/lineups';
import type { ProviderFetchResult } from './worker';

/** One GET /nba/v1/lineups?game_ids[]= per game. GOAT. Uses fetchBdlLive. */
export async function fetchBdlLineupsForGame(
  gameId: string,
  apiKey: string
): Promise<ProviderFetchResult> {
  if (shouldSkipLiveBdlHttp()) {
    return { httpStatus: null, payload: null, pages: 0 };
  }
  const url = new URL(LINEUPS_PATH, BDL_LINEUPS_BASE);
  url.searchParams.set('game_ids[]', gameId);
  try {
    const res = await fetchBdlLive(
      url.toString(),
      { method: 'GET', headers: { Authorization: apiKey } },
      { worker: 'postgame-starters' }
    );
    if (!res.ok) return { httpStatus: res.status, payload: null, pages: 1 };
    const payload = await res.json();
    return { httpStatus: res.status, payload, pages: 1 };
  } catch (err) {
    if (err instanceof BdlRateLimitError) {
      if (err.code === 'timeout') return { httpStatus: 0, payload: null, pages: 0 };
      return { httpStatus: 429, payload: null, pages: 0 };
    }
    return { httpStatus: 0, payload: null, pages: 0 };
  }
}
