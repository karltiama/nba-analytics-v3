import { beforeEach, describe, expect, it, vi } from 'vitest';

const getGamesForDate = vi.fn();
const getGamesForCalendarDate = vi.fn();

vi.mock('../queries', () => ({
  getGamesForDate: (...args: unknown[]) => getGamesForDate(...args),
  getGamesForCalendarDate: (...args: unknown[]) => getGamesForCalendarDate(...args),
}));

import { loadDashboardGamesForEtDate } from '../slate-date';

describe('loadDashboardGamesForEtDate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('uses unpinned calendar games for 2024-06-17', async () => {
    getGamesForCalendarDate.mockResolvedValueOnce([{ game_id: '15905067' }]);
    const result = await loadDashboardGamesForEtDate('2024-06-17', '2026-09-10');
    expect(getGamesForCalendarDate).toHaveBeenCalledWith('2024-06-17');
    expect(getGamesForDate).not.toHaveBeenCalled();
    expect(result.picker).toBe('calendar');
    expect(result.games[0]?.game_id).toBe('15905067');
  });

  it('keeps the season pin for today and future dates', async () => {
    getGamesForDate.mockResolvedValueOnce([]);
    const today = await loadDashboardGamesForEtDate('2026-09-10', '2026-09-10');
    expect(getGamesForDate).toHaveBeenCalledWith('2026-09-10');
    expect(today.picker).toBe('season');

    getGamesForDate.mockResolvedValueOnce([]);
    const future = await loadDashboardGamesForEtDate('2026-10-20', '2026-09-10');
    expect(future.picker).toBe('season');
    expect(getGamesForCalendarDate).not.toHaveBeenCalled();
  });
});
