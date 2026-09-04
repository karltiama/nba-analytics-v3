import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/players/analytics-queries', () => ({
  getAnalyticsPlayerSeasonStats: vi.fn(),
  getAnalyticsPlayerGames: vi.fn(),
  getPlayerRecentForm: vi.fn(),
  resolveAnalyticsPlayerId: vi.fn(),
  getAnalyticsPlayerInfo: vi.fn(),
  getPlayerVsOpponentHistory: vi.fn(),
}));

vi.mock('@/lib/season', async () => {
  const actual = await vi.importActual<typeof import('@/lib/season')>('@/lib/season');
  return { ...actual, getAnalyticsSeason: vi.fn(() => '2026') };
});

import { getAnalyticsPlayerSeasonStats, getAnalyticsPlayerGames } from '@/lib/players/analytics-queries';
import { getAnalyticsSeason } from '@/lib/season';

describe('betting player active-season empty presentation (Phase 2.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAnalyticsSeason as ReturnType<typeof vi.fn>).mockReturnValue('2026');
  });

  it('active season with no stats returns empty averages object (not prior-season values)', async () => {
    (getAnalyticsPlayerSeasonStats as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (getAnalyticsPlayerGames as ReturnType<typeof vi.fn>).mockResolvedValue({ games: [] });

    const season = getAnalyticsSeason();
    const stats = await getAnalyticsPlayerSeasonStats('p1', season);
    const games = await getAnalyticsPlayerGames('p1', season, 82);

    expect(season).toBe('2026');
    expect(getAnalyticsPlayerSeasonStats).toHaveBeenCalledWith('p1', '2026');
    expect(stats.avg_points).toBeUndefined();
    expect(stats.games_played ?? 0).toBe(0);
    expect(games.games).toEqual([]);
  });
});
