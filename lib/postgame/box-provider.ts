import { BdlRateLimitError, fetchBdlLive, shouldSkipLiveBdlHttp } from '@/lib/balldontlie/live-rate-limit';
import type { ProviderFetchResult } from './worker';

const STATS_PATH = 'https://api.balldontlie.io/v1/stats';

/**
 * Game-scoped BDL box. Uses game_ids[] + cursor (same shape as nightly).
 * Must go through fetchBdlLive. No independent limiter.
 */
export async function fetchBdlBoxStatsForGame(
  gameId: string,
  apiKey: string
): Promise<ProviderFetchResult> {
  if (shouldSkipLiveBdlHttp()) {
    return { httpStatus: null, payload: null, pages: 0 };
  }
  const all: unknown[] = [];
  let cursor: number | null = null;
  let pages = 0;
  let lastStatus = 200;
  while (pages < 8) {
    const url = new URL(STATS_PATH);
    url.searchParams.append('game_ids[]', gameId);
    url.searchParams.set('per_page', '100');
    if (cursor != null) url.searchParams.set('cursor', String(cursor));
    let res: Response;
    try {
      res = await fetchBdlLive(
        url.toString(),
        { method: 'GET', headers: { Authorization: apiKey } },
        { worker: 'postgame-box' }
      );
    } catch (err) {
      if (err instanceof BdlRateLimitError) {
        if (err.code === 'timeout') return { httpStatus: 0, payload: null, pages };
        return { httpStatus: 429, payload: null, pages };
      }
      return { httpStatus: 0, payload: null, pages };
    }
    lastStatus = res.status;
    if (!res.ok) return { httpStatus: res.status, payload: null, pages: pages + 1 };
    const json = (await res.json()) as { data?: unknown[]; meta?: { next_cursor?: number | null } };
    pages += 1;
    all.push(...(json.data ?? []));
    cursor = json.meta?.next_cursor ?? null;
    if (cursor == null) break;
  }
  return { httpStatus: lastStatus, payload: { data: all }, pages };
}
