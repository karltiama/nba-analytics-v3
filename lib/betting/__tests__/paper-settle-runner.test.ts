import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { query } from '@/lib/db';
import {
  PAPER_SETTLE_SELECT_SQL,
  PAPER_SETTLE_UPDATE_SQL,
  runPaperSettlement,
} from '../paper-settle-runner';

const mockQuery = query as ReturnType<typeof vi.fn>;

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

function openBet(id: string, userId: string) {
  return {
    id,
    user_id: userId,
    game_id: 'g1',
    player_id: '9',
    market_type: 'over_under',
    prop_type: 'points',
    side: 'over',
    line_value: 20.5,
    odds_american: -110,
    stake_units: 1,
    pts: 30,
    reb: 5,
    ast: 4,
    threes: 1,
    pra: 39,
    pa: 34,
    pr: 35,
    ra: 9,
  };
}

describe('paper settlement ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('system settlement examines multiple owners without overwriting user_id', async () => {
    mockQuery
      .mockResolvedValueOnce([openBet('bet-a', USER_A), openBet('bet-b', USER_B)])
      .mockResolvedValueOnce([{ id: 'bet-a', user_id: USER_A }])
      .mockResolvedValueOnce([{ id: 'bet-b', user_id: USER_B }]);

    const out = await runPaperSettlement();
    expect(out.examined).toBe(2);
    expect(out.settled).toBe(2);
    expect(PAPER_SETTLE_SELECT_SQL).toMatch(/\$1::uuid IS NULL OR b\.user_id = \$1::uuid/);
    expect(PAPER_SETTLE_UPDATE_SQL).not.toMatch(/user_id\s*=/);
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([null]);
    expect(mockQuery.mock.calls[1]?.[1]?.[0]).toBe('bet-a');
    expect(mockQuery.mock.calls[2]?.[1]?.[0]).toBe('bet-b');
  });

  it('user-facing settlement only selects that owner', async () => {
    mockQuery.mockResolvedValueOnce([openBet('bet-a', USER_A)]);
    await runPaperSettlement({ userId: USER_A });
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([USER_A]);
    expect(mockQuery.mock.calls[0]?.[1]).not.toContain(USER_B);
  });
});
