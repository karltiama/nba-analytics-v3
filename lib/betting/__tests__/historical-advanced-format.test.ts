import { describe, expect, it } from 'vitest';
import { emptyPlayerAdvanced } from '@/lib/betting/historical-advanced';
import {
  ADVANCED_MISSING,
  advancedMetricsUnavailable,
  formatAdvancedNet,
  formatAdvancedPace,
  formatAdvancedPercent,
  formatAdvancedPossessions,
  formatAdvancedRating,
  formatAdvancedRow,
  formatAdvancedTurnoverRatio,
} from '@/lib/betting/historical-advanced-format';

describe('historical Advanced formatters', () => {
  it('formats certified 0–1 fractions as percents', () => {
    expect(formatAdvancedPercent(0.284)).toBe('28.4%');
    expect(formatAdvancedPercent(0)).toBe('0.0%');
  });

  it('does not clamp TS% above 100%', () => {
    expect(formatAdvancedPercent(1.5)).toBe('150.0%');
  });

  it('formats signed net rating', () => {
    expect(formatAdvancedNet(8.4)).toBe('+8.4');
    expect(formatAdvancedNet(-5.2)).toBe('-5.2');
    expect(formatAdvancedNet(0)).toBe('0.0');
  });

  it('uses the missing-value convention for null and non-finite', () => {
    expect(formatAdvancedPercent(null)).toBe(ADVANCED_MISSING);
    expect(formatAdvancedPercent(Number.NaN)).toBe(ADVANCED_MISSING);
    expect(formatAdvancedRating(undefined)).toBe(ADVANCED_MISSING);
    expect(formatAdvancedNet(Number.POSITIVE_INFINITY)).toBe(ADVANCED_MISSING);
    expect(formatAdvancedRow(null).usg).toBe(ADVANCED_MISSING);
    expect(formatAdvancedRow(null).net).toBe(ADVANCED_MISSING);
    expect(JSON.stringify(formatAdvancedRow(null))).not.toMatch(/NaN/i);
  });

  it('does not percent-format turnover ratio', () => {
    expect(formatAdvancedTurnoverRatio(5.3)).toBe('5.3');
    expect(formatAdvancedTurnoverRatio(5.3)).not.toContain('%');
    expect(formatAdvancedRow({ ...emptyPlayerAdvanced(), turnoverRatio: 5.3 }).tov).toBe('5.3');
  });

  it('formats possessions as integers and pace to one decimal', () => {
    expect(formatAdvancedPossessions(85)).toBe('85');
    expect(formatAdvancedPossessions(84.4)).toBe('84');
    expect(formatAdvancedPace(91.22)).toBe('91.2');
    expect(formatAdvancedRating(122.4)).toBe('122.4');
  });

  it('treats all-null serving rows as missing, not zeros', () => {
    expect(advancedMetricsUnavailable(emptyPlayerAdvanced())).toBe(true);
    expect(formatAdvancedRow(emptyPlayerAdvanced()).usg).toBe(ADVANCED_MISSING);
    expect(formatAdvancedRow(emptyPlayerAdvanced()).ortg).toBe(ADVANCED_MISSING);
    expect(formatAdvancedRow({ ...emptyPlayerAdvanced(), usagePercentage: 0 }).usg).toBe('0.0%');
  });
});
