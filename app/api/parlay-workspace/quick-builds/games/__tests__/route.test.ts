import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { requireBettingAuth, loadResearchSlate, query } = vi.hoisted(() => ({
  requireBettingAuth: vi.fn(),
  loadResearchSlate: vi.fn(),
  query: vi.fn(),
}));

vi.mock('@/lib/auth/require-betting-auth', () => ({
  requireBettingAuth: (...args: unknown[]) => requireBettingAuth(...args),
}));

vi.mock('@/lib/db', () => ({
  query: (...args: unknown[]) => query(...args),
  default: {},
}));

vi.mock('@/lib/quick-builds/research-snapshot', () => ({
  loadResearchSlate: (...args: unknown[]) => loadResearchSlate(...args),
}));

import { GET } from '@/app/api/parlay-workspace/quick-builds/games/route';

function authed() {
  return {
    ok: true as const,
    auth: { userId: '11111111-1111-1111-1111-111111111111', email: 'a@example.com', accessToken: 't' },
    withAuthCookies: (response: NextResponse) => response,
  };
}

describe('GET /api/parlay-workspace/quick-builds/games', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireBettingAuth.mockResolvedValue(authed());
  });

  it('rejects an unauthenticated request before reading the slate', async () => {
    const denied = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    requireBettingAuth.mockResolvedValue({ ok: false, response: denied });
    const response = await GET(new NextRequest('http://localhost/api/parlay-workspace/quick-builds/games'));
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(loadResearchSlate).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('returns the eligible slate without accepting a client clock', async () => {
    loadResearchSlate.mockResolvedValue({
      asOf: '2026-11-09T18:00:00.000Z',
      games: [{ gameId: '101', startTime: '2026-11-10T00:00:00.000Z', awayAbbreviation: 'LAL', homeAbbreviation: 'DEN', label: 'LAL @ DEN' }],
    });
    const response = await GET(new NextRequest('http://localhost/api/parlay-workspace/quick-builds/games?asOf=2000-01-01T00:00:00.000Z'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ games: [{ gameId: '101', label: 'LAL @ DEN' }] });
    const args = loadResearchSlate.mock.calls[0]?.[0] as { now: Date };
    expect(args.now.toISOString()).not.toBe('2000-01-01T00:00:00.000Z');
    expect(query).not.toHaveBeenCalled();
  });
});
