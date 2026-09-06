import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INJURY_RAW_RETENTION_DAYS,
  resolveInjuryRawRetentionDays,
} from '@/lib/injuries/retention';

describe('injury raw retention recommendation', () => {
  it('defaults to 7 days', () => {
    expect(DEFAULT_INJURY_RAW_RETENTION_DAYS).toBe(7);
    expect(resolveInjuryRawRetentionDays(undefined)).toBe(7);
    expect(resolveInjuryRawRetentionDays('')).toBe(7);
    expect(resolveInjuryRawRetentionDays('0')).toBe(7);
    expect(resolveInjuryRawRetentionDays('3')).toBe(3);
    expect(resolveInjuryRawRetentionDays('nope')).toBe(7);
  });
});
