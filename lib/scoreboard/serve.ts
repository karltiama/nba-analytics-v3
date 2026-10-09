/**
 * GET /api/scoreboard handler logic. Reads the display store only; never calls BDL.
 * Serving is gated by SCOREBOARD_SERVING_ENABLED (only '1' serves).
 */

import { etYmd } from '@/lib/games/status-sync-query';
import { isScoreboardSeasonType, type ScoreboardSeasonType } from './contract';
import { isScoreboardServingEnabled } from './flags';
import { buildScoreboardResponse } from './response';
import type { ScoreboardStore } from './store';

const ALLOWED_PARAMS = new Set(['date', 'season_type']);
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Shared CDN/server cache: one origin read per 15 s per URL, however many visitors poll. */
export const SCOREBOARD_CACHE_CONTROL = 'public, s-maxage=15, stale-while-revalidate=15';

export type ScoreboardHttpResult = { status: number; body: unknown; headers: Record<string, string> };

export async function serveScoreboard(input: {
  env: Record<string, string | undefined>;
  params: URLSearchParams;
  now: Date;
  store: () => ScoreboardStore;
}): Promise<ScoreboardHttpResult> {
  const noStore = { 'Cache-Control': 'no-store' };
  const serving = isScoreboardServingEnabled(input.env);
  if (!serving.enabled) {
    return { status: 503, body: { error: 'scoreboard_unavailable', reason: serving.reason }, headers: noStore };
  }
  for (const key of input.params.keys()) {
    if (!ALLOWED_PARAMS.has(key)) {
      return { status: 400, body: { error: 'unknown_parameter', parameter: key }, headers: noStore };
    }
  }
  const date = input.params.get('date') ?? etYmd(input.now);
  if (!YMD.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return { status: 400, body: { error: 'invalid_date' }, headers: noStore };
  }
  const rawType = input.params.get('season_type');
  let seasonType: ScoreboardSeasonType | undefined;
  if (rawType != null) {
    if (!isScoreboardSeasonType(rawType)) {
      return { status: 400, body: { error: 'invalid_season_type' }, headers: noStore };
    }
    seasonType = rawType;
  }
  try {
    const store = input.store();
    const games = await store.loadGamesForDate(date, seasonType);
    const lines = await store.loadPlayerLines(games.map((g) => g.gameId));
    return {
      status: 200,
      body: buildScoreboardResponse({ date, now: input.now, games, lines }),
      headers: { 'Cache-Control': SCOREBOARD_CACHE_CONTROL },
    };
  } catch {
    return { status: 503, body: { error: 'scoreboard_store_unavailable' }, headers: noStore };
  }
}
