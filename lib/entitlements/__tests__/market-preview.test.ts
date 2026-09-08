import { describe, expect, it } from 'vitest';
import { formatMarketRangePreview } from '../market-preview';

describe('formatMarketRangePreview', () => {
  it('formats book count and min/max without naming a best book', () => {
    expect(formatMarketRangePreview(7, 10.5, 11.5)).toBe('7 books · market range 10.5–11.5');
    expect(formatMarketRangePreview(1, 22.5, 22.5)).toBe('1 book · market range 22.5–22.5');
    expect(formatMarketRangePreview(3, null, 11.5)).toBe('3 books');
  });
});
