import { describe, expect, it } from 'vitest';
import { resolveSentimentChartData } from '@/components/betting/MarketSentimentChart';

describe('resolveSentimentChartData', () => {
  it('does not fall back to demo series when no real feed exists', () => {
    const out = resolveSentimentChartData('game-1', null, { allowDemo: false });
    expect(out.mode).toBe('none');
    expect(out.points).toEqual([]);
  });

  it('keeps a real snapshot including a valid home win pct', () => {
    const out = resolveSentimentChartData(
      'game-1',
      { homeWinPct: 55, awayWinPct: 45, source: 'test', history: [] },
      { allowDemo: false }
    );
    expect(out.mode).toBe('snapshot');
    expect(out.points[0].homeWinPct).toBe(55);
  });
});
