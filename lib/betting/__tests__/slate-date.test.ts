import { describe, expect, it, vi } from 'vitest';

vi.mock('../queries', () => ({
  getGamesForDate: vi.fn(),
  getGamesForCalendarDate: vi.fn(),
}));

import { resolvePropsMarketContext } from '../props-market-context';
import { shouldUnpinSlateSeason } from '../slate-date';

describe('shouldUnpinSlateSeason', () => {
  it('unpins completed-season historical dates (2024 Finals ET date)', () => {
    expect(shouldUnpinSlateSeason('2024-06-17', '2026-09-10')).toBe(true);
    expect(resolvePropsMarketContext({ dateEt: '2024-06-17', todayEt: '2026-09-10' })).toBe(
      'historical'
    );
  });

  it('keeps today and future dates season-pinned', () => {
    expect(shouldUnpinSlateSeason('2026-09-10', '2026-09-10')).toBe(false);
    expect(shouldUnpinSlateSeason('2026-10-20', '2026-09-10')).toBe(false);
  });
});
