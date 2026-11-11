import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { query } from '@/lib/db';
import { canonicalizeSportsbook } from '@/lib/parlay-xray/resolution/sportsbook';
import { loadResearchQuickBuilds, parseSelectedGameIds } from '@/lib/quick-builds/research-snapshot';
import {
  QUICK_BUILD_FIVE_LEG_PRESETS,
  QUICK_BUILD_FOUR_LEG_PRESETS,
  QUICK_BUILD_PRESETS,
  QUICK_BUILD_THREE_LEG_PRESETS,
  QuickBuildInputError,
  type QuickBuildFiveLegPresetName,
  type QuickBuildFourLegPresetName,
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

type RequestLegCount = 2 | 3 | 4 | 5;
type RequestPreset = QuickBuildPresetName | QuickBuildThreeLegPresetName | QuickBuildFourLegPresetName | QuickBuildFiveLegPresetName;

function parseLegCount(raw: string | null): RequestLegCount | null {
  if (raw == null || raw.trim() === '') return 2;
  if (raw === '2') return 2;
  if (raw === '3') return 3;
  if (raw === '4') return 4;
  if (raw === '5') return 5;
  return null;
}

/**
 * Five-leg search is implemented and measured, but the November fixtures showed
 * player repetition the approved shortlist bar does not accept. The route stays
 * closed so the mode is not exposed.
 */
export const QUICK_BUILD_FIVE_LEG_AVAILABLE = false;

function presetTable(legCount: RequestLegCount): Record<string, unknown> {
  if (legCount === 5) return QUICK_BUILD_FIVE_LEG_PRESETS;
  if (legCount === 4) return QUICK_BUILD_FOUR_LEG_PRESETS;
  if (legCount === 3) return QUICK_BUILD_THREE_LEG_PRESETS;
  return QUICK_BUILD_PRESETS;
}

function defaultPreset(legCount: RequestLegCount): RequestPreset {
  if (legCount === 5) return 'five_middle';
  if (legCount === 4) return 'four_middle';
  if (legCount === 3) return 'midrange';
  return 'balanced';
}

function presetFor(legCount: RequestLegCount, raw: string): RequestPreset | null {
  const value = raw === '' ? defaultPreset(legCount) : raw;
  return Object.prototype.hasOwnProperty.call(presetTable(legCount), value) ? (value as RequestPreset) : null;
}

function presetBelongsToAnotherLegCount(legCount: RequestLegCount, raw: string): boolean {
  const counts: RequestLegCount[] = [2, 3, 4, 5];
  return counts.some((count) => count !== legCount && Object.prototype.hasOwnProperty.call(presetTable(count), raw));
}

function minimumGames(legCount: RequestLegCount): number {
  return legCount;
}

function gameSelectionError(code: string): string {
  if (code === 'LIMIT_EXCEEDED') return 'Eligible data exceeds the quick-build limit';
  if (code === 'NEED_FIVE_GAMES') return 'Select at least five games.';
  if (code === 'NEED_FOUR_GAMES') return 'Select at least four games.';
  if (code === 'NEED_THREE_GAMES') return 'Select at least three games.';
  if (code === 'NEED_TWO_GAMES') return 'Select at least two games.';
  return 'Invalid game selection.';
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
  if (legCount === 5 && !QUICK_BUILD_FIVE_LEG_AVAILABLE) {
    return gate.withAuthCookies(noStore({
      error: 'Five-leg Quick Builds are not available.',
      code: 'FIVE_LEG_UNAVAILABLE',
    }, 400));
  }
  if (preset == null) {
    const rawPreset = request.nextUrl.searchParams.get('preset')?.trim() ?? '';
    if (rawPreset !== '' && presetBelongsToAnotherLegCount(legCount, rawPreset)) {
      return gate.withAuthCookies(noStore({ error: 'Preset does not match the leg count.', code: 'INVALID_PRESET' }, 400));
    }
    return gate.withAuthCookies(noStore({ error: 'Invalid preset' }, 400));
  }
  const gamesRaw = request.nextUrl.searchParams.get('games');
  let gameIds: string[] | undefined;
  if (gamesRaw != null) {
    const parsed = parseSelectedGameIds(gamesRaw, minimumGames(legCount));
    if (!parsed.ok) {
      return gate.withAuthCookies(noStore({ error: gameSelectionError(parsed.code), code: parsed.code }, parsed.status));
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
    if (error instanceof QuickBuildInputError && error.code === 'NEED_FOUR_GAMES') {
      return gate.withAuthCookies(noStore({ error: 'Select at least four games.', code: 'NEED_FOUR_GAMES' }, 400));
    }
    if (error instanceof QuickBuildInputError && error.code === 'NEED_FIVE_GAMES') {
      return gate.withAuthCookies(noStore({ error: 'Select at least five games.', code: 'NEED_FIVE_GAMES' }, 400));
    }
    console.error('[quick-builds] request failed');
    return gate.withAuthCookies(noStore({ error: 'Quick builds unavailable' }, 500));
  }
}
