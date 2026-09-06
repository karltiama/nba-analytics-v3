import { describe, expect, it } from 'vitest';
import {
  formatNullableStat,
  formatStatDiffVsAvg,
  hasSummarySample,
} from '../stat-display';

describe('formatNullableStat', () => {
  it('renders a real zero', () => {
    expect(formatNullableStat(0)).toBe('0.0');
  });

  it('renders missing sample as an em dash', () => {
    expect(formatNullableStat(null)).toBe('—');
    expect(formatNullableStat(undefined)).toBe('—');
  });
});

describe('formatStatDiffVsAvg', () => {
  it('returns null when either side is missing', () => {
    expect(formatStatDiffVsAvg(null, 20)).toBeNull();
    expect(formatStatDiffVsAvg(22, null)).toBeNull();
  });

  it('formats a real zero vs avg without inventing a sample', () => {
    expect(formatStatDiffVsAvg(0, 0)).toBe('0.0 vs avg');
  });
});

describe('hasSummarySample', () => {
  it('is false when avg is null', () => {
    expect(hasSummarySample({ avg: null })).toBe(false);
  });

  it('is true for a real zero average', () => {
    expect(hasSummarySample({ avg: 0 })).toBe(true);
  });
});
