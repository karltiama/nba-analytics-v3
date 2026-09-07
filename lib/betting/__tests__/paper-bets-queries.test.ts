import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { query, queryOne } from '@/lib/db';
import {
  deleteOpenPaperBetForUser,
  insertPaperBetForUser,
  listPaperAnalyticsForUser,
  listPaperBetsForUser,
  PAPER_ANALYTICS_OWNER_WHERE,
  PAPER_BETS_DELETE_SQL,
  PAPER_BETS_INSERT_SQL,
  PAPER_BETS_LIST_SQL,
} from '../paper-bets-queries';
import { summarizeSettledPaperPortfolio } from '../paper-portfolio';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockQueryOne = queryOne as ReturnType<typeof vi.fn>;

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const BET_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function sqlOf(fn: ReturnType<typeof vi.fn>, callIdx: number): string {
  return String(fn.mock.calls[callIdx]?.[0] ?? '');
}

function paramsOf(fn: ReturnType<typeof vi.fn>, callIdx: number): unknown[] {
  return (fn.mock.calls[callIdx]?.[1] ?? []) as unknown[];
}

describe('paper.bets SQL isolation', () => {
  it('scopes list, delete, insert, and analytics to user_id', () => {
    expect(PAPER_BETS_LIST_SQL).toMatch(/user_id = \$1::uuid/);
    expect(PAPER_BETS_DELETE_SQL).toMatch(/id = \$1::uuid AND user_id = \$2::uuid AND status = 'open'/);
    expect(PAPER_BETS_INSERT_SQL).toMatch(/user_id, status/);
    expect(PAPER_BETS_INSERT_SQL).toMatch(/\$1::uuid, 'open'/);
    expect(PAPER_ANALYTICS_OWNER_WHERE).toBe("status = 'settled' AND user_id = $1::uuid");
  });
});

describe('paper.bets user-facing queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('create binds the authenticated user, not a client-supplied id', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'bet-a',
      user_id: USER_A,
      created_at: '2026-09-06T20:00:00.000Z',
      status: 'open',
      game_id: '1',
      player_id: '9',
      player_name: null,
      sportsbook: null,
      prop_type: 'points',
      market_type: 'over_under',
      side: 'over',
      line_value: 24.5,
      odds_american: -110,
      implied_probability: null,
      stake_units: 1,
      ev: null,
      confidence_tier: null,
      calibration_version: null,
      decision_snapshot_at: '2026-09-06T20:00:00.000Z',
      model_probability: null,
      projection: null,
      ev_selected_track: null,
      result: null,
      profit_units: null,
      settled_at: null,
    });

    const bet = await insertPaperBetForUser({
      userId: USER_A,
      gameId: '1',
      playerId: '9',
      stakeUnits: 1,
      decisionSnapshotAt: '2026-09-06T20:00:00.000Z',
    });

    expect(paramsOf(mockQueryOne, 0)[0]).toBe(USER_A);
    expect(paramsOf(mockQueryOne, 0)).not.toContain(USER_B);
    expect(bet?.userId).toBe(USER_A);
  });

  it('lists only the authenticated user bind', async () => {
    mockQueryOne.mockResolvedValueOnce({ c: '1' });
    mockQuery.mockResolvedValueOnce([
      {
        id: 'bet-a',
        user_id: USER_A,
        created_at: '2026-09-06T20:00:00.000Z',
        status: 'open',
        game_id: '1',
        player_id: '9',
        player_name: null,
        sportsbook: null,
        prop_type: 'points',
        market_type: 'over_under',
        side: 'over',
        line_value: 24.5,
        odds_american: -110,
        implied_probability: null,
        stake_units: 1,
        ev: null,
        confidence_tier: null,
        calibration_version: null,
        decision_snapshot_at: '2026-09-06T20:00:00.000Z',
        model_probability: null,
        projection: null,
        ev_selected_track: null,
        result: null,
        profit_units: null,
        settled_at: null,
      },
    ]);

    const { bets, total } = await listPaperBetsForUser({
      userId: USER_A,
      status: 'open',
      limit: 200,
      offset: 0,
    });
    expect(paramsOf(mockQueryOne, 0)).toEqual([USER_A, 'open']);
    expect(paramsOf(mockQuery, 0)[0]).toBe(USER_A);
    expect(paramsOf(mockQuery, 0)).not.toContain(USER_B);
    expect(total).toBe(1);
    expect(bets).toHaveLength(1);
    expect(bets[0]?.userId).toBe(USER_A);
  });

  it('does not delete another user\'s open bet by id', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const deleted = await deleteOpenPaperBetForUser({ userId: USER_A, id: BET_B });
    expect(deleted).toBeNull();
    expect(paramsOf(mockQueryOne, 0)).toEqual([BET_B, USER_A]);
  });

  it('analytics binds the owner on every aggregate query', async () => {
    mockQuery.mockResolvedValue([]);
    await listPaperAnalyticsForUser(USER_A);
    expect(mockQuery).toHaveBeenCalledTimes(4);
    for (let i = 0; i < 4; i++) {
      expect(sqlOf(mockQuery, i)).toContain(PAPER_ANALYTICS_OWNER_WHERE);
      expect(paramsOf(mockQuery, i)).toEqual([USER_A]);
      expect(paramsOf(mockQuery, i)).not.toContain(USER_B);
    }
  });
});

describe('paper portfolio isolation', () => {
  it('aggregates only the bets it is given (owner list vs mixed leak)', () => {
    const ownerBets = [
      { result: 'win', profitUnits: 1.1, stakeUnits: 1 },
      { result: 'loss', profitUnits: -1, stakeUnits: 1 },
    ];
    const otherUserBet = { result: 'win', profitUnits: 50, stakeUnits: 10 };
    const owner = summarizeSettledPaperPortfolio(ownerBets);
    const leaked = summarizeSettledPaperPortfolio([...ownerBets, otherUserBet]);
    expect(owner.n).toBe(2);
    expect(owner.wins).toBe(1);
    expect(owner.profitStaked).toBeCloseTo(0.1);
    expect(leaked.n).toBe(3);
    expect(leaked.profitStaked).toBeCloseTo(50.1);
    expect(owner.profitStaked).not.toBe(leaked.profitStaked);
  });
});
