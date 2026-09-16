import { describe, expect, it } from 'vitest';
import { canonicalizeXrayMarket } from '../market';

describe('canonicalizeXrayMarket', () => {
  it.each([
    ['points', 'Points', 'points'],
    ['points', 'PTS', 'points'],
    ['rebounds', 'Rebounds', 'rebounds'],
    ['rebounds', 'REB', 'rebounds'],
    ['assists', 'Assists', 'assists'],
    ['assists', 'AST', 'assists'],
    ['threes', '3-Pointers Made', 'threes'],
    ['threes', '3PM', 'threes'],
    ['threes', 'Threes', 'threes'],
    ['points_rebounds', 'PR', 'points_rebounds'],
    ['points_assists', 'PA', 'points_assists'],
    ['rebounds_assists', 'RA', 'rebounds_assists'],
    ['points_rebounds_assists', 'PRA', 'points_rebounds_assists'],
  ] as const)('%s / %s → %s', (kind, label, expected) => {
    expect(canonicalizeXrayMarket(kind, label)).toEqual({
      propType: expected,
      unsupported: false,
      reason: null,
    });
  });

  it('maps label-only PTS/REB/AST/3PM without coercing unknown to points', () => {
    expect(canonicalizeXrayMarket(null, 'PTS').propType).toBe('points');
    expect(canonicalizeXrayMarket(null, 'REB').propType).toBe('rebounds');
    expect(canonicalizeXrayMarket(null, 'AST').propType).toBe('assists');
    expect(canonicalizeXrayMarket(null, '3PM').propType).toBe('threes');
    expect(canonicalizeXrayMarket(null, 'Threes').propType).toBe('threes');
    expect(canonicalizeXrayMarket(null, 'PR').propType).toBe('points_rebounds');
    expect(canonicalizeXrayMarket(null, 'PA').propType).toBe('points_assists');
    expect(canonicalizeXrayMarket(null, 'RA').propType).toBe('rebounds_assists');
    expect(canonicalizeXrayMarket(null, 'PRA').propType).toBe('points_rebounds_assists');
  });

  it('does not silently map unknown labels to points', () => {
    expect(canonicalizeXrayMarket(null, 'First Basket')).toEqual({
      propType: null,
      unsupported: false,
      reason: 'UNKNOWN_MARKET',
    });
  });

  it('marks extractor other / blocks as unsupported rather than points', () => {
    expect(canonicalizeXrayMarket('other', 'Blocks')).toEqual({
      propType: null,
      unsupported: true,
      reason: 'UNSUPPORTED_MARKET',
    });
  });
});
