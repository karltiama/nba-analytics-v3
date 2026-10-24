/**
 * GET /api/scoreboard handler logic. Reads the display store only; never calls BDL.
 * Serving is gated by SCOREBOARD_SERVING_ENABLED (only '1' serves). The optional per-game `market`
 * is gated separately by SCOREBOARD_MARKETS_SERVING_ENABLED (only '1' attaches markets).
 */

import { etYmd } from '@/lib/games/status-sync-query';
import {
  expectedSeasonTypes,
  scoreboardDateCoverage,
  type ScoreboardCoverage,
} from './coverage';
import {
  isScoreboardSeasonType,
  type ScoreboardResponse,
  type ScoreboardSeasonType,
  type StoredOddsQuote,
} from './contract';
import { isScoreboardMarketServingEnabled, isScoreboardServingEnabled } from './flags';
import { buildScoreboardResponse } from './response';
import type { ScoreboardStore } from './store';

/** Local only. `contract.ts` stays unchanged; older clients ignore this field. */
type ScoreboardResponseWithCoverage = ScoreboardResponse & { coverage?: ScoreboardCoverage };

const UNKNOWN_COVERAGE: ScoreboardCoverage = { state: 'unknown', last_games_request_at: null };

/** Clock reads never fail the games response. A throw, or no calendar, becomes unknown. */
async function coverageFor(store: ScoreboardStore, date: string, now: Date): Promise<ScoreboardCoverage> {
  try {
    const types = expectedSeasonTypes(date);
    const lastRequestBySeasonType: Partial<Record<ScoreboardSeasonType, string | null>> = {};
    if (types) {
      for (const seasonType of types) {
        lastRequestBySeasonType[seasonType] = await store.loadLastGamesRequestAt(seasonType);
      }
    }
    return scoreboardDateCoverage({ date, now, lastRequestBySeasonType });
  } catch {
    return UNKNOWN_COVERAGE;
  }
}

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
    // Quotes are optional: markets off, an odds read failure, or an unapplied odds migration keeps the games.
    let odds: StoredOddsQuote[] | undefined;
    const pregameIds = games.filter((g) => g.lifecycle === 'scheduled').map((g) => g.gameId);
    if (isScoreboardMarketServingEnabled(input.env)) {
      try {
        odds = pregameIds.length > 0 ? await store.loadCurrentOdds(pregameIds) : [];
      } catch {
        odds = undefined;
      }
    }
    const coverage = await coverageFor(store, date, input.now);
    const body: ScoreboardResponseWithCoverage = {
      ...buildScoreboardResponse({ date, now: input.now, games, lines, odds }),
      coverage,
    };
    return {
      status: 200,
      body,
      headers: { 'Cache-Control': SCOREBOARD_CACHE_CONTROL },
    };
  } catch {
    return { status: 503, body: { error: 'scoreboard_store_unavailable' }, headers: noStore };
  }
}
