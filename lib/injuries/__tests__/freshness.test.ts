import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INJURY_FRESHNESS_HOURS,
  describeInjuryFeedAvailability,
  filterAuthoritativeInjuries,
  injuryAbsenceCopy,
  isFrozenInjuryServing,
  isInjuryAuthoritativeForServing,
  isInjurySnapshotFresh,
  resolveInjuryFreshnessHours,
} from '@/lib/injuries/freshness';

const liveEnv = {
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
} as NodeJS.ProcessEnv;

const freezeEnv = {
  DATA_MODE: 'replay',
  OFFSEASON_MODE: '1',
  CRON_DRY_RUN: '1',
} as NodeJS.ProcessEnv;

const now = new Date('2026-09-06T18:00:00.000Z');
const freshAt = '2026-09-05T12:00:00.000Z';
const staleAt = '2026-05-06T18:00:27.355Z';

describe('injury freshness policy', () => {
  it('defaults missing or invalid INJURY_FRESHNESS_HOURS to 36', () => {
    expect(resolveInjuryFreshnessHours(undefined)).toBe(DEFAULT_INJURY_FRESHNESS_HOURS);
    expect(resolveInjuryFreshnessHours('')).toBe(36);
    expect(resolveInjuryFreshnessHours('nope')).toBe(36);
    expect(resolveInjuryFreshnessHours('0')).toBe(36);
    expect(resolveInjuryFreshnessHours('-4')).toBe(36);
    expect(resolveInjuryFreshnessHours('12')).toBe(12);
  });

  it('fresh current injury is authoritative in live mode', () => {
    expect(isInjurySnapshotFresh(freshAt, liveEnv, now)).toBe(true);
    expect(
      isInjuryAuthoritativeForServing(
        { snapshotAt: freshAt, status: 'Out' },
        liveEnv,
        now
      )
    ).toBe(true);
  });

  it('stale current injury is non-authoritative', () => {
    expect(isInjurySnapshotFresh(staleAt, liveEnv, now)).toBe(false);
    expect(
      isInjuryAuthoritativeForServing(
        { snapshotAt: staleAt, status: 'Out' },
        liveEnv,
        now
      )
    ).toBe(false);
  });

  it('replay/offseason current injury is non-authoritative even when fresh', () => {
    expect(isFrozenInjuryServing(freezeEnv)).toBe(true);
    expect(
      isInjuryAuthoritativeForServing(
        { snapshotAt: freshAt, status: 'Out' },
        freezeEnv,
        now
      )
    ).toBe(false);
  });

  it('invalid snapshot timestamps are non-authoritative', () => {
    expect(isInjurySnapshotFresh('x', liveEnv, now)).toBe(false);
    expect(isInjurySnapshotFresh(null, liveEnv, now)).toBe(false);
  });

  it('omits stale rows from active context', () => {
    const rows = [
      { playerId: 'fresh', snapshotAt: freshAt, status: 'Out' },
      { playerId: 'stale', snapshotAt: staleAt, status: 'Out' },
      { playerId: 'franz', snapshotAt: '2026-05-06T18:00:27.355Z', status: 'Out' },
    ];
    expect(filterAuthoritativeInjuries(rows, liveEnv, now).map((r) => r.playerId)).toEqual([
      'fresh',
    ]);
    expect(filterAuthoritativeInjuries(rows, freezeEnv, now)).toEqual([]);
  });
});

describe('describeInjuryFeedAvailability', () => {
  it('frozen feed is not_current even when there are zero rows', () => {
    expect(
      describeInjuryFeedAvailability({ frozen: true, rawRowCount: 0, authoritativeCount: 0 })
    ).toBe('not_current');
    expect(injuryAbsenceCopy('not_current')).toBe('Injury status not current');
  });

  it('authoritative empty feed is No injuries listed', () => {
    expect(
      describeInjuryFeedAvailability({ frozen: false, rawRowCount: 0, authoritativeCount: 0 })
    ).toBe('authoritative_empty');
    expect(injuryAbsenceCopy('authoritative_empty')).toBe('No injuries listed');
  });

  it('stale leftover rows are not_current, not an empty injury report', () => {
    expect(
      describeInjuryFeedAvailability({ frozen: false, rawRowCount: 3, authoritativeCount: 0 })
    ).toBe('not_current');
  });

  it('authoritative present stays present', () => {
    expect(
      describeInjuryFeedAvailability({ frozen: false, rawRowCount: 2, authoritativeCount: 2 })
    ).toBe('authoritative_present');
  });
});
