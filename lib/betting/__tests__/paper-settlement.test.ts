import { describe, expect, it } from 'vitest';
import {
  evaluateOverUnder,
  profitUnitsForSettlement,
  profitUnitsOnWinAmerican,
  statActualForPropType,
} from '../paper-settlement';

describe('paper-settlement', () => {
  it('profitUnitsOnWinAmerican +110', () => {
    expect(profitUnitsOnWinAmerican(110, 1)).toBeCloseTo(1.1);
  });
  it('profitUnitsOnWinAmerican -110', () => {
    expect(profitUnitsOnWinAmerican(-110, 1)).toBeCloseTo(100 / 110);
  });
  it('profitUnitsForSettlement loss', () => {
    expect(profitUnitsForSettlement('loss', -110, 1)).toBe(-1);
  });
  it('statActualForPropType points', () => {
    const o = { pts: 28, reb: 5, ast: 3, threes: 2, pra: 36, pa: 31, pr: 33, ra: 8 };
    expect(statActualForPropType('points', o)).toBe(28);
    expect(statActualForPropType('pra', o)).toBe(36);
  });
  it('evaluateOverUnder', () => {
    expect(evaluateOverUnder('over', 24.5, 30)).toBe('win');
    expect(evaluateOverUnder('under', 24.5, 20)).toBe('win');
    expect(evaluateOverUnder('over', 24.5, 24.5)).toBe('push');
  });
});
