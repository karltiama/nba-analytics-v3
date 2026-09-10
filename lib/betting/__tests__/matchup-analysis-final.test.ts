import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache: (fn: () => unknown) => fn,
}));

const query = vi.fn();
vi.mock('@/lib/db', () => ({
  query: (...args: unknown[]) => query(...args),
  queryOne: vi.fn(),
}));

const fetchLineupsFromBallDontLie = vi.fn();
vi.mock('@/lib/balldontlie/lineups', () => ({
  fetchLineupsFromBallDontLie: (...args: unknown[]) => fetchLineupsFromBallDontLie(...args),
}));

vi.mock('@/lib/injuries/freshness', () => ({
  filterAuthoritativeInjuries: (rows: unknown[]) => rows,
}));

vi.mock('@/lib/season', async () => {
  const actual = await vi.importActual<typeof import('@/lib/season')>('@/lib/season');
  return {
    ...actual,
    getAnalyticsSeason: vi.fn(() => '2025'),
  };
});

import { getMatchupAnalysis } from '../queries';

describe('getMatchupAnalysis Final lineup guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not call fetchLineupsFromBallDontLie for a Final', async () => {
    query.mockResolvedValueOnce([
      {
        game_id: '15905067',
        home_team_id: '2',
        away_team_id: '7',
        status: 'Final',
        season: '2023',
      },
    ]);

    const result = await getMatchupAnalysis('15905067');

    expect(fetchLineupsFromBallDontLie).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    expect(result?.starting_lineups).toEqual({ home: null, away: null });
    expect(result?.pace_analysis).toBeNull();
  });

  it('still loads live projected lineups for a non-Final', async () => {
    query.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes('g.status') && s.includes('g.season')) {
        return [
          {
            game_id: 'future-1',
            home_team_id: '2',
            away_team_id: '7',
            status: 'Scheduled',
            season: '2026',
          },
        ];
      }
      if (s.includes('avg_pace')) {
        return [{ home_team_pace: 100, away_team_pace: 100 }];
      }
      return [];
    });
    fetchLineupsFromBallDontLie.mockResolvedValue(null);

    await getMatchupAnalysis('future-1');

    expect(fetchLineupsFromBallDontLie).toHaveBeenCalled();
  });
});
