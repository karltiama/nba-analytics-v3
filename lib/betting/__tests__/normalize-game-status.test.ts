import { describe, expect, it } from 'vitest';
import {
  isFinalStatus,
  looksLikeTipoffOrDatetimeStatus,
  normalizeGameStatus,
  resolveDisplayGameStatus,
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
