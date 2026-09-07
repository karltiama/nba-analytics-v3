import { describe, expect, it } from 'vitest';
import {
  etCalendarDateFromInstant,
  propsLineLabel,
  propsServingSource,
  resolvePropsMarketContext,
  shouldBlockActivePaperBet,
} from '../props-market-context';

describe('resolvePropsMarketContext', () => {
  it('selects historical source for dates before today ET', () => {
    expect(resolvePropsMarketContext({ dateEt: '2026-05-06', todayEt: '2026-09-06' })).toBe(
      'historical'
    );
    expect(propsServingSource('historical')).toBe('research.prop_decision_lines');
    expect(propsLineLabel('historical')).toBe('Historical closing line');
    expect(propsLineLabel('historical')).not.toMatch(/current|live/i);
  });

  it('selects live/current source for today and future ET dates', () => {
    expect(resolvePropsMarketContext({ dateEt: '2026-09-06', todayEt: '2026-09-06' })).toBe('live');
    expect(resolvePropsMarketContext({ dateEt: '2026-09-07', todayEt: '2026-09-06' })).toBe('live');
    expect(propsServingSource('live')).toBe('analytics.player_props_current');
    expect(propsLineLabel('live')).toBe('Current market');
  });
});

describe('shouldBlockActivePaperBet', () => {
  it('blocks completed historical games', () => {
    expect(
      shouldBlockActivePaperBet({
        gameStartTime: '2026-05-06T23:30:00.000Z',
        gameStatus: 'Final',
        todayEt: '2026-09-06',
      })
    ).toBe(true);
    expect(
      shouldBlockActivePaperBet({
        gameStartTime: '2026-05-01T23:30:00.000Z',
        gameStatus: 'Scheduled',
        todayEt: '2026-09-06',
      })
    ).toBe(true);
  });

  it('does not block a future-dated scheduled game', () => {
    expect(
      shouldBlockActivePaperBet({
        gameStartTime: '2026-09-07T23:30:00.000Z',
        gameStatus: 'Scheduled',
        todayEt: '2026-09-06',
      })
    ).toBe(false);
  });
});

describe('etCalendarDateFromInstant', () => {
  it('maps instants onto America/New_York calendar dates', () => {
    expect(etCalendarDateFromInstant('2026-05-06T23:30:00.000Z')).toBe('2026-05-06');
  });
});
