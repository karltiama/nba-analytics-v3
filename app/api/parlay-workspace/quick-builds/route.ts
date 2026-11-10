import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { query } from '@/lib/db';
import { canonicalizeSportsbook } from '@/lib/parlay-xray/resolution/sportsbook';
import { loadResearchQuickBuilds } from '@/lib/quick-builds/research-snapshot';
import { QUICK_BUILD_PRESETS, QuickBuildInputError, type QuickBuildPresetName } from '@/lib/quick-builds/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/parlay-workspace/quick-builds?sportsbook=&preset=
 *
 * Research snapshot only. Reads the latest complete pregame pull and runs the
 * Quick Builds engine. Does not call a provider, write, or refresh ingestion.
 * The response is not a live betting board.
 */

function isPreset(value: string | null): value is QuickBuildPresetName {
  return value != null && Object.prototype.hasOwnProperty.call(QUICK_BUILD_PRESETS, value);
}

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

  const sportsbook = request.nextUrl.searchParams.get('sportsbook')?.trim() ?? '';
  const presetRaw = request.nextUrl.searchParams.get('preset')?.trim() ?? '';
  if (!canonicalizeSportsbook(sportsbook)) {
    return gate.withAuthCookies(noStore({ error: 'Invalid sportsbook' }, 400));
  }
  if (!isPreset(presetRaw)) {
    return gate.withAuthCookies(noStore({ error: 'Invalid preset' }, 400));
  }

  try {
    const result = await loadResearchQuickBuilds({
      sportsbook,
      preset: presetRaw,
      now: new Date(),
      query,
    });
    return gate.withAuthCookies(noStore(result, 200));
  } catch (error: unknown) {
    if (error instanceof QuickBuildInputError && error.code === 'LIMIT_EXCEEDED') {
      return gate.withAuthCookies(
        noStore({ error: 'Eligible data exceeds the quick-build limit', code: 'LIMIT_EXCEEDED' }, 422)
      );
    }
    console.error('[quick-builds] request failed');
    return gate.withAuthCookies(noStore({ error: 'Quick builds unavailable' }, 500));
  }
}
