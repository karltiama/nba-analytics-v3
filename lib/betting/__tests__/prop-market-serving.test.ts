import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('@/lib/betting/ai-briefing-eligibility', () => ({
  isIngestionFrozen: vi.fn(() => true),
}));

import { query, queryOne } from '@/lib/db';
import { getPropMarketResearch } from '../prop-market-serving';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockQueryOne = queryOne as ReturnType<typeof vi.fn>;

const ALLEN_OVER = {
  sportsbook: 'draftkings',
  side: 'over',
  line_value: 10.5,
  odds_american: -114,
  snapshot_at: '2026-05-01T18:00:11.909Z',
};

function sqlOf(callIdx: number): string {
  return String(mockQuery.mock.calls[callIdx]?.[0] ?? '');
}

function mockResearchQueries(books: unknown[], certified: unknown[] = []) {
  mockQuery.mockResolvedValueOnce(books).mockResolvedValueOnce(certified);
}

describe('getPropMarketResearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses historical decision lines for May 1 and never labels them current/live', async () => {
    mockResearchQueries(
      [
        ALLEN_OVER,
        {
          sportsbook: 'fanduel',
          side: 'over',
          line_value: 10.5,
          odds_american: -104,
          snapshot_at: '2026-05-01T18:00:11.909Z',
        },
        {
          sportsbook: 'betparx',
          side: 'over',
          line_value: 11.5,
          odds_american: 107,
          snapshot_at: '2026-05-01T18:00:11.909Z',
        },
      ],
      []
    );

    const result = await getPropMarketResearch({
      gameId: '21681995',
      playerId: '9',
      propType: 'points',
      side: 'over',
      lineValue: 10.5,
      sportsbook: 'draftkings',
      snapshotAt: '2026-05-01T18:00:11.909Z',
      oddsAmerican: -114,
      dateEt: '2026-05-01',
      todayEt: '2026-09-06',
      frozen: true,
    });

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.marketContext).toBe('historical');
    expect(result.comparisonLabel).toBe('Historical sportsbook comparison');
    expect(result.lineLabel).toBe('Historical closing line');
    expect(result.comparisonLabel).not.toMatch(/current|live/i);
    expect(result.lineLabel).not.toMatch(/current|live/i);
    expect(result.paperBetAllowed).toBe(false);
    expect(result.selected).toMatchObject({
      gameId: '21681995',
      playerId: '9',
      propType: 'points',
      side: 'over',
      lineValue: 10.5,
      sportsbook: 'draftkings',
    });
    expect(result.shopping.status).toBe('ok');
    expect(result.shopping.sourceTable).toBe('research.prop_decision_lines');
    expect(result.shopping.bestAvailableOverLine?.lineValue).toBe(10.5);
    expect(result.shopping.bestPriceAtSelectedLine?.sportsbook).toBe('fanduel');
    expect(result).not.toHaveProperty('movement');
    expect(result.marketMovement.sourceTable).toBe('analytics.player_prop_market_movement');
    expect(result.marketMovement.status).toBe('empty');
    expect(sqlOf(0)).toMatch(/research\.prop_decision_lines/);
    expect(sqlOf(1)).toMatch(/analytics\.player_prop_market_movement/);
    expect(sqlOf(1)).not.toMatch(/player_prop_movement_summary/);
    expect(sqlOf(0)).not.toMatch(/player_prop_lines/);
    expect(sqlOf(0)).not.toMatch(/player_props_current/);
    expect(String(mockQueryOne.mock.calls[0]?.[0] ?? '')).toMatch(/analytics\.players/);
  });

  it('keeps a selected line of 0 instead of treating it as missing', async () => {
    mockResearchQueries([], []);
    const result = await getPropMarketResearch({
      gameId: '21681995',
      playerId: '9',
      propType: 'points',
      side: 'under',
      lineValue: '0',
      sportsbook: 'draftkings',
      dateEt: '2026-05-01',
      todayEt: '2026-09-06',
      frozen: true,
    });
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.selected.lineValue).toBe(0);
    expect(result.shopping.status).toBe('unavailable');
    expect(result.shopping.message).toBe('Line comparison unavailable');
  });

  it('returns unavailable shopping for a historical date with no decision rows (May 6)', async () => {
    mockResearchQueries([], []);
    const result = await getPropMarketResearch({
      gameId: '21708674',
      playerId: '1',
      propType: 'points',
      side: 'over',
      lineValue: 25.5,
      sportsbook: 'draftkings',
      dateEt: '2026-05-06',
      todayEt: '2026-09-06',
      frozen: true,
    });
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.marketContext).toBe('historical');
    expect(result.shopping.status).toBe('unavailable');
    expect(result.shopping.books).toEqual([]);
    expect(result.comparisonLabel).not.toMatch(/current|live/i);
  });

  it('does not shop analytics.player_prop_lines for a frozen current market', async () => {
    mockQuery.mockResolvedValueOnce([]);
    const result = await getPropMarketResearch({
      gameId: '999',
      playerId: '1',
      propType: 'points',
      side: 'over',
      lineValue: 25.5,
      sportsbook: 'draftkings',
      snapshotAt: '2026-09-06T16:00:00.000Z',
      dateEt: '2026-09-06',
      todayEt: '2026-09-06',
      now: new Date('2026-09-06T16:00:00.000Z'),
      frozen: true,
    });
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.marketContext).toBe('live');
    expect(result.comparisonLabel).toBe('Current market comparison');
    expect(result.shopping.status).toBe('unavailable');
    expect(result.shopping.reason).toBe('frozen_current');
    expect(result.shopping.books).toEqual([]);
    expect(mockQuery.mock.calls.every((call) => !String(call[0]).includes('player_prop_lines'))).toBe(true);
    expect(sqlOf(0)).toMatch(/analytics\.player_prop_market_movement/);
  });

  it('marks unfrozen but stale current shopping unavailable', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          sportsbook: 'draftkings',
          side: 'over',
          line_value: 25.5,
          odds_american: -110,
          snapshot_at: '2026-03-09T17:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([]);
    const result = await getPropMarketResearch({
      gameId: '18447751',
      playerId: '246',
      propType: 'points',
      side: 'over',
      lineValue: 25.5,
      sportsbook: 'draftkings',
      snapshotAt: '2026-09-06T16:00:00.000Z',
      dateEt: '2026-09-06',
      todayEt: '2026-09-06',
      now: new Date('2026-09-06T16:00:00.000Z'),
      frozen: false,
    });
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.shopping.status).toBe('unavailable');
    expect(result.shopping.reason).toBe('stale_current');
    expect(result.shopping.books).toEqual([]);
    expect(sqlOf(0)).toMatch(/analytics\.player_prop_lines/);
  });

  it('does not load first/last player_prop_lines as certified Market Movement', async () => {
    mockResearchQueries([ALLEN_OVER], []);
    const result = await getPropMarketResearch({
      gameId: '21681995',
      playerId: '9',
      propType: 'points',
      side: 'over',
      lineValue: 10.5,
      sportsbook: 'draftkings',
      dateEt: '2026-05-01',
      todayEt: '2026-09-06',
      frozen: true,
    });
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result).not.toHaveProperty('movement');
    expect(result).not.toHaveProperty('openedLine');
    expect(mockQuery.mock.calls.every((call) => !String(call[0]).includes('player_prop_lines'))).toBe(true);
    expect(sqlOf(1)).toMatch(/analytics\.player_prop_market_movement/);
  });
});
