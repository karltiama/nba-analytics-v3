import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { query } from '@/lib/db';
import { loadResearchSlate } from '@/lib/quick-builds/research-snapshot';
import { QuickBuildInputError } from '@/lib/quick-builds/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/parlay-workspace/quick-builds/games
 *
 * Today's eligible ET slate for the Quick Builds selector. Read-only.
 * Does not load prop observations or call a sportsbook.
 */

function noStore(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) {
    gate.response.headers.set('Cache-Control', 'no-store');
    return gate.response;
  }

  try {
    const slate = await loadResearchSlate({ now: new Date(), query });
    return gate.withAuthCookies(noStore(slate, 200));
  } catch (error: unknown) {
    if (error instanceof QuickBuildInputError && error.code === 'LIMIT_EXCEEDED') {
      return gate.withAuthCookies(
        noStore({ error: 'Eligible data exceeds the quick-build limit', code: 'LIMIT_EXCEEDED' }, 422)
      );
    }
    console.error('[quick-builds] slate failed');
    return gate.withAuthCookies(noStore({ error: 'Quick builds unavailable' }, 500));
  }
}
