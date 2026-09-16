import { describe, expect, it } from 'vitest';
import { combinedAmericanOdds, decimalToAmerican, formatCombinedOddsLabel } from '../combined-odds';

describe('combinedAmericanOdds', () => {
  it('returns null when any price is missing', () => {
    expect(combinedAmericanOdds([-110, null, -120])).toBeNull();
    expect(combinedAmericanOdds([])).toBeNull();
    expect(combinedAmericanOdds([0])).toBeNull();
  });

  it('does not report zero when odds are unavailable', () => {
    expect(formatCombinedOddsLabel(null)).toBeNull();
  });

  it('multiplies known American prices', () => {
    const twoMinus110 = combinedAmericanOdds([-110, -110]);
    expect(twoMinus110).not.toBeNull();
    expect(twoMinus110).toBeGreaterThan(0);
    const plus100Twice = combinedAmericanOdds([100, 100]);
    expect(plus100Twice).toBe(300);
  });
});

describe('decimalToAmerican', () => {
  it('maps even money and favorite prices', () => {
    expect(decimalToAmerican(2)).toBe(100);
    expect(decimalToAmerican(1.9090909)).toBe(-110);
  });
});
