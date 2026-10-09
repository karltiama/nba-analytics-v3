import { describe, expect, it } from 'vitest';
import {
  isFinalStatus,
  looksLikeTipoffOrDatetimeStatus,
  normalizeGameStatus,
  resolveDisplayGameStatus,
  resolveGameLifecycle,
  displayGameStatusLabel,
} from '@/lib/betting/normalize-game-status';
import { formatTipoffEt } from '@/lib/betting/format-tipoff-et';

describe('normalizeGameStatus', () => {
  it('keeps Final as Final', () => {
    expect(normalizeGameStatus('Final')).toBe('Final');
    expect(isFinalStatus('Final')).toBe(true);
  });

  it('normalizes tipoff-style future status to Scheduled', () => {
    expect(normalizeGameStatus('2026-10-22T23:30:00Z')).toBe('Scheduled');
    expect(normalizeGameStatus('7:00 pm ET')).toBe('Scheduled');
    expect(normalizeGameStatus('7:30 PM')).toBe('Scheduled');
    expect(looksLikeTipoffOrDatetimeStatus('7:00 pm ET')).toBe(true);
  });

  it('keeps Scheduled / In Progress / Postponed / Canceled distinguishable', () => {
    expect(normalizeGameStatus('Scheduled')).toBe('Scheduled');
    expect(normalizeGameStatus('InProgress')).toBe('In Progress');
    expect(normalizeGameStatus('In Progress')).toBe('In Progress');
    expect(normalizeGameStatus('Postponed')).toBe('Postponed');
    expect(normalizeGameStatus('Cancelled')).toBe('Canceled');
    expect(normalizeGameStatus('Canceled')).toBe('Canceled');
  });

  it('does not guess on ambiguous non-tipoff strings', () => {
    expect(normalizeGameStatus('Delayed by weather')).toBe('Unknown');
  });

  it('maps empty/null raw status to Unknown at the normalize layer', () => {
    expect(normalizeGameStatus('')).toBe('Unknown');
    expect(normalizeGameStatus(null)).toBe('Unknown');
  });
});

describe('resolveDisplayGameStatus', () => {
  const now = new Date('2026-09-06T18:00:00.000Z');

  it('keeps a known Final as Final', () => {
    expect(
      resolveDisplayGameStatus({
        statusRaw: 'Final',
        startTime: '2025-04-11T23:00:00Z',
        homeScore: 126,
        awayScore: 142,
        now,
      })
    ).toBe('Final');
  });

  it('keeps a future tipoff-style status as Scheduled', () => {
    expect(
      resolveDisplayGameStatus({
        statusRaw: '2026-11-01T00:00:00Z',
        startTime: '2026-11-01T00:00:00Z',
        homeScore: 0,
        awayScore: 0,
        now,
      })
    ).toBe('Scheduled');
  });

  it('does not treat a past tipoff ISO as Scheduled or invent Final from 0-0', () => {
    expect(
      resolveDisplayGameStatus({
        statusRaw: '2026-05-06T23:00:00Z',
        startTime: '2026-05-06 23:00:00+00',
        homeScore: 0,
        awayScore: 0,
        now,
      })
    ).toBe('Unknown');
  });

  it('does not fabricate Final merely because the start time is in the past', () => {
    expect(
      resolveDisplayGameStatus({
        statusRaw: 'Scheduled',
        startTime: '2026-05-06T23:00:00Z',
        homeScore: null,
        awayScore: null,
        now,
      })
    ).toBe('Unknown');
  });

  it('promotes proven non-zero scores to Final when status is leftover tipoff', () => {
    expect(
      resolveDisplayGameStatus({
        statusRaw: '2026-04-11T23:00:00Z',
        startTime: '2026-04-11T23:00:00Z',
        homeScore: 110,
        awayScore: 98,
        now,
      })
    ).toBe('Final');
  });

  it('keeps In Progress / Postponed / Canceled', () => {
    expect(resolveDisplayGameStatus({ statusRaw: 'In Progress', now })).toBe('In Progress');
    expect(resolveDisplayGameStatus({ statusRaw: 'Postponed', now })).toBe('Postponed');
    expect(resolveDisplayGameStatus({ statusRaw: 'Canceled', now })).toBe('Canceled');
  });

  it('never shows a live quarter with nonzero scores as Final', () => {
    for (const statusRaw of ['1st Qtr', '2nd Qtr', 'End of 3rd Qtr', '4th Qtr', 'Halftime', 'OT', '2OT', 'End of OT']) {
      expect(
        resolveDisplayGameStatus({ statusRaw, startTime: '2026-09-06T17:00:00Z', homeScore: 55, awayScore: 50, now })
      ).toBe('In Progress');
    }
  });

  it('does not promote a recent leftover-tipoff row to Final from scores alone', () => {
    expect(
      resolveDisplayGameStatus({
        statusRaw: '2026-09-06T16:30:00Z',
        startTime: '2026-09-06T16:30:00Z',
        homeScore: 61,
        awayScore: 58,
        now,
      })
    ).toBe('Unknown');
  });
});

