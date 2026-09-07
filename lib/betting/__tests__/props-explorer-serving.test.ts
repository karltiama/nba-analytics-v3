import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('@/lib/betting/player-prop-inputs', () => ({
  getPlayerPropModelInputs: vi.fn(),
}));

import { query, queryOne } from '@/lib/db';
import { getPlayerPropModelInputs } from '@/lib/betting/player-prop-inputs';
import { getPlayerPropsForExplorer } from '../props-explorer-serving';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockQueryOne = queryOne as ReturnType<typeof vi.fn>;
const mockInputs = getPlayerPropModelInputs as ReturnType<typeof vi.fn>;

const HISTORICAL_ROW = {
  game_id: '401585000',
  player_id: '1629027',
  player_name: 'Luka Doncic',
  sportsbook: 'DraftKings',
  prop_type: 'points',
  market_type: 'over_under',
  side: 'over',
  line_value: 28.5,
  odds_american: -110,
  odds_decimal: 1.91,
  implied_probability: 0.524,
  snapshot_at: '2026-05-01T23:00:00.000Z',
  game_start_time: '2026-05-01T23:30:00.000Z',
};

function sqlOf(callIdx: number): string {
  return String(mockQuery.mock.calls[callIdx]?.[0] ?? '');
}

function paramsOf(callIdx: number): unknown[] {
  return (mockQuery.mock.calls[callIdx]?.[1] ?? []) as unknown[];
}

describe('getPlayerPropsForExplorer serving contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInputs.mockResolvedValue(null);
  });

  it('uses research.prop_decision_lines for a historical date and does not compute EV', async () => {
    mockQuery.mockResolvedValueOnce([{ count: '1' }]).mockResolvedValueOnce([HISTORICAL_ROW]);

    const result = await getPlayerPropsForExplorer({
      dateEt: '2026-05-01',
      todayEt: '2026-09-06',
      now: new Date('2026-09-06T16:00:00.000Z'),
      limit: 100,
      offset: 0,
    });

    expect(result.marketContext).toBe('historical');
    expect(result.sourceTable).toBe('research.prop_decision_lines');
    expect(result.lineLabel).toBe('Historical closing line');
    expect(sqlOf(0)).toMatch(/research\.prop_decision_lines/);
    expect(sqlOf(0)).not.toMatch(/player_props_current/);
    expect(sqlOf(1)).toMatch(/p\.decision_at AS snapshot_at/);
    expect(paramsOf(0)).toContain('2026-05-01');
    expect(paramsOf(0)).not.toContain('2026-05-06');
    expect(paramsOf(0)).not.toContain('2025');
    expect(mockInputs).not.toHaveBeenCalled();

    const row = result.rows[0];
    expect(row.gameId).toBe('401585000');
    expect(row.playerId).toBe(1629027);
    expect(row.marketContext).toBe('historical');
    expect(row.lineLabel).toBe('Historical closing line');
    expect(row.paperBetAllowed).toBe(false);
    expect(row.ev).toBeNull();
    expect(row.projection).toBeNull();
    expect(row.modelProbability).toBeNull();
    expect(row.calibrationVersion).toBeUndefined();
  });

  it('keeps May 6 empty when the historical source has no rows and does not fall back', async () => {
    mockQuery.mockResolvedValueOnce([{ count: '0' }]).mockResolvedValueOnce([]);

    const result = await getPlayerPropsForExplorer({
      dateEt: '2026-05-06',
      todayEt: '2026-09-06',
      limit: 100,
      offset: 0,
    });

    expect(result.marketContext).toBe('historical');
    expect(result.rows).toEqual([]);
    expect(result.totalMatching).toBe(0);
    expect(sqlOf(0)).toMatch(/research\.prop_decision_lines/);
    expect(sqlOf(0)).not.toMatch(/player_props_current/);
    expect(paramsOf(0)).toEqual(expect.arrayContaining(['2026-05-06']));
    expect(paramsOf(0)).not.toContain('2026-05-01');
    expect(mockInputs).not.toHaveBeenCalled();
  });

  it('uses analytics.player_props_current for today without rewriting current from history', async () => {
    mockQuery.mockResolvedValueOnce([{ count: '0' }]).mockResolvedValueOnce([]);

    const result = await getPlayerPropsForExplorer({
      dateEt: '2026-09-06',
      todayEt: '2026-09-06',
      now: new Date('2026-09-06T16:00:00.000Z'),
      limit: 100,
      offset: 0,
    });

    expect(result.marketContext).toBe('live');
    expect(result.sourceTable).toBe('analytics.player_props_current');
    expect(result.lineLabel).toBe('Current market');
    expect(result.rows).toEqual([]);
    expect(sqlOf(0)).toMatch(/analytics\.player_props_current/);
    expect(sqlOf(0)).not.toMatch(/prop_decision_lines/);
    expect(paramsOf(0)).toContain('2026-09-06');
  });

  it('resolves game_id onto the game ET date so a historical game is not served from current', async () => {
    mockQueryOne.mockResolvedValue({ start_time: '2026-05-01T23:30:00.000Z' });
    mockQuery.mockResolvedValueOnce([{ count: '1' }]).mockResolvedValueOnce([HISTORICAL_ROW]);

    const result = await getPlayerPropsForExplorer({
      dateEt: '2026-09-06',
      gameId: '401585000',
      todayEt: '2026-09-06',
      limit: 100,
      offset: 0,
    });

    expect(mockQueryOne).toHaveBeenCalled();
    expect(result.marketContext).toBe('historical');
    expect(result.dateEt).toBe('2026-05-01');
    expect(sqlOf(0)).toMatch(/research\.prop_decision_lines/);
    expect(sqlOf(0)).toMatch(/p\.game_id::text = \$1|p\.game_id = \$1/);
    expect(paramsOf(0)[0]).toBe('401585000');
  });

  it('does not apply min_ev filtering on historical rows with unavailable EV', async () => {
    mockQuery.mockResolvedValueOnce([{ count: '1' }]).mockResolvedValueOnce([HISTORICAL_ROW]);

    const result = await getPlayerPropsForExplorer({
      dateEt: '2026-05-01',
      todayEt: '2026-09-06',
      minEv: 0.05,
      limit: 100,
      offset: 0,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].ev).toBeNull();
  });

  it('allows paper on a live future tip and still computes EV from the current path', async () => {
    const liveRow = {
      ...HISTORICAL_ROW,
      game_id: '401700001',
      snapshot_at: '2026-09-06T18:00:00.000Z',
      game_start_time: '2026-09-06T23:30:00.000Z',
    };
    mockQuery.mockResolvedValueOnce([{ count: '1' }]).mockResolvedValueOnce([liveRow]);

    const result = await getPlayerPropsForExplorer({
      dateEt: '2026-09-06',
      todayEt: '2026-09-06',
      now: new Date('2026-09-06T16:00:00.000Z'),
      limit: 100,
      offset: 0,
    });

    expect(result.marketContext).toBe('live');
    expect(sqlOf(0)).toMatch(/analytics\.player_props_current/);
    expect(mockInputs).toHaveBeenCalledWith('1629027');
    expect(result.rows[0].paperBetAllowed).toBe(true);
    expect(result.rows[0].lineLabel).toBe('Current market');
  });
});
