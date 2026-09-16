import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { loadWowyPairSummary } from '@/lib/wowy/queries';
import { parseWowyPairQuery } from '@/lib/wowy/parse-query';
import { WOWY_CACHE_REVALIDATE_SECONDS, wowyCacheKey } from '@/lib/wowy/cache';

/**
 * GET /api/wowy/pair
 * Bounded historical game-level WOWY for one subject/teammate/team/season.
 */
export async function GET(request: NextRequest) {
  const parsed = parseWowyPairQuery(request.nextUrl.searchParams);
  if (!parsed.ok) {
    const status = parsed.code === 'same_player' ? 422 : 400;
    return NextResponse.json({ error: parsed.error, code: parsed.code ?? 'invalid_query' }, { status });
  }

  try {
    const key = wowyCacheKey(parsed.query);
    const result = await unstable_cache(
      async () => loadWowyPairSummary(parsed.query),
      [key],
      { revalidate: WOWY_CACHE_REVALIDATE_SECONDS }
    )();

    if (!result.ok) {
      const status = result.code === 'not_found' ? 404 : 422;
      return NextResponse.json({ error: result.error, code: result.code }, { status });
    }
    return NextResponse.json({ summary: result.summary });
  } catch (error) {
    console.error('[api/wowy/pair]', error);
    return NextResponse.json({ error: 'Failed to load WOWY pair.' }, { status: 500 });
  }
}
