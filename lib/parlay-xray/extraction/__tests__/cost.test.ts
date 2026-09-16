import { describe, expect, it } from 'vitest';
import { estimateCostUsd } from '../cost';

describe('estimateCostUsd', () => {
  it('estimates gpt-4o-mini from token usage and does not invent cost from file size', () => {
    expect(estimateCostUsd({ model: 'gpt-4o-mini', promptTokens: 1_000_000, completionTokens: 1_000_000 })).toBe(0.75);
    expect(estimateCostUsd({ model: 'gpt-4o', promptTokens: 100, completionTokens: 100 })).toBeNull();
    expect(estimateCostUsd({ model: 'gpt-4o-mini', promptTokens: null, completionTokens: 10 })).toBeNull();
  });
});
