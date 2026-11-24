import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { requireBettingAuth, getPlayerPropsForExplorer, websiteCurrentBoardStore } = vi.hoisted(() => ({
  requireBettingAuth: vi.fn(),
  getPlayerPropsForExplorer: vi.fn(),
  websiteCurrentBoardStore: vi.fn(),
}));

vi.mock('@/lib/auth/require-betting-auth', () => ({
  requireBettingAuth: (...args: unknown[]) => requireBettingAuth(...args),
}));

vi.mock('@/lib/betting/props-explorer-serving', () => ({
  PROPS_EXPLORER_MAX_LIMIT: 200,
  getPlayerPropsForExplorer: (...args: unknown[]) => getPlayerPropsForExplorer(...args),
}));

vi.mock('@/lib/props/s3-current-board/website-store', () => ({
  websiteCurrentBoardStore: () => websiteCurrentBoardStore(),
}));

vi.mock('@/lib/betting/ai-briefing-eligibility', () => ({
  isIngestionFrozen: () => false,
}));

import { GET } from '@/app/api/betting/props-explorer/route';

function authed() {
  return {
    ok: true as const,
    auth: { userId: '11111111-1111-1111-1111-111111111111', email: 'a@example.com', accessToken: 't' },
    withAuthCookies: (response: NextResponse) => response,
  };
}

describe('GET /api/betting/props-explorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireBettingAuth.mockResolvedValue(authed());
    websiteCurrentBoardStore.mockReturnValue(null);
    getPlayerPropsForExplorer.mockResolvedValue({
      rows: [],
      totalMatching: 0,
      evSelectedTrack: 's3',
      calibrationVersion: null,
      evFetchCap: null,
      sort: 'snapshot_at',
      marketContext: 'live',
      sourceTable: 's3.player_prop_current',
      lineLabel: 'Latest observed line',
      dateEt: '2026-11-23',
      selectedGame: null,
      priceScope: 'market',
    });
  });

  it('does not store an authenticated response', async () => {
    const response = await GET(new NextRequest('http://localhost/api/betting/props-explorer?game_id=501'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(getPlayerPropsForExplorer).toHaveBeenCalledOnce();
  });

  it('does not store an authentication failure or a server error', async () => {
    const denied = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    requireBettingAuth.mockResolvedValue({ ok: false, response: denied });
    const unauthorized = await GET(new NextRequest('http://localhost/api/betting/props-explorer'));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('Cache-Control')).toBe('no-store');
    expect(getPlayerPropsForExplorer).not.toHaveBeenCalled();

    requireBettingAuth.mockResolvedValue(authed());
    getPlayerPropsForExplorer.mockRejectedValue(new Error('reader failed'));
    const failed = await GET(new NextRequest('http://localhost/api/betting/props-explorer'));
    expect(failed.status).toBe(500);
    expect(failed.headers.get('Cache-Control')).toBe('no-store');
  });
});
