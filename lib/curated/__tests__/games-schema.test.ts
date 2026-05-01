import { describe, it, expect } from 'vitest';
import { createNullCoercionCounts, normalizeRawGameRow, partitionDedupeKey } from '../games-schema';

describe('normalizeRawGameRow', () => {
  it('includes final games', () => {
    const row = normalizeRawGameRow({
      row: {
        season: '2024',
        game_id: 'g-final',
        game_date: '2024-11-01',
        status: 'Final',
        home_team_id: '10',
        away_team_id: '20',
      },
      season: 2024,
      partitionDate: '2024-11-01',
      nullCoercionCounts: createNullCoercionCounts(),
    });

    expect(row).not.toBeNull();
    expect(row?.game_id).toBe('g-final');
    expect(row?.season).toBe('2024');
  });

  it('skips non-final games', () => {
    const row = normalizeRawGameRow({
      row: {
        season: '2024',
        game_id: 'g-scheduled',
        game_date: '2024-11-01',
        status: 'Scheduled',
      },
      season: 2024,
      partitionDate: '2024-11-01',
      nullCoercionCounts: createNullCoercionCounts(),
    });

    expect(row).toBeNull();
  });

  it('forces output season to requested season', () => {
    const row = normalizeRawGameRow({
      row: {
        season: '2023',
        game_id: 'g-season',
        game_date: '2024-11-02',
        status: 'Final',
      },
      season: 2024,
      partitionDate: '2024-11-02',
      nullCoercionCounts: createNullCoercionCounts(),
    });
    expect(row?.season).toBe('2024');
  });

  it('builds dedupe key from game_id', () => {
    const row = normalizeRawGameRow({
      row: {
        game_id: 'g-key',
        game_date: '2024-11-03',
        status: 'Final',
      },
      season: 2024,
      partitionDate: '2024-11-03',
      nullCoercionCounts: createNullCoercionCounts(),
    });
    expect(row).not.toBeNull();
    expect(partitionDedupeKey(row!)).toBe('g-key');
  });
});
