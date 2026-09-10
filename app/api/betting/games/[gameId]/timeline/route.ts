/**
 * GET /api/betting/games/[gameId]/timeline
 * Lazy Historical Timeline v1. Auth required. Events are normalized; no raw Plays JSON.
 * Immutable 2025 objects are cached per game_id via Next unstable_cache.
 */
import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { toHistoricalTimelinePayload } from '@/lib/betting/historical-timeline-format';
import { getHistoricalGameTimeline } from '@/lib/betting/historical-timeline-server';

export const HISTORICAL_TIMELINE_CACHE_KEY = 'historical-timeline-v1';

function loadCachedTimeline(gameId: string) {
  return unstable_cache(
    async () => getHistoricalGameTimeline(gameId),
    [HISTORICAL_TIMELINE_CACHE_KEY, gameId],
    { revalidate: false }
  )();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;

  const { gameId } = await params;
  if (!gameId?.trim()) {
    return NextResponse.json({ error: 'Missing gameId' }, { status: 400 });
  }

  try {
    const timeline = await loadCachedTimeline(gameId.trim());
    const payload = toHistoricalTimelinePayload(timeline);
    return gate.withAuthCookies(NextResponse.json(payload));
  } catch (error: unknown) {
    console.error('[historical-timeline] read failed', error);
    return gate.withAuthCookies(
      NextResponse.json(
        {
          available: false,
          error: 'TIMELINE_UNAVAILABLE',
          events: [],
          keyEvents: [],
        },
        { status: 200 }
      )
    );
  }
}
