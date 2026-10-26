import { describe, expect, it } from 'vitest';
import type { ScoreboardSeasonType } from '@/lib/scoreboard/contract';
import { expectedSeasonTypes, scoreboardDateCoverage, type ScoreboardCoverage } from '@/lib/scoreboard/coverage';
import { SCOREBOARD_POLICY } from '@/lib/scoreboard/planner';
import { SCOREBOARD_DISCOVERY_STALE_SLACK_MS } from '@/lib/scoreboard/response';

const DEFAULT_NOW = new Date('2026-10-23T23:18:00-04:00');

function at(now: Date, offsetMs: number): string {
  return new Date(now.getTime() + offsetMs).toISOString();
}

function cover(
  date: string,
  clocks: Partial<Record<ScoreboardSeasonType, string | null>>,
  now: Date = DEFAULT_NOW
): ScoreboardCoverage {
  return scoreboardDateCoverage({ date, now, lastRequestBySeasonType: clocks });
}

describe('expectedSeasonTypes', () => {
  it('uses preseason before opening night, regular after, and both postseason types once the floor exists', () => {
    expect(expectedSeasonTypes('2026-10-15')).toEqual(['preseason']);
    expect(expectedSeasonTypes('2026-10-20')).toEqual(['regular']);
    expect(expectedSeasonTypes('2026-10-23')).toEqual(['regular']);
    expect(expectedSeasonTypes('2026-04-14')).toEqual(['playin', 'playoffs']);
  });

  it('returns null when the regular-season open is missing, or the postseason floor is missing on/after April 1', () => {
    expect(expectedSeasonTypes('2030-12-01')).toBeNull();
    expect(expectedSeasonTypes('2027-03-31')).toEqual(['regular']);
    expect(expectedSeasonTypes('2027-04-01')).toBeNull();
    expect(expectedSeasonTypes('2027-05-01')).toBeNull();
  });
});

describe('scoreboardDateCoverage', () => {
  const fresh = at(DEFAULT_NOW, -5 * 60_000);
  const bound = SCOREBOARD_POLICY.DISCOVERY_INTERVAL_MS + SCOREBOARD_DISCOVERY_STALE_SLACK_MS;

  it('1 covers today when the regular clock is fresh', () => {
    expect(cover('2026-10-23', { regular: fresh })).toEqual({ state: 'covered', last_games_request_at: fresh });
  });

  it('2 covers tomorrow from the same request window', () => {
    expect(cover('2026-10-24', { regular: fresh }).state).toBe('covered');
  });

  it('3 does not cover the day after tomorrow', () => {
    expect(cover('2026-10-25', { regular: fresh })).toEqual({ state: 'not_collected', last_games_request_at: null });
  });

  it('4 treats a clock older than the discovery bound as not collected', () => {
    const stale = at(DEFAULT_NOW, -(3 * 60 + 11) * 60_000);
    expect(cover('2026-10-23', { regular: stale }).state).toBe('not_collected');
  });

  it('5 treats a clock inside the discovery bound as covered, including the exact bound', () => {
    const inside = at(DEFAULT_NOW, -(3 * 60 + 9) * 60_000);
    const exact = at(DEFAULT_NOW, -bound);
    expect(cover('2026-10-23', { regular: inside }).state).toBe('covered');
    expect(cover('2026-10-23', { regular: exact }).state).toBe('covered');
    expect(cover('2026-10-23', { regular: at(DEFAULT_NOW, -bound - 1) }).state).toBe('not_collected');
  });

  it('6 ignores a fresh clock of the wrong season type', () => {
    expect(cover('2026-10-23', { preseason: fresh }).state).toBe('not_collected');
  });

  it('7 is not collected when no clock exists for today', () => {
    expect(cover('2026-10-23', {})).toEqual({ state: 'not_collected', last_games_request_at: null });
  });

  it('8 is unknown for a past date outside the request window', () => {
    expect(cover('2026-10-21', { regular: fresh })).toEqual({ state: 'unknown', last_games_request_at: null });
  });

  it('9 covers a preseason date from a preseason clock', () => {
    const now = new Date('2026-10-15T21:00:00-04:00');
    const clock = '2026-10-15T20:00:00-04:00';
    expect(cover('2026-10-15', { preseason: clock }, now)).toEqual({
      state: 'covered',
      last_games_request_at: clock,
    });
  });

  it('10 requires a regular clock on opening day', () => {
    const now = new Date('2026-10-20T12:00:00-04:00');
    const clock = at(now, -5 * 60_000);
    expect(cover('2026-10-20', { preseason: clock }, now).state).toBe('not_collected');
  });

  it('11 keeps yesterday’s late request covering the new ET today', () => {
    const now = new Date('2026-10-24T00:20:00-04:00');
    const clock = '2026-10-23T23:30:00-04:00';
    expect(cover('2026-10-24', { regular: clock }, now)).toEqual({
      state: 'covered',
      last_games_request_at: clock,
    });
  });

  it('12 does not let that same request cover the new tomorrow', () => {
    const now = new Date('2026-10-24T00:20:00-04:00');
    const clock = '2026-10-23T23:30:00-04:00';
    expect(cover('2026-10-25', { regular: clock }, now).state).toBe('not_collected');
  });

  it('13 covers a fresh regular clock on the DST fallback day', () => {
    const now = new Date('2026-11-01T10:00:00-05:00');
    const clock = at(now, -5 * 60_000);
    expect(cover('2026-11-01', { regular: clock }, now)).toEqual({
      state: 'covered',
      last_games_request_at: clock,
    });
  });

  it('14 is unknown on/after the missing 2026 postseason floor', () => {
    const now = new Date('2027-05-01T12:00:00-04:00');
    const clock = at(now, -5 * 60_000);
    expect(cover('2027-05-01', { regular: clock }, now)).toEqual({
      state: 'unknown',
      last_games_request_at: null,
    });
  });

  it('15 is unknown when the season has no calendar entry', () => {
    expect(cover('2030-12-01', { regular: fresh, preseason: fresh, playin: fresh, playoffs: fresh })).toEqual({
      state: 'unknown',
      last_games_request_at: null,
    });
  });

  it('uses the oldest fresh clock when play-in and playoffs both have to be checked', () => {
    const now = new Date('2026-04-14T18:00:00-04:00');
    const older = '2026-04-14T15:00:00-04:00';
    const newer = '2026-04-14T17:30:00-04:00';
    expect(cover('2026-04-14', { playin: newer, playoffs: older }, now)).toEqual({
      state: 'covered',
      last_games_request_at: older,
    });
    expect(cover('2026-04-14', { playin: newer }, now).state).toBe('not_collected');
  });
});
