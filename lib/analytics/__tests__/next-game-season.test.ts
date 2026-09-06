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
import {
  getNextGameForTeam,
  getUpcomingGamesForTeam,
} from '@/lib/analytics/games-queries';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockQueryOne = queryOne as ReturnType<typeof vi.fn>;
const mockGetSeason = getAnalyticsSeason as ReturnType<typeof vi.fn>;

describe('next/upcoming game season scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSeason.mockReturnValue('2026');
  });

  it('getNextGameForTeam filters to the active analytics season', async () => {
    mockQueryOne.mockResolvedValue(null);
    await getNextGameForTeam('1');
    const [sql, params] = mockQueryOne.mock.calls[0];
    expect(String(sql)).toMatch(/g\.season = \$2/);
    expect(params).toEqual(['1', '2026']);
  });

  it('getUpcomingGamesForTeam filters to the active analytics season', async () => {
    mockQuery.mockResolvedValue([]);
    await getUpcomingGamesForTeam('1', 5);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toMatch(/g\.season = \$2/);
    expect(params).toEqual(['1', '2026', 5]);
  });
});
