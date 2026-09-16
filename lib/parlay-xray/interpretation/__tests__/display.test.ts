import { describe, expect, it } from 'vitest';
import { formatAvg, formatSportsbookLabel, marketPositionLabel } from '../display';

describe('interpretation display', () => {
  it('formats packet values without probability language', () => {
    expect(formatAvg(14)).toBe('14.0');
    expect(formatSportsbookLabel('draftkings')).toBe('DraftKings');
    expect(marketPositionLabel('BETTER_NUMBER_THAN_CLOSE')).toBe('Better number than close');
    expect(marketPositionLabel('UNKNOWN')).toBe('Close unavailable');
  });
});
