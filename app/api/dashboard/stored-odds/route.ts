import { NextResponse } from 'next/server';
import { STORED_ODDS_CACHE_CONTROL, STORED_ODDS_DATE, storedOddsFailureLog, storedOddsResponseBody } from '@/lib/dashboard/stored-odds';
import { loadStoredOdds } from '@/lib/dashboard/stored-odds-db';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': STORED_ODDS_CACHE_CONTROL };

/**
 * One Eastern date of stored DraftKings quotes for games that have not tipped.
 * asOf is the time of this read. storedAt on each quote is the row's last write.
 * Same read contract as the opening-night preview: the dashboard page is session-gated,
 * and this current single-book quote is part of that Free dashboard, not line shopping.
 */
export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get('date') ?? '';
  if (!STORED_ODDS_DATE.test(date)) {
    return NextResponse.json({ error: 'invalid_date' }, { status: 400, headers: NO_STORE });
  }
  try {
    const games = await query<{ game_id: string }>(
      `SELECT g.game_id::text AS game_id
       FROM analytics.games g
       WHERE (g.start_time AT TIME ZONE 'America/New_York')::date = $1::date
         AND g.start_time > now()`,
      [date]
    );
    const asOf = new Date();
    const collected = await loadStoredOdds(
      games.map((row) => row.game_id),
      asOf
    );
    return NextResponse.json(storedOddsResponseBody(asOf, collected), { headers: NO_STORE });
  } catch (err) {
    console.error('dashboard stored odds query failed', storedOddsFailureLog(err));
    return NextResponse.json({ error: 'stored_odds_unavailable' }, { status: 503, headers: NO_STORE });
  }
}
