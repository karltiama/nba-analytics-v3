import { describe, expect, it } from 'vitest';
import {
  calendarSeasonStartYear,
  getAnalyticsSeason,
  getNbaStatsSeason,
  PINNED_ANALYTICS_SEASON,
  toNbaStatsSeason,
} from '@/lib/season';

function env(partial: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return partial as NodeJS.ProcessEnv;
}

describe('getAnalyticsSeason', () => {
  it('pins fallback to 2025 even when calendar July cutoff is 2026', () => {
    const sep2026 = new Date('2026-09-01T12:00:00.000Z');
    expect(calendarSeasonStartYear(sep2026)).toBe(2026);
    expect(getAnalyticsSeason(env(), sep2026)).toBe(PINNED_ANALYTICS_SEASON);
    expect(getAnalyticsSeason(env(), sep2026)).toBe('2025');
  });

  it('uses CURRENT_ANALYTICS_SEASON over the pin', () => {
    expect(getAnalyticsSeason(env({ CURRENT_ANALYTICS_SEASON: '2026' }))).toBe('2026');
    expect(getAnalyticsSeason(env({ CURRENT_ANALYTICS_SEASON: '2026-27' }))).toBe('2026');
  });

  it('accepts NBA_STATS_SEASON when CURRENT_ANALYTICS_SEASON is unset', () => {
    expect(getAnalyticsSeason(env({ NBA_STATS_SEASON: '2024-25' }))).toBe('2024');
  });

  it('ignores invalid CURRENT_ANALYTICS_SEASON and keeps pin', () => {
    expect(getAnalyticsSeason(env({ CURRENT_ANALYTICS_SEASON: 'nope' }))).toBe('2025');
  });

  it('season env override 2026 wins without changing the fallback pin', () => {
    expect(PINNED_ANALYTICS_SEASON).toBe('2025');
    expect(getAnalyticsSeason(env({ CURRENT_ANALYTICS_SEASON: '2026' }))).toBe('2026');
    expect(getAnalyticsSeason(env())).toBe('2025');
  });
});

describe('toNbaStatsSeason / getNbaStatsSeason', () => {
  it('formats start year as NBA stats season', () => {
    expect(toNbaStatsSeason('2025')).toBe('2025-26');
    expect(getNbaStatsSeason(env({ CURRENT_ANALYTICS_SEASON: '2025' }))).toBe('2025-26');
  });
});

describe('calendarSeasonStartYear', () => {
  it('uses July cutoff', () => {
    expect(calendarSeasonStartYear(new Date('2026-01-15T12:00:00.000Z'))).toBe(2025);
    expect(calendarSeasonStartYear(new Date('2026-06-30T12:00:00.000Z'))).toBe(2025);
    expect(calendarSeasonStartYear(new Date('2026-07-01T12:00:00.000Z'))).toBe(2026);
  });
});
