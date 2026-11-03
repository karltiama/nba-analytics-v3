import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { getTrendingPlayersStrip, getTrendingStripThrough, type TrendingStat } from '@/lib/betting/queries';
import { trendingStripFreshness } from '@/lib/betting/trending-strip-freshness';

const VALID_STATS = new Set<TrendingStat>(['pts', 'reb', 'ast', '3pm', 'pra']);

/**
 * GET /api/betting/players/trending-strip
 *
 * Returns compact trending player data for the horizontal strip.
 * Auth required (private betting API). Landing page uses static demo data instead.
 *
 * Query params:
 *   - stat:  'pts' | 'reb' | 'ast' | '3pm' | 'pra' (default 'pts')
 *   - limit: number (default 15)
 *
 * Response: { players, stat, through, stale }. `through` is the newest stored game date for
 * the analytics season. When it is older than the freshness cutoff the strip is stale and
 * `players` is empty; otherwise players whose last game is older than the cutoff are left out.
 */
export async function GET(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;

  try {
    const params = request.nextUrl.searchParams;
    const rawStat = params.get('stat') || 'pts';
    const stat: TrendingStat = VALID_STATS.has(rawStat as TrendingStat)
      ? (rawStat as TrendingStat)
      : 'pts';
    const limit = Math.min(Math.max(parseInt(params.get('limit') || '15', 10) || 15, 1), 30);

    const freshness = trendingStripFreshness(await getTrendingStripThrough(), new Date());
    const players = freshness.stale ? [] : await getTrendingPlayersStrip(stat, limit, freshness.cutoff);

    return NextResponse.json({ players, stat, through: freshness.through, stale: freshness.stale });
  } catch (error: any) {
    console.error('Error fetching trending strip:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch trending strip' },
      { status: 500 },
    );
  }
}
