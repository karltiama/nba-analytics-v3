import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { query } from '@/lib/db';
import { canonicalizeSportsbook } from '@/lib/parlay-xray/resolution/sportsbook';
import { loadResearchQuickBuilds, parseSelectedGameIds } from '@/lib/quick-builds/research-snapshot';
import {
  QUICK_BUILD_PRESETS,
  QUICK_BUILD_THREE_LEG_PRESETS,
  QuickBuildInputError,
  type QuickBuildPresetName,
  type QuickBuildThreeLegPresetName,
} from '@/lib/quick-builds/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/parlay-workspace/quick-builds?sportsbook=&preset=&games=&legs=
 *
 * Research snapshot only. Reads the latest complete pregame pull and runs the
 * Quick Builds engine. Does not call a provider, write, or refresh ingestion.
 * The response is not a live betting board.
 */

function parseLegCount(raw: string | null): 2 | 3 | null {
  if (raw == null || raw.trim() === '') return 2;
  if (raw === '2') return 2;
  if (raw === '3') return 3;
  return null;
}

function presetFor(
  legCount: 2 | 3,
  raw: string,
): QuickBuildPresetName | QuickBuildThreeLegPresetName | null {
  const value = raw === '' ? (legCount === 3 ? 'midrange' : 'balanced') : raw;
  const table = legCount === 3 ? QUICK_BUILD_THREE_LEG_PRESETS : QUICK_BUILD_PRESETS;
  return Object.prototype.hasOwnProperty.call(table, value)
    ? (value as QuickBuildPresetName | QuickBuildThreeLegPresetName)
    : null;
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
  const legCount = parseLegCount(request.nextUrl.searchParams.get('legs'));
  const preset = legCount == null ? null : presetFor(legCount, request.nextUrl.searchParams.get('preset')?.trim() ?? '');
  if (!canonicalizeSportsbook(sportsbook)) {
    return gate.withAuthCookies(noStore({ error: 'Invalid sportsbook' }, 400));
  }
  if (legCount == null) {
    return gate.withAuthCookies(noStore({ error: 'Invalid leg count', code: 'INVALID_LEG_COUNT' }, 400));
  }
  if (preset == null) {
    const rawPreset = request.nextUrl.searchParams.get('preset')?.trim() ?? '';
    const other = legCount === 3 ? QUICK_BUILD_PRESETS : QUICK_BUILD_THREE_LEG_PRESETS;
    if (rawPreset !== '' && Object.prototype.hasOwnProperty.call(other, rawPreset)) {
      return gate.withAuthCookies(noStore({ error: 'Preset does not match the leg count.', code: 'INVALID_PRESET' }, 400));
    }
    return gate.withAuthCookies(noStore({ error: 'Invalid preset' }, 400));
  }
  const gamesRaw = request.nextUrl.searchParams.get('games');
  let gameIds: string[] | undefined;
  if (gamesRaw != null) {
    const parsed = parseSelectedGameIds(gamesRaw, legCount === 3 ? 3 : 2);
    if (!parsed.ok) {
      const error =
        parsed.code === 'LIMIT_EXCEEDED'
          ? 'Eligible data exceeds the quick-build limit'
          : parsed.code === 'NEED_THREE_GAMES'
            ? 'Select at least three games.'
            : parsed.code === 'NEED_TWO_GAMES'
              ? 'Select at least two games.'
              : 'Invalid game selection.';
      return gate.withAuthCookies(noStore({ error, code: parsed.code }, parsed.status));
    }
    gameIds = parsed.ids;
  }

  try {
    const result = await loadResearchQuickBuilds({
      sportsbook,
      preset,
      legCount,
      now: new Date(),
      query,
      ...(gameIds == null ? {} : { gameIds }),
    });
    return gate.withAuthCookies(noStore(result, 200));
  } catch (error: unknown) {
    if (error instanceof QuickBuildInputError && error.code === 'LIMIT_EXCEEDED') {
      return gate.withAuthCookies(
        noStore({ error: 'Eligible data exceeds the quick-build limit', code: 'LIMIT_EXCEEDED' }, 422)
      );
    }
    if (error instanceof QuickBuildInputError && error.code === 'INELIGIBLE_GAME') {
      return gate.withAuthCookies(noStore({ error: 'Refresh the game selection.', code: 'INELIGIBLE_GAME' }, 409));
    }
    if (error instanceof QuickBuildInputError && error.code === 'NEED_TWO_GAMES') {
      return gate.withAuthCookies(noStore({ error: 'Select at least two games.', code: 'NEED_TWO_GAMES' }, 400));
    }
    if (error instanceof QuickBuildInputError && error.code === 'NEED_THREE_GAMES') {
      return gate.withAuthCookies(noStore({ error: 'Select at least three games.', code: 'NEED_THREE_GAMES' }, 400));
    }
    console.error('[quick-builds] request failed');
    return gate.withAuthCookies(noStore({ error: 'Quick builds unavailable' }, 500));
  }
}
