import { describe, expect, it } from 'vitest';
import {
  calendarSeasonStartYear,
  formatNbaSeasonLabel,
  getAnalyticsSeason,
  getLiveAvailabilitySeason,
  getRosterSeason,
  getNbaStatsSeason,
  PINNED_ANALYTICS_SEASON,
  shouldShowCurrentAvailability,
  toNbaStatsSeason,
} from '@/lib/season';

function env(partial: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return partial as NodeJS.ProcessEnv;
}

describe('getAnalyticsSeason', () => {
  it('pins fallback to 2026 regardless of the calendar', () => {
    const sep2026 = new Date('2026-09-01T12:00:00.000Z');
    expect(calendarSeasonStartYear(sep2026)).toBe(2026);
    expect(getAnalyticsSeason(env(), sep2026)).toBe(PINNED_ANALYTICS_SEASON);
    expect(getAnalyticsSeason(env(), sep2026)).toBe('2026');
  });

  it('uses CURRENT_ANALYTICS_SEASON over the pin', () => {
    expect(getAnalyticsSeason(env({ CURRENT_ANALYTICS_SEASON: '2026' }))).toBe('2026');
    expect(getAnalyticsSeason(env({ CURRENT_ANALYTICS_SEASON: '2026-27' }))).toBe('2026');
  });

  it('accepts NBA_STATS_SEASON when CURRENT_ANALYTICS_SEASON is unset', () => {
    expect(getAnalyticsSeason(env({ NBA_STATS_SEASON: '2024-25' }))).toBe('2024');
  });

  it('ignores invalid CURRENT_ANALYTICS_SEASON and keeps pin', () => {
    expect(getAnalyticsSeason(env({ CURRENT_ANALYTICS_SEASON: 'nope' }))).toBe('2026');
  });

  it('season env override wins without changing the fallback pin', () => {
    expect(PINNED_ANALYTICS_SEASON).toBe('2026');
    expect(getAnalyticsSeason(env({ CURRENT_ANALYTICS_SEASON: '2025' }))).toBe('2025');
    expect(getAnalyticsSeason(env())).toBe('2026');
  });
});

describe('toNbaStatsSeason / getNbaStatsSeason / formatNbaSeasonLabel', () => {
  it('formats start year as NBA stats season', () => {
    expect(toNbaStatsSeason('2025')).toBe('2025-26');
    expect(getNbaStatsSeason(env({ CURRENT_ANALYTICS_SEASON: '2025' }))).toBe('2025-26');
  });

  it('formats display labels with an en dash', () => {
    expect(formatNbaSeasonLabel('2025')).toBe('2025–26');
    expect(formatNbaSeasonLabel('2026')).toBe('2026–27');
  });
});

describe('calendarSeasonStartYear', () => {
  it('uses July cutoff', () => {
    expect(calendarSeasonStartYear(new Date('2026-01-15T12:00:00.000Z'))).toBe(2025);
    expect(calendarSeasonStartYear(new Date('2026-06-30T12:00:00.000Z'))).toBe(2025);
    expect(calendarSeasonStartYear(new Date('2026-07-01T12:00:00.000Z'))).toBe(2026);
  });
});

describe('roster season', () => {
  it('uses the calendar season, independent of the stats pin', () => {
    const oct2026 = new Date('2026-10-21T12:00:00.000Z');
    expect(getRosterSeason({} as NodeJS.ProcessEnv, oct2026)).toBe('2026');
    expect(getAnalyticsSeason({} as NodeJS.ProcessEnv, oct2026)).toBe('2026');
    expect(PINNED_ANALYTICS_SEASON).toBe('2026');
  });

  it('accepts CURRENT_ROSTER_SEASON without moving the analytics pin', () => {
    const env = { CURRENT_ROSTER_SEASON: '2027-28' } as NodeJS.ProcessEnv;
    expect(getRosterSeason(env, new Date('2026-01-15T12:00:00.000Z'))).toBe('2027');
    expect(getAnalyticsSeason(env)).toBe('2026');
  });
});

describe('live availability season (injuries)', () => {
  it('uses calendar season, not Production pin', () => {
    const sep2026 = new Date('2026-09-05T12:00:00.000Z');
    expect(getLiveAvailabilitySeason({} as NodeJS.ProcessEnv, sep2026)).toBe('2026');
    expect(getAnalyticsSeason({} as NodeJS.ProcessEnv, sep2026)).toBe('2026');
    expect(
      shouldShowCurrentAvailability(
        '2025',
        getLiveAvailabilitySeason({} as NodeJS.ProcessEnv, sep2026)
      )
    ).toBe(false);
  });
});
