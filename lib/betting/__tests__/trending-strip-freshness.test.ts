import { describe, expect, it } from 'vitest';
import {
  TRENDING_STRIP_MAX_AGE_DAYS,
  trendingStripCutoff,
  trendingStripFreshness,
} from '@/lib/betting/trending-strip-freshness';

// 2026-11-03 11:00 ET
const NOW = new Date('2026-11-03T16:00:00Z');

describe('Recent form strip freshness', () => {
  it('cutoff is the ET date the max age before today', () => {
    expect(TRENDING_STRIP_MAX_AGE_DAYS).toBe(10);
    expect(trendingStripCutoff(NOW)).toBe('2026-10-24');
    // 01:00 UTC on Nov 4 is still Nov 3 in ET.
    expect(trendingStripCutoff(new Date('2026-11-04T01:00:00Z'))).toBe('2026-10-24');
  });

  it("last season's final game is stale", () => {
    expect(trendingStripFreshness('2026-06-13', NOW)).toEqual({
      through: '2026-06-13',
      cutoff: '2026-10-24',
      stale: true,
    });
  });

  it('no stored games is stale', () => {
    expect(trendingStripFreshness(null, NOW).stale).toBe(true);
  });

  it('games on or after the cutoff are fresh', () => {
    expect(trendingStripFreshness('2026-11-02', NOW).stale).toBe(false);
    expect(trendingStripFreshness('2026-10-24', NOW).stale).toBe(false);
    expect(trendingStripFreshness('2026-10-23', NOW).stale).toBe(true);
  });
});
