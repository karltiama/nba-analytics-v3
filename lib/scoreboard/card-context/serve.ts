/**
 * GET /api/scoreboard/context. Auth stays in the route. This module only checks the
 * serving flag, the date, and the two reads. A failed analytics read does not 500:
 * each known scoreboard game comes back unavailable.
 */

import type { StoredScoreboardGame } from '@/lib/scoreboard/contract';
import { isScoreboardCardContextEnabled } from '@/lib/scoreboard/flags';
import { CARD_CONTEXT_SCHEMA_VERSION, loadCardContext, type Sql } from './load';

export const CARD_CONTEXT_CACHE_CONTROL = 'private, max-age=60';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type CardContextHttpResult = {
  status: number;
  body: unknown;
  headers: Record<string, string>;
};

function isCalendarDate(date: string): boolean {
  if (!YMD.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

export async function serveCardContext(input: {
  env: Record<string, string | undefined>;
  params: URLSearchParams;
  now: Date;
  loadGames: (date: string) => Promise<StoredScoreboardGame[]>;
  query: Sql;
}): Promise<CardContextHttpResult> {
  const noStore = { 'Cache-Control': 'no-store' };
  if (!isScoreboardCardContextEnabled(input.env)) {
    return { status: 503, body: { error: 'card_context_disabled' }, headers: noStore };
  }
  const date = input.params.get('date');
  if (date == null || !isCalendarDate(date)) {
    return { status: 400, body: { error: 'invalid_date' }, headers: noStore };
  }

  const generatedAt = input.now.toISOString();
  const headers = { 'Cache-Control': CARD_CONTEXT_CACHE_CONTROL };
  try {
    const games = await input.loadGames(date);
    const byId = await loadCardContext({ games, query: input.query, now: input.now, env: input.env });
    return {
      status: 200,
      headers,
      body: {
        schema_version: CARD_CONTEXT_SCHEMA_VERSION,
        date,
        generated_at: generatedAt,
        games: byId,
      },
    };
  } catch {
    return {
      status: 200,
      headers,
      body: {
        schema_version: CARD_CONTEXT_SCHEMA_VERSION,
        date,
        generated_at: generatedAt,
        games: {},
        error: 'scoreboard_store_unavailable',
      },
    };
  }
}
