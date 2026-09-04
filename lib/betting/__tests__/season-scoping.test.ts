import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('@/lib/season', async () => {
  const actual = await vi.importActual<typeof import('@/lib/season')>('@/lib/season');
  return {
    ...actual,
    getAnalyticsSeason: vi.fn(() => '2026'),
  };
});

import { query, queryOne } from '@/lib/db';
import { getAnalyticsSeason } from '@/lib/season';
import { getAnalyticsPlayerSeasonStats } from '@/lib/players/analytics-queries';
import {
  getAllTeamRatings,
  getPaceAnalysis,
  getProjectedStartingLineupFromAnalytics,
  getTeamRecentForm,
  getTrendingPlayersFromAnalytics,
  getTrendingPlayersStrip,
} from '@/lib/betting/queries';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockQueryOne = queryOne as ReturnType<typeof vi.fn>;
const mockGetSeason = getAnalyticsSeason as ReturnType<typeof vi.fn>;

describe('betting season scoping (Phase 2.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSeason.mockReturnValue('2026');
  });

  it('getAnalyticsPlayerSeasonStats(id, 2026) filters season and does not return unscoped latest', async () => {
    mockQueryOne.mockResolvedValue(null);
    await getAnalyticsPlayerSeasonStats('p1', '2026');
    const [sql, params] = mockQueryOne.mock.calls[0];
    expect(String(sql)).toMatch(/a\.season = \$2/);
    expect(params).toEqual(['p1', '2026']);
  });

  it('getPaceAnalysis uses only active season and returns null when missing', async () => {
    mockQuery.mockResolvedValue([{ home_team_pace: null, away_team_pace: 100 }]);
    const missing = await getPaceAnalysis('h', 'a');
    expect(missing).toBeNull();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toMatch(/WHERE season = \$3/);
    expect(params).toEqual(['h', 'a', '2026']);
    expect(String(sql)).not.toMatch(/ORDER BY team_id, season DESC/);

    mockQuery.mockResolvedValue([{ home_team_pace: 101, away_team_pace: 99 }]);
    const ok = await getPaceAnalysis('h', 'a');
    expect(ok?.projected_pace).toBe(100);
  });

  it('getAllTeamRatings filters to active season only', async () => {
    mockQuery.mockResolvedValue([
      {
        team_id: 't1',
        offensive_rating: 110,
        defensive_rating: 105,
        pace: 100,
        avg_points: 110,
        avg_points_against: 105,
        wins: 1,
        losses: 0,
      },
    ]);
    const map = await getAllTeamRatings();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toMatch(/WHERE season = \$1/);
    expect(params).toEqual(['2026']);
    expect(map.t1.wins).toBe(1);
  });

  it('getProjectedStartingLineupFromAnalytics scopes Finals to active season', async () => {
    mockQuery.mockResolvedValue([]);
    await getProjectedStartingLineupFromAnalytics('t1');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toMatch(/g\.season = \$2/);
    expect(params).toEqual(['t1', '2026']);
  });

  it('getTeamRecentForm scopes to active season', async () => {
    mockQuery.mockResolvedValue([]);
    await getTeamRecentForm('t1', 5);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toMatch(/tgs\.season = \$2/);
    expect(params).toEqual(['t1', '2026', 5]);
  });

  it('trending L5 CTE scopes game logs to active season', async () => {
    mockQuery.mockResolvedValue([]);
    await getTrendingPlayersFromAnalytics(5);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toMatch(/pgl\.season = \$1/);
    expect(params[0]).toBe('2026');

    mockQuery.mockClear();
    mockQuery.mockResolvedValue([]);
    await getTrendingPlayersStrip('pts', 5);
    const [sql2, params2] = mockQuery.mock.calls[0];
    expect(String(sql2)).toMatch(/pgl\.season = \$1/);
    expect(params2[0]).toBe('2026');
  });
});
