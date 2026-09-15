import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { loadWowyModelPair } from '@/lib/wowy/queries';
import { parseWowyPairQuery } from '@/lib/wowy/parse-query';
import { WOWY_CACHE_REVALIDATE_SECONDS, wowyCacheKey } from '@/lib/wowy/cache';
import { WOWY_SCENARIO_UNKNOWN } from '@/lib/wowy/model-adapter';

/**
 * GET /api/wowy/model-pair
 *
 * Historically safe adapter for future model research.
 * Requires cutoffStartTime. Never infers a with/without scenario from the
 * target box. Scenario stays unknown unless the caller supplies one later.
 *
 * Do not feed this into frozen PTS C / REB C models in this slice.
 */
export async function GET(request: NextRequest) {
  const parsed = parseWowyPairQuery(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  if (!parsed.query.cutoffStartTime) {
    return NextResponse.json(
      { error: 'cutoffStartTime is required for the model adapter.' },
      { status: 400 }
    );
  }

  try {
    const key = `model|${wowyCacheKey(parsed.query)}`;
    const result = await unstable_cache(
      async () =>
        loadWowyModelPair({
          query: parsed.query,
          scenario: WOWY_SCENARIO_UNKNOWN,
        }),
      [key],
      { revalidate: WOWY_CACHE_REVALIDATE_SECONDS }
    )();

    if (!result.ok) {
      const status = result.code === 'not_found' ? 404 : 422;
      return NextResponse.json({ error: result.error, code: result.code }, { status });
    }
    return NextResponse.json({ result: result.result });
  } catch (error) {
    console.error('[api/wowy/model-pair]', error);
    return NextResponse.json({ error: 'Failed to load WOWY model pair.' }, { status: 500 });
  }
}
