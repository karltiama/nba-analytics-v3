import { describe, expect, it } from 'vitest';
import { americanToImpliedProb } from '@/lib/betting/odds-utils';
import {
  formatProjectionGap,
  projectionGap,
  rawImpliedProbFromMoneyline,
  twoWayMarketDisplay,
} from '@/lib/betting/market-probability';

describe('americanToImpliedProb (raw, with vig)', () => {
  it('converts favorite and underdog American odds', () => {
    expect(americanToImpliedProb(-145)).toBeCloseTo(145 / 245, 10);
    expect(americanToImpliedProb(125)).toBeCloseTo(100 / 225, 10);
    expect(americanToImpliedProb(-110)).toBeCloseTo(110 / 210, 10);
  });
});

describe('twoWayMarketDisplay (no-vig, sums to 100)', () => {
  it('normalizes NYK +125 / BOS -145 to 43% / 57%', () => {
    const d = twoWayMarketDisplay(125, -145);
    expect(d).not.toBeNull();
    expect(d!.awayPct + d!.homePct).toBe(100);
    expect(d!.awayPct).toBe(43);
    expect(d!.homePct).toBe(57);
    expect(d!.favorite).toBe('home');
    expect(d!.isClose).toBe(false);
  });

  it('treats equal moneylines as 50/50 with no favorite', () => {
    const d = twoWayMarketDisplay(-110, -110);
    expect(d!.awayPct).toBe(50);
    expect(d!.homePct).toBe(50);
    expect(d!.awayPct + d!.homePct).toBe(100);
    expect(d!.favorite).toBeNull();
    expect(d!.isClose).toBe(true);
  });

  it('keeps the sportsbook favorite from raw implied probability', () => {
    const d = twoWayMarketDisplay(135, -160);
    expect(d!.favorite).toBe('home');
    expect(d!.awayPct + d!.homePct).toBe(100);
    expect(d!.homePct).toBeGreaterThan(d!.awayPct);
  });

  it('returns null when a moneyline is missing', () => {
    expect(twoWayMarketDisplay(null, -145)).toBeNull();
    expect(twoWayMarketDisplay(125, null)).toBeNull();
    expect(twoWayMarketDisplay(0, -145)).toBeNull();
    expect(rawImpliedProbFromMoneyline(0)).toBeNull();
    expect(rawImpliedProbFromMoneyline(null)).toBeNull();
  });

  it('keeps displayed percents summing to 100 across a moneyline grid', () => {
    const lines = [-200, -150, -110, 100, 120, 180];
    for (const away of lines) {
      for (const home of lines) {
        const d = twoWayMarketDisplay(away, home);
        expect(d).not.toBeNull();
        expect(d!.awayPct + d!.homePct).toBe(100);
        expect(d!.awayPct).toBeGreaterThanOrEqual(0);
        expect(d!.homePct).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keeps the sportsbook favorite from raw implied even if display rounds to 50/50', () => {
    const d = twoWayMarketDisplay(-110, -108);
    expect(d).not.toBeNull();
    expect(d!.awayPct + d!.homePct).toBe(100);
    expect(d!.favorite).toBe('away');
  });
});

describe('projectionGap', () => {
  it('is projection minus market line', () => {
    expect(projectionGap(30.1, 27.5)).toBeCloseTo(2.6, 10);
    expect(formatProjectionGap(projectionGap(30.1, 27.5)!)).toBe('+2.6');
  });

  it('formats a negative gap', () => {
    expect(projectionGap(24.0, 27.5)).toBeCloseTo(-3.5, 10);
    expect(formatProjectionGap(projectionGap(24.0, 27.5)!)).toBe('-3.5');
  });

  it('formats a zero gap', () => {
    expect(projectionGap(27.5, 27.5)).toBe(0);
    expect(formatProjectionGap(0)).toBe('0.0');
  });

  it('returns null when projection or line is missing', () => {
    expect(projectionGap(null, 27.5)).toBeNull();
    expect(projectionGap(30.1, null)).toBeNull();
    expect(projectionGap(undefined, 27.5)).toBeNull();
    expect(projectionGap(Number.NaN, 27.5)).toBeNull();
  });

  it('treats a real zero projection as 0, not as missing', () => {
    expect(projectionGap(0, 27.5)).toBeCloseTo(-27.5, 10);
    expect(formatProjectionGap(projectionGap(0, 27.5)!)).toBe('-27.5');
  });
});