describe('resolveGameLifecycle', () => {
  const now = new Date('2026-10-21T01:00:00.000Z');
  const tip = '2026-10-20T23:30:00Z';

  it('distinguishes live, halftime and overtime from status text and period', () => {
    expect(resolveGameLifecycle({ statusRaw: '2nd Qtr', startTime: tip, homeScore: 55, awayScore: 50, now })).toBe('live');
    expect(resolveGameLifecycle({ statusRaw: 'Halftime', startTime: tip, homeScore: 60, awayScore: 58, now })).toBe('halftime');
    expect(resolveGameLifecycle({ statusRaw: 'OT', startTime: tip, now })).toBe('overtime');
    expect(resolveGameLifecycle({ statusRaw: '2OT', startTime: tip, now })).toBe('overtime');
    expect(resolveGameLifecycle({ statusRaw: '4th Qtr', period: 5, startTime: tip, now })).toBe('overtime');
  });

  it('prefers a recognised status_state over the status string', () => {
    expect(resolveGameLifecycle({ statusRaw: '7:30 pm ET', statusState: 'in_progress', period: 2, now })).toBe('live');
    expect(resolveGameLifecycle({ statusRaw: 'Halftime', statusState: 'in_progress', now })).toBe('halftime');
    expect(resolveGameLifecycle({ statusRaw: '4th Qtr', statusState: 'in_progress', period: 6, now })).toBe('overtime');
    expect(resolveGameLifecycle({ statusRaw: '4th Qtr', statusState: 'final', now })).toBe('final');
    expect(resolveGameLifecycle({ statusRaw: tip, statusState: 'scheduled', now })).toBe('scheduled');
    expect(resolveGameLifecycle({ statusRaw: 'Final', statusState: 'postponed', now })).toBe('postponed');
    expect(resolveGameLifecycle({ statusRaw: 'Delayed', statusState: 'delayed', now })).toBe('unknown');
  });

  it('ignores unrecognised status_state values and falls back to status', () => {
    expect(resolveGameLifecycle({ statusRaw: '3rd Qtr', statusState: 'unknown', startTime: tip, now })).toBe('live');
    expect(resolveGameLifecycle({ statusRaw: '3rd Qtr', statusState: 'bogus', startTime: tip, now })).toBe('live');
  });

  it('treats timestamp-valued legacy statuses as scheduled before tip', () => {
    expect(resolveGameLifecycle({ statusRaw: '2026-10-22T23:00:00Z', homeScore: 0, awayScore: 0, now })).toBe('scheduled');
    expect(resolveGameLifecycle({ statusRaw: '2026-10-22T23:00:00Z', startTime: '2026-10-22T23:00:00Z', now })).toBe('scheduled');
  });

  it('preserves actual Final results, including overtime finals', () => {
    expect(resolveGameLifecycle({ statusRaw: 'Final', startTime: tip, homeScore: 0, awayScore: 0, now })).toBe('final');
    expect(resolveGameLifecycle({ statusRaw: 'Final/OT', startTime: tip, homeScore: 120, awayScore: 118, now })).toBe('final');
  });

  it('honours the provider postponed flag and keeps ambiguous strings unknown', () => {
    expect(resolveGameLifecycle({ statusRaw: tip, postponed: true, now })).toBe('postponed');
    expect(resolveGameLifecycle({ statusRaw: 'Delayed by weather', startTime: tip, homeScore: 20, awayScore: 18, now })).toBe('unknown');
  });
});

describe('ingestion classification is unchanged', () => {
  it('isFinalStatus stays exact: live, halftime, overtime and Final/OT are not ingestion-final', () => {
    for (const s of ['2nd Qtr', 'Halftime', 'OT', 'End of 4th Qtr', 'Final/OT', '2026-10-22T23:00:00Z']) {
      expect(isFinalStatus(s)).toBe(false);
    }
    expect(isFinalStatus('Final')).toBe(true);
  });

  it('maps live period strings to In Progress without touching Final', () => {
    expect(normalizeGameStatus('2nd Qtr')).toBe('In Progress');
    expect(normalizeGameStatus('End of 3rd Qtr')).toBe('In Progress');
    expect(normalizeGameStatus('2OT')).toBe('In Progress');
    expect(normalizeGameStatus('Other')).toBe('Unknown');
    expect(normalizeGameStatus('Final/OT')).toBe('Unknown');
  });
});

describe('displayGameStatusLabel', () => {
  it('renders Unknown as Status unavailable', () => {
    expect(displayGameStatusLabel('Unknown')).toBe('Status unavailable');
    expect(displayGameStatusLabel('Final')).toBe('Final');
    expect(displayGameStatusLabel('Scheduled')).toBe('Scheduled');
  });
});

describe('formatTipoffEt', () => {
  it('formats tipoff in America/New_York regardless of host local TZ', () => {
    // 2026-10-22 23:30 UTC = 7:30 PM EDT
    const s = formatTipoffEt('2026-10-22T23:30:00.000Z');
    expect(s).toMatch(/7:30\s*PM/i);
    expect(s).toMatch(/EDT|EST/);
  });
});
