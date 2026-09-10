import { describe, expect, it } from 'vitest';
import {
  formatHitFraction,
  formatHitRate,
  formatMarketClaim,
  formatSignedNumber,
  formatSocialVerdictLabel,
  formatVerdictLabel,
  playerInitials,
} from '../format';

describe('formatMarketClaim', () => {
  it('formats over/under with line and market', () => {
    expect(formatMarketClaim('over', 27.5, 'points')).toBe('Over 27.5 Points');
    expect(formatMarketClaim('under', 8.5, 'assists')).toBe('Under 8.5 Assists');
    expect(formatMarketClaim('over', 3, 'threes')).toBe('Over 3 Threes');
  });
});

describe('formatHitRate', () => {
  it('renders 0–1 rates as whole-number percents', () => {
    expect(formatHitRate(0.8)).toBe('80%');
    expect(formatHitRate(0.48)).toBe('48%');
    expect(formatHitRate(1)).toBe('100%');
    expect(formatHitRate(0)).toBe('0%');
  });

  it('renders non-finite rates as an em dash', () => {
    expect(formatHitRate(Number.NaN)).toBe('—');
    expect(formatHitRate(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatHitFraction', () => {
  it('renders hits over games', () => {
    expect(formatHitFraction(4, 5)).toBe('4/5');
    expect(formatHitFraction(22, 46)).toBe('22/46');
  });
});

describe('formatSocialVerdictLabel', () => {
  it('uses Instagram public labels rather than betting commands', () => {
    expect(formatSocialVerdictLabel('supports')).toBe('Context Supports');
    expect(formatSocialVerdictLabel('mixed')).toBe('Mixed Context');
    expect(formatSocialVerdictLabel('pushes_back')).toBe('Context Pushes Back');
    expect(formatSocialVerdictLabel('insufficient')).toBe('Not Enough Context');
  });
});

describe('formatSignedNumber', () => {
  it('prefixes positives', () => {
    expect(formatSignedNumber(2.4)).toBe('+2.4');
    expect(formatSignedNumber(-2.7)).toBe('-2.7');
    expect(formatSignedNumber(0)).toBe('0.0');
  });
});

describe('playerInitials', () => {
  it('uses first and last name', () => {
    expect(playerInitials('Jalen Brunson')).toBe('JB');
    expect(playerInitials('Shai Gilgeous-Alexander')).toBe('SG');
  });
});
