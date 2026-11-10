import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { QUICK_BUILD_PRICE_NOTICE, QuickBuildInputError } from '@/lib/quick-builds/types';

const { requireBettingAuth, loadResearchQuickBuilds, query } = vi.hoisted(() => ({
  requireBettingAuth: vi.fn(),
  loadResearchQuickBuilds: vi.fn(),
  query: vi.fn(),
}));

vi.mock('@/lib/auth/require-betting-auth', () => ({
  requireBettingAuth: (...args: unknown[]) => requireBettingAuth(...args),
}));

vi.mock('@/lib/db', () => ({
  query: (...args: unknown[]) => query(...args),
  default: {},
}));

vi.mock('@/lib/quick-builds/research-snapshot', async () => {
  const actual = await vi.importActual<typeof import('@/lib/quick-builds/research-snapshot')>(
    '@/lib/quick-builds/research-snapshot',
  );
  return {
    ...actual,
    loadResearchQuickBuilds: (...args: unknown[]) => loadResearchQuickBuilds(...args),
  };
});

import { GET } from '@/app/api/parlay-workspace/quick-builds/route';

function authed() {
  return {
    ok: true as const,
    auth: { userId: '11111111-1111-1111-1111-111111111111', email: 'a@example.com', accessToken: 't' },
    withAuthCookies: (response: NextResponse) => response,
  };
}

function ask(queryString: string): NextRequest {
  return new NextRequest(`http://localhost/api/parlay-workspace/quick-builds?${queryString}`);
}

