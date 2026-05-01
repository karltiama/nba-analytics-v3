import { describe, it, expect } from 'vitest';
import {
  createNullCoercionCounts,
  normalizeRawPlayerGameLogRow,
  partitionDedupeKey,
} from '../player-game-logs-schema';

describe('normalizeRawPlayerGameLogRow', () => {
  it('normalizes MM:SS minutes into decimal minutes', () => {
    const row = normalizeRawPlayerGameLogRow({
      row: {
        season: '2024',
        game_id: 'g-1',
        game_date: '2024-11-01',
        player_id: 'p-1',
        minutes: '34:30',
        points: 22,
        rebounds: 8,
        assists: 5,
      },
      season: 2024,
      partitionDate: '2024-11-01',
      nullCoercionCounts: createNullCoercionCounts(),
    });

    expect(row).not.toBeNull();
    expect(row?.minutes).toBe(34.5);
    expect(typeof row?.minutes).toBe('number');
    expect(row?.season).toBe('2024');
    expect(row?.game_date).toBe('2024-11-01');
  });

  it('skips non-final player stat rows when status is present', () => {
    const row = normalizeRawPlayerGameLogRow({
      row: {
        season: '2024',
        game_id: 'g-2',
        game_date: '2024-11-02',
        player_id: 'p-2',
        status: 'In Progress',
        minutes: '20:00',
      },
      season: 2024,
      partitionDate: '2024-11-02',
      nullCoercionCounts: createNullCoercionCounts(),
    });

    expect(row).toBeNull();
  });

  it('forces output season to requested season', () => {
    const row = normalizeRawPlayerGameLogRow({
      row: {
        season: '2023',
        game_id: 'g-3',
        player_id: 'p-3',
        game_date: '2024-11-03',
      },
      season: 2024,
      partitionDate: '2024-11-03',
      nullCoercionCounts: createNullCoercionCounts(),
    });
    expect(row?.season).toBe('2024');
  });

  it('uses partition date when game_date is missing', () => {
    const row = normalizeRawPlayerGameLogRow({
      row: {
        game_id: 'g-4',
        player_id: 'p-4',
      },
      season: 2024,
      partitionDate: '2024-11-04',
      nullCoercionCounts: createNullCoercionCounts(),
    });
    expect(row?.game_date).toBe('2024-11-04');
  });

  it('builds dedupe keys as (player_id,game_id)', () => {
    const row = normalizeRawPlayerGameLogRow({
      row: {
        game_id: 'g-5',
        player_id: 'p-5',
      },
      season: 2024,
      partitionDate: '2024-11-05',
      nullCoercionCounts: createNullCoercionCounts(),
    });
    expect(row).not.toBeNull();
    expect(partitionDedupeKey(row!)).toBe('p-5::g-5');
  });
});
