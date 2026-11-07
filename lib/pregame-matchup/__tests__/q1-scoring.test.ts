import { describe, expect, it } from 'vitest';
import { buildStarterQ1, starterPlayerIds, type Q1GameRow } from '../q1-scoring';

const row = (playerId: string, season: string, date: string, q1Points: number, gameId = date): Q1GameRow => ({
  playerId,
  season,
  date,
  gameId,
  q1Points,
});

const base = { season: '2026', seasonLabel: '2026-27', previousSeasonLabel: '2025-26' };

describe('buildStarterQ1', () => {
  it('averages this season, lists the last five newest first, and keeps last season separate', () => {
    const rows = [
      row('7', '2026', '2026-10-21', 4),
      row('7', '2026', '2026-10-23', 0),
      row('7', '2026', '2026-10-25', 9),
      row('7', '2026', '2026-10-27', 6),
      row('7', '2026', '2026-10-29', 11),
      row('7', '2026', '2026-10-31', 2),
      row('7', '2025', '2026-01-10', 5),
      row('7', '2025', '2026-01-12', 8),
    ];
    const model = buildStarterQ1({ ...base, playerIds: ['7'], rows })!;
    expect(model.players['7']).toEqual({
      current: { games: 6, avg: 5.3, lastN: [2, 11, 6, 9, 0] },
      previous: { games: 2, avg: 6.5 },
    });
  });

  it('handles a player with only last season, and one with nothing', () => {
    const model = buildStarterQ1({ ...base, playerIds: ['7', '8'], rows: [row('7', '2025', '2026-02-01', 3)] })!;
    expect(model.players['7']).toEqual({ current: null, previous: { games: 1, avg: 3 } });
    expect(model.players['8']).toEqual({ current: null, previous: null });
  });

  it('ignores seasons older than last season and returns null when nobody has games', () => {
    expect(buildStarterQ1({ ...base, playerIds: ['7'], rows: [row('7', '2024', '2025-01-01', 9)] })).toBeNull();
  });
});

describe('starterPlayerIds', () => {
  it('collects the likely five and regulars back, once each', () => {
    expect(
      starterPlayerIds({
        teams: [
          { likely: [{ playerId: '1', replaces: null }, { playerId: '2', replaces: { playerId: '9' } }], regularsBack: [{ playerId: '3' }] },
          { likely: null, regularsBack: [{ playerId: '1' }] },
        ],
      })
    ).toEqual(['1', '2', '3']);
  });
});
