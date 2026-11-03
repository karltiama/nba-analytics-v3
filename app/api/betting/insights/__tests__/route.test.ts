import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { requireBettingAuth, getTrendingStripThrough } = vi.hoisted(() => ({
  requireBettingAuth: vi.fn(),
  getTrendingStripThrough: vi.fn(),
}));

vi.mock('@/lib/auth/require-betting-auth', () => ({
  requireBettingAuth: (...args: unknown[]) => requireBettingAuth(...args),
}));

vi.mock('@/lib/betting/queries', () => ({
  getTeamPaceRankings: async () => [],
  getTeamDefensiveRankings: async () => [],
  getDashboardSummary: async () => ({ total_games: 0, total_players: 0, latest_game_date: null }),
  getTrendingPlayersFromAnalytics: async () => [
    {
      full_name: 'Jeremiah Fears',
      trend_direction: 'up',
      points_trend_pct: 125,
      l5_avg_points: 31.8,
      season_avg_points: 14.1,
    },
  ],
  getTrendingStripThrough: (...args: unknown[]) => getTrendingStripThrough(...args),
}));

import { GET } from '@/app/api/betting/insights/route';

type Body = {
  insights: Array<{ id: string; type: string }>;
  widgets: Array<{ id: string; value: string; description: string; change?: string }>;
};

async function load(): Promise<Body> {
  const res = await GET(new NextRequest('http://localhost/api/betting/insights'));
  expect(res.status).toBe(200);
  return (await res.json()) as Body;
}

describe('GET /api/betting/insights recent-form guard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-03T16:00:00Z'));
    requireBettingAuth.mockResolvedValue({
      ok: true,
      auth: { userId: '11111111-1111-1111-1111-111111111111', email: 'a@example.com', accessToken: 't' },
      withAuthCookies: (response: NextResponse) => response,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("hides last season's L5 from the Recent form tile and trend cards", async () => {
    getTrendingStripThrough.mockResolvedValue('2026-06-13');
    const body = await load();
    const tile = body.widgets.find((w) => w.id === 'w-4')!;
    expect(tile.value).toBe('—');
    expect(tile.change).toBeUndefined();
    expect(tile.description).toBe("Returns once this season's box scores load");
    expect(body.insights.filter((i) => i.type === 'trend')).toEqual([]);
  });

  it('shows the leader when the newest game is recent', async () => {
    getTrendingStripThrough.mockResolvedValue('2026-11-02');
    const body = await load();
    const tile = body.widgets.find((w) => w.id === 'w-4')!;
    expect(tile.value).toBe('Fears');
    expect(tile.change).toBe('+125%');
    expect(body.insights.filter((i) => i.type === 'trend')).toHaveLength(1);
  });
});
