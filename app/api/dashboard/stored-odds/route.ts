import { NextResponse } from 'next/server';
import { STORED_ODDS_DATE, storedOddsFailureLog } from '@/lib/dashboard/stored-odds';
import { loadStoredOdds } from '@/lib/dashboard/stored-odds-db';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * One Eastern date of stored DraftKings quotes for games that have not tipped.
 * Same read contract as the opening-night preview: the dashboard page is session-gated,
 * and this current single-book quote is part of that Free dashboard, not line shopping.
 */
export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get('date') ?? '';
  if (!STORED_ODDS_DATE.test(date)) {
    return NextResponse.json({ error: 'invalid_date' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const games = await query<{ game_id: string }>(
      `SELECT g.game_id::text AS game_id
       FROM analytics.games g
       WHERE (g.start_time AT TIME ZONE 'America/New_York')::date = $1::date
         AND g.start_time > now()`,
      [date]
    );
    const odds = await loadStoredOdds(games.map((row) => row.game_id), new Date());
    return NextResponse.json({ odds }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('dashboard stored odds query failed', storedOddsFailureLog(err));
    return NextResponse.json({ error: 'stored_odds_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
