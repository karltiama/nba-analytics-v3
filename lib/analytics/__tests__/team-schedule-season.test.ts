import { describe, expect, it } from 'vitest';
import { PINNED_ANALYTICS_SEASON } from '@/lib/season';
import {
  filterScheduleRowsToSeason,
  resolveTeamScheduleSeason,
} from '@/lib/analytics/team-schedule-season';

describe('resolveTeamScheduleSeason', () => {
  it('defaults to the analytics pin when season is omitted', () => {
    expect(resolveTeamScheduleSeason(undefined, {})).toBe(PINNED_ANALYTICS_SEASON);
    expect(resolveTeamScheduleSeason(null, {})).toBe('2025');
  });

  it('honors explicit ?season= using NBA start-year parsing', () => {
    expect(resolveTeamScheduleSeason('2026', {})).toBe('2026');
    expect(resolveTeamScheduleSeason('2025-26', {})).toBe('2025');
    expect(resolveTeamScheduleSeason('2026-27', {})).toBe('2026');
  });

  it('does not use calendar year when pin is 2025', () => {
    expect(resolveTeamScheduleSeason(undefined, {})).toBe('2025');
    expect(resolveTeamScheduleSeason(undefined, {})).not.toBe('2026');
  });
});

describe('filterScheduleRowsToSeason', () => {
  const mixed = [
    { game_id: 'f1', season: '2025' },
    { game_id: 's1', season: '2026' },
    { game_id: 'f2', season: '2025' },
  ];

  it('keeps only 2026 rows — 2025 Finals cannot leak', () => {
    const out = filterScheduleRowsToSeason(mixed, '2026');
    expect(out.map((g) => g.game_id)).toEqual(['s1']);
    expect(out.every((g) => g.season === '2026')).toBe(true);
  });

  it('keeps only 2025 rows — 2026 scheduled games cannot leak', () => {
    const out = filterScheduleRowsToSeason(mixed, '2025');
    expect(out.map((g) => g.game_id)).toEqual(['f1', 'f2']);
    expect(out.every((g) => g.season === '2025')).toBe(true);
  });
});
