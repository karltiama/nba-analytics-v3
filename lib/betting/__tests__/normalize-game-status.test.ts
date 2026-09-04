import { describe, expect, it } from 'vitest';
import {
  isFinalStatus,
  looksLikeTipoffOrDatetimeStatus,
  normalizeGameStatus,
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
});

describe('formatTipoffEt', () => {
  it('formats tipoff in America/New_York regardless of host local TZ', () => {
    // 2026-10-22 23:30 UTC = 7:30 PM EDT
    const s = formatTipoffEt('2026-10-22T23:30:00.000Z');
    expect(s).toMatch(/7:30\s*PM/i);
    expect(s).toMatch(/EDT|EST/);
  });
});
