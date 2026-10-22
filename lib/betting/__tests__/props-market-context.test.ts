import { describe, expect, it } from 'vitest';
import {
  etCalendarDateFromInstant,
  gameHasStarted,
  PREGAME_LINE_LABEL,
  LATEST_OBSERVED_LINE_LABEL,
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
    expect(LATEST_OBSERVED_LINE_LABEL).toBe('Latest observed line');
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

describe('gameHasStarted', () => {
  const now = new Date('2026-10-21T23:00:00.000Z');

  it('treats a tip at or before now as started and leaves a future tip unstarted', () => {
    expect(PREGAME_LINE_LABEL).toBe('Pregame line');
    expect(gameHasStarted('2026-10-21T23:00:00.000Z', now)).toBe(true);
    expect(gameHasStarted('2026-10-21T22:59:00.000Z', now)).toBe(true);
    expect(gameHasStarted(now, now)).toBe(true);
    expect(gameHasStarted('2026-10-21T23:00:01.000Z', now)).toBe(false);
    expect(gameHasStarted(null, now)).toBe(false);
    expect(gameHasStarted('not-a-date', now)).toBe(false);
  });
});

describe('etCalendarDateFromInstant', () => {
  it('maps instants onto America/New_York calendar dates', () => {
    expect(etCalendarDateFromInstant('2026-05-06T23:30:00.000Z')).toBe('2026-05-06');
  });
});
