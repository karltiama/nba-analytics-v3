import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/players/analytics-queries', () => ({
  getAnalyticsPlayerSeasonStats: vi.fn(),
  getAnalyticsPlayerGames: vi.fn(),
}));

vi.mock('@/lib/season', async () => {
  const actual = await vi.importActual<typeof import('@/lib/season')>('@/lib/season');
  return {
    ...actual,
    getAnalyticsSeason: vi.fn(() => '2026'),
  };
});

import {
  getAnalyticsPlayerGames,
  getAnalyticsPlayerSeasonStats,
} from '@/lib/players/analytics-queries';
import { getAnalyticsSeason } from '@/lib/season';
import { getPlayerPropModelInputs } from '@/lib/betting/player-prop-inputs';

const mockSeasonStats = getAnalyticsPlayerSeasonStats as ReturnType<typeof vi.fn>;
const mockGames = getAnalyticsPlayerGames as ReturnType<typeof vi.fn>;
const mockGetSeason = getAnalyticsSeason as ReturnType<typeof vi.fn>;

describe('getPlayerPropModelInputs (Phase 2.2 fail-closed)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSeason.mockReturnValue('2026');
  });

  it('passes active season explicitly (never null)', async () => {
    mockSeasonStats.mockResolvedValue({ games_played: 10, avg_points: 20, total_3pm: 30 });
    mockGames.mockResolvedValue({
      games: [
        {
          game_id: '1',
          points: 22,
          rebounds: 5,
          assists: 4,
          three_pointers_made: 2,
        },
      ],
    });

    await getPlayerPropModelInputs('p1');

    expect(mockSeasonStats).toHaveBeenCalledWith('p1', '2026');
    expect(mockGames).toHaveBeenCalledWith('p1', '2026', 10);
    expect(mockSeasonStats.mock.calls[0][1]).not.toBeNull();
  });

  it('returns null when only prior-season stats exist (empty 2026 averages)', async () => {
    mockSeasonStats.mockResolvedValue({}); // no 2026 row
    mockGames.mockResolvedValue({ games: [] });

    const out = await getPlayerPropModelInputs('p1');
    expect(out).toBeNull();
  });

  it('returns null with 0 completed 2026 games (no invented L10 / sample)', async () => {
    mockSeasonStats.mockResolvedValue({ games_played: 5, avg_points: 18, total_3pm: 10 });
    mockGames.mockResolvedValue({ games: [] });

    const out = await getPlayerPropModelInputs('p1');
    expect(out).toBeNull();
  });

  it('returns null when season games_played is 0', async () => {
    mockSeasonStats.mockResolvedValue({ games_played: 0, avg_points: 0 });
    mockGames.mockResolvedValue({
      games: [{ game_id: '1', points: 10, rebounds: 1, assists: 1, three_pointers_made: 0 }],
    });

    const out = await getPlayerPropModelInputs('p1');
    expect(out).toBeNull();
  });

  it('preserves real sampleGamesUsed when active-season data exists', async () => {
    mockSeasonStats.mockResolvedValue({
      games_played: 8,
      avg_points: 20,
      avg_rebounds: 5,
      avg_assists: 4,
      total_3pm: 16,
    });
    mockGames.mockResolvedValue({
      games: [
        { game_id: '1', points: 22, rebounds: 5, assists: 4, three_pointers_made: 2 },
        { game_id: '2', points: 18, rebounds: 6, assists: 3, three_pointers_made: 1 },
      ],
    });

    const out = await getPlayerPropModelInputs('p1');
    expect(out).not.toBeNull();
    expect(out!.seasonKey).toBe('2026');
    expect(out!.sampleGamesUsed).toBe(2);
    expect(out!.seasonGamesPlayed).toBe(8);
    expect(out!.season.threes).toBeCloseTo(16 / 8);
  });
});
