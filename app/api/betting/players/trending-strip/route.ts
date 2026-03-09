import { NextRequest, NextResponse } from 'next/server';
import { getTrendingPlayersStrip, type TrendingStat } from '@/lib/betting/queries';

const VALID_STATS = new Set<TrendingStat>(['pts', 'reb', 'ast', '3pm', 'pra']);

/**
 * GET /api/betting/players/trending-strip
 *
 * Returns compact trending player data for the horizontal strip.
 *
 * Query params:
 *   - stat:  'pts' | 'reb' | 'ast' | '3pm' | 'pra' (default 'pts')
 *   - limit: number (default 15)
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const rawStat = params.get('stat') || 'pts';
    const stat: TrendingStat = VALID_STATS.has(rawStat as TrendingStat)
      ? (rawStat as TrendingStat)
      : 'pts';
    const limit = Math.min(Math.max(parseInt(params.get('limit') || '15', 10) || 15, 1), 30);

    const players = await getTrendingPlayersStrip(stat, limit);

    return NextResponse.json({ players, stat });
  } catch (error: any) {
    console.error('Error fetching trending strip:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch trending strip' },
      { status: 500 },
    );
  }
}
