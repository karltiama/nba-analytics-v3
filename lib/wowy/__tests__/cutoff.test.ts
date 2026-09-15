import { describe, expect, it } from 'vitest';
import { isOnOrAfterCutoff, isUsableWowyPrior } from '../cutoff';

describe('ET basketball-date cutoff', () => {
  it('requires both a strictly earlier tipoff and an earlier ET date', () => {
    const cutoff = '2024-01-16T17:00:00.000Z';
    expect(isUsableWowyPrior('2024-01-14T00:00:00.000Z', cutoff)).toBe(true);
    expect(isUsableWowyPrior(cutoff, cutoff)).toBe(false);
    expect(isUsableWowyPrior('2024-01-17T00:00:00.000Z', cutoff)).toBe(false);
  });

  it('excludes same ET date even when start_time is strictly before cutoff', () => {
    const cutoff = '2024-01-16T17:00:00.000Z';
    const sameEtEarlierInstant = '2024-01-16T16:00:00.000Z';
    expect(Date.parse(sameEtEarlierInstant)).toBeLessThan(Date.parse(cutoff));
    expect(isUsableWowyPrior(sameEtEarlierInstant, cutoff)).toBe(false);
    expect(isOnOrAfterCutoff(sameEtEarlierInstant, cutoff)).toBe(true);
  });

  it('treats late-night UTC as the previous ET basketball date', () => {
    expect(isUsableWowyPrior('2024-01-16T03:30:00.000Z', '2024-01-16T17:00:00.000Z')).toBe(true);
  });
});