describe('GET /api/parlay-workspace/quick-builds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireBettingAuth.mockResolvedValue(authed());
  });

  it('rejects an unauthenticated request', async () => {
    const denied = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    requireBettingAuth.mockResolvedValue({ ok: false, response: denied });
    const response = await GET(ask('sportsbook=draftkings&preset=balanced'));
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(loadResearchQuickBuilds).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects an unsupported sportsbook and an unknown preset', async () => {
    const book = await GET(ask('sportsbook=bet365&preset=balanced'));
    expect(book.status).toBe(400);
    expect(await book.json()).toEqual({ error: 'Invalid sportsbook' });
    expect(book.headers.get('Cache-Control')).toBe('no-store');

    const preset = await GET(ask('sportsbook=draftkings&preset=safe_bet'));
    expect(preset.status).toBe(400);
    expect(await preset.json()).toEqual({ error: 'Invalid preset' });
    expect(loadResearchQuickBuilds).not.toHaveBeenCalled();
  });

  it('returns the research snapshot, its timestamps, and the calculated-price notice', async () => {
    loadResearchQuickBuilds.mockResolvedValue({
      status: 'ok',
      emptyReason: null,
      sportsbook: 'draftkings',
      range: { minAmerican: 125, maxAmerican: 200 },
      policy: { mode: 'research_snapshot', asOf: '2026-11-09T18:00:00.000Z' },
      priceNotice: QUICK_BUILD_PRICE_NOTICE,
      games: [],
      builds: [
        {
          id: 'a',
          combinedAmerican: 125,
          breakEvenProbability: 0.44,
          distanceToMidpoint: 37.5,
          oldestObservedAt: '2026-11-09T17:00:00.000Z',
          newestObservedAt: '2026-11-09T17:00:00.000Z',
          maxAgeMs: 3_600_000,
          legs: [
            {
              playerId: '11',
              gameId: '101',
              market: 'points',
              side: 'over',
              line: 20.5,
              sportsbook: 'draftkings',
              oddsAmerican: -200,
              oppositeAmerican: -200,
              noVigProbability: 0.5,
              pullRunId: '2',
              observedAt: '2026-11-09T17:00:00.000Z',
              ageMs: 3_600_000,
            },
          ],
        },
      ],
      generatedAt: '2026-11-09T18:00:00.000Z',
      preset: 'higher_payout',
      snapshotClass: 'research_snapshot',
      limitations: ['research', QUICK_BUILD_PRICE_NOTICE],
    });
    const response = await GET(
      ask('sportsbook=draftkings&preset=higher_payout&asOf=2000-01-01T00:00:00.000Z&mode=recently_observed')
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json();
    expect(body.snapshotClass).toBe('research_snapshot');
    expect(body.builds[0].legs[0].observedAt).toBe('2026-11-09T17:00:00.000Z');
    expect(body.priceNotice).toBe(QUICK_BUILD_PRICE_NOTICE);
    expect(body.generatedAt).toBe('2026-11-09T18:00:00.000Z');
    const args = loadResearchQuickBuilds.mock.calls[0]?.[0] as { now: Date; sportsbook: string; preset: string };
    expect(args.sportsbook).toBe('draftkings');
    expect(args.preset).toBe('higher_payout');
    expect(args.now.toISOString()).not.toBe('2000-01-01T00:00:00.000Z');
    expect(query).not.toHaveBeenCalled();
  });

  it('preserves an empty engine result', async () => {
    loadResearchQuickBuilds.mockResolvedValue({
      status: 'empty',
      emptyReason: 'NO_PAIRS_IN_BAND',
      sportsbook: 'draftkings',
      range: { minAmerican: -200, maxAmerican: -110 },
      policy: { mode: 'research_snapshot', asOf: '2026-11-09T18:00:00.000Z' },
      priceNotice: QUICK_BUILD_PRICE_NOTICE,
      games: [],
      builds: [],
      generatedAt: '2026-11-09T18:00:00.000Z',
      preset: 'higher_hit_chance',
      snapshotClass: 'research_snapshot',
      limitations: ['research', QUICK_BUILD_PRICE_NOTICE],
    });
    const response = await GET(ask('sportsbook=draftkings&preset=higher_hit_chance'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'empty', emptyReason: 'NO_PAIRS_IN_BAND' });
  });

  it('returns a bounded-data error without describing it as no markets', async () => {
    loadResearchQuickBuilds.mockRejectedValue(new QuickBuildInputError('LIMIT_EXCEEDED', 'observations exceed 4000'));
    const response = await GET(ask('sportsbook=draftkings&preset=balanced'));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: 'Eligible data exceeds the quick-build limit',
      code: 'LIMIT_EXCEEDED',
    });
  });

  it('turns a malformed snapshot into a service error', async () => {
    loadResearchQuickBuilds.mockRejectedValue(
      new QuickBuildInputError('MALFORMED_INPUT', 'snapshot observed_at is invalid')
    );
    const response = await GET(ask('sportsbook=draftkings&preset=balanced'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Quick builds unavailable' });
  });

  it('passes selected game ids and omits them for All Games', async () => {
    loadResearchQuickBuilds.mockResolvedValue({
      status: 'empty',
      emptyReason: 'NO_PAIRS_IN_BAND',
      sportsbook: 'draftkings',
      range: { minAmerican: -110, maxAmerican: 125 },
      policy: { mode: 'research_snapshot', asOf: '2026-11-09T18:00:00.000Z' },
      priceNotice: QUICK_BUILD_PRICE_NOTICE,
      games: [],
      builds: [],
      generatedAt: '2026-11-09T18:00:00.000Z',
      preset: 'balanced',
      snapshotClass: 'research_snapshot',
      limitations: ['research'],
    });
    const all = await GET(ask('sportsbook=draftkings&preset=balanced'));
    expect(all.status).toBe(200);
    expect(loadResearchQuickBuilds.mock.calls[0]?.[0]).not.toHaveProperty('gameIds');

    const selected = await GET(ask('sportsbook=draftkings&preset=balanced&games=101,%20102'));
    expect(selected.status).toBe(200);
    expect(loadResearchQuickBuilds.mock.calls[1]?.[0]).toMatchObject({ gameIds: ['101', '102'] });
  });

  it('rejects a malformed, duplicate, short, or oversized game selection before loading', async () => {
    const malformed = await GET(ask('sportsbook=draftkings&preset=balanced&games=101,abc'));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ code: 'INVALID_GAME_SELECTION' });

    const duplicate = await GET(ask('sportsbook=draftkings&preset=balanced&games=101,101'));
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toMatchObject({ code: 'INVALID_GAME_SELECTION' });

    const one = await GET(ask('sportsbook=draftkings&preset=balanced&games=101'));
    expect(one.status).toBe(400);
    expect(await one.json()).toMatchObject({ code: 'NEED_TWO_GAMES' });

    const ids = Array.from({ length: 33 }, (_, index) => String(index + 1)).join(',');
    const over = await GET(ask(`sportsbook=draftkings&preset=balanced&games=${ids}`));
    expect(over.status).toBe(422);
    expect(await over.json()).toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(loadResearchQuickBuilds).not.toHaveBeenCalled();
  });

  it('does not widen an ineligible selection to All Games', async () => {
    loadResearchQuickBuilds.mockRejectedValue(new QuickBuildInputError('INELIGIBLE_GAME', 'selected game is not eligible'));
    const response = await GET(ask('sportsbook=draftkings&preset=balanced&games=101,999'));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Refresh the game selection.', code: 'INELIGIBLE_GAME' });
    expect(loadResearchQuickBuilds).toHaveBeenCalledTimes(1);
  });

  it('hides database failure details', async () => {
    loadResearchQuickBuilds.mockRejectedValue(new Error('password=secret'));
    const response = await GET(ask('sportsbook=caesars&preset=balanced'));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: 'Quick builds unavailable' });
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
