import { describe, expect, it } from 'vitest';
import {
  calendarSeasonStartYear,
  getAnalyticsSeason,
  getNbaStatsSeason,
  parseSeasonStartYear,
  PINNED_ANALYTICS_SEASON,
  toNbaStatsSeason,
} from '../season';

describe('season helper', () => {
  it('pins fallback to 2025 even when calendar July cutoff is 2026', () => {
    const sep2026 = new Date('2026-09-01T12:00:00.000Z');
    expect(calendarSeasonStartYear(sep2026)).toBe(2026);
    expect(getAnalyticsSeason({}, sep2026)).toBe(PINNED_ANALYTICS_SEASON);
    expect(getAnalyticsSeason({}, sep2026)).toBe('2025');
  });

  it('uses CURRENT_ANALYTICS_SEASON over the pin', () => {
    expect(getAnalyticsSeason({ CURRENT_ANALYTICS_SEASON: '2026' })).toBe('2026');
    expect(getAnalyticsSeason({ CURRENT_ANALYTICS_SEASON: '2026-27' })).toBe('2026');
  });

  it('accepts NBA_STATS_SEASON when CURRENT_ANALYTICS_SEASON is unset', () => {
    expect(getAnalyticsSeason({ NBA_STATS_SEASON: '2024-25' })).toBe('2024');
  });

  it('ignores junk env values', () => {
    expect(parseSeasonStartYear('live')).toBeNull();
    expect(getAnalyticsSeason({ CURRENT_ANALYTICS_SEASON: 'nope' })).toBe('2025');
  });

  it('formats NBA Stats hyphen season', () => {
    expect(toNbaStatsSeason('2025')).toBe('2025-26');
    expect(getNbaStatsSeason({ CURRENT_ANALYTICS_SEASON: '2025' })).toBe('2025-26');
  });

  it('calendar July cutoff: Jan–Jun is prior year', () => {
    expect(calendarSeasonStartYear(new Date('2026-01-15T12:00:00.000Z'))).toBe(2025);
    expect(calendarSeasonStartYear(new Date('2026-06-30T12:00:00.000Z'))).toBe(2025);
    expect(calendarSeasonStartYear(new Date('2026-07-01T12:00:00.000Z'))).toBe(2026);
  });
});
