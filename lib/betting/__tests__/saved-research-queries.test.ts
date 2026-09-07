import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { query, queryOne } from '@/lib/db';
import {
  deleteSavedResearchForUser,
  insertSavedResearchForUser,
  listSavedResearchForUser,
  SAVED_RESEARCH_INSERT_SQL,
} from '../saved-research-queries';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockQueryOne = queryOne as ReturnType<typeof vi.fn>;

describe('saved research user isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists only the authenticated user bind and still returns a bookmark if current market is missing', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 'save-a',
        user_id: 'user-a',
        game_id: '21681995',
        player_id: 9,
        player_name: 'Jarrett Allen',
        sportsbook: 'betmgm',
        prop_type: 'points',
        market_type: 'over_under',
        side: 'over',
        line_value: 10.5,
        odds_american: -125,
        implied_probability: 0.556,
        snapshot_at: '2026-05-01T18:00:11.909Z',
        note: null,
        created_at: '2026-09-06T20:00:00.000Z',
        updated_at: '2026-09-06T20:00:00.000Z',
        market_context: 'historical',
        date_et: '2026-05-01',
        game_start_time: null,
        game_status: 'Final',
        away_abbr: null,
        home_abbr: null,
      },
    ]);

    const rows = await listSavedResearchForUser({
      userId: 'user-a',
      todayEt: '2026-09-06',
    });
    expect(mockQuery.mock.calls[0]?.[1]).toEqual(['user-a', 100]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe('user-a');
    expect(rows[0]?.lineValue).toBe(10.5);
    expect(rows[0]?.marketContext).toBe('historical');
  });

  it('does not delete another user\'s save', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const deleted = await deleteSavedResearchForUser({
      userId: 'user-a',
      id: 'save-owned-by-b',
    });
    expect(deleted).toBeNull();
    expect(mockQueryOne.mock.calls[0]?.[1]).toEqual(['save-owned-by-b', 'user-a']);
  });

  it('inserts with the session user_id and persisted market context', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'save-a',
      user_id: 'user-a',
      game_id: '1',
      player_id: 9,
      player_name: null,
      sportsbook: null,
      prop_type: 'points',
      market_type: 'over_under',
      side: 'over',
      line_value: 10.5,
      odds_american: -125,
      implied_probability: null,
      snapshot_at: '2026-09-06T18:00:00.000Z',
      note: null,
      created_at: '2026-09-06T20:00:00.000Z',
      updated_at: '2026-09-06T20:00:00.000Z',
      market_context: 'live',
      date_et: '2026-09-06',
    });
    const row = await insertSavedResearchForUser({
      userId: 'user-a',
      gameId: '1',
      playerId: '9',
      marketContext: 'live',
      dateEt: '2026-09-06',
    });
    expect(SAVED_RESEARCH_INSERT_SQL).toMatch(/market_context, date_et/);
    expect(mockQueryOne.mock.calls[0]?.[1]?.[0]).toBe('user-a');
    expect(mockQueryOne.mock.calls[0]?.[1]).toContain('live');
    expect(mockQueryOne.mock.calls[0]?.[1]).toContain('2026-09-06');
    expect(row?.market_context).toBe('live');
  });
});
