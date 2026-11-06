import { describe, expect, it } from 'vitest';
import { canonicalSelectionKey } from '@/lib/bet-slip/selection-key';
import type { CanonicalBetLeg } from '@/lib/bet-slip/types';
import { summarizeSettledPaperPortfolio } from '@/lib/betting/paper-portfolio';
import {
  checkFeedPostLock,
  feedLegState,
  formatFeedRecord,
  gradeFeedLeg,
  gradeFeedParlay,
  summarizeFeedRecord,
  validateFeedLegs,
} from '@/lib/feed/feed-rules';

function leg(over: Partial<CanonicalBetLeg> = {}): CanonicalBetLeg {
  const base = {
    sport: 'nba' as const,
    gameId: '100',
    playerId: '7',
    market: 'points' as const,
    side: 'over' as const,
    line: 20.5,
    ...over,
  };
  return {
    selectionKey: canonicalSelectionKey(base),
    playerName: 'Test Player',
    selectedOdds: -110,
    selectedAt: '2026-11-06T15:00:00.000Z',
    ...base,
    ...over,
  } as CanonicalBetLeg;
}

const STATS = { pts: 25, reb: 8, ast: 4, threes: 3, pra: 37, pa: 29, pr: 33, ra: 12 };
const NOW = new Date('2026-11-06T20:00:00.000Z');

describe('checkFeedPostLock', () => {
  it('accepts when every game is scheduled in the future and returns the earliest tip', () => {
    const out = checkFeedPostLock({
      gameIds: ['100', '200'],
      games: [
        { game_id: '100', start_time: '2026-11-07T00:00:00.000Z', status: 'Scheduled' },
        { game_id: '200', start_time: '2026-11-06T23:30:00.000Z', status: '2026-11-06T23:30:00Z' },
      ],
      now: NOW,
    });
    expect(out).toEqual({ ok: true, firstTipAt: new Date('2026-11-06T23:30:00.000Z') });
  });

  it('rejects a post once any leg has tipped off', () => {
    const out = checkFeedPostLock({
      gameIds: ['100', '200'],
      games: [
        { game_id: '100', start_time: '2026-11-07T00:00:00.000Z', status: 'Scheduled' },
        { game_id: '200', start_time: '2026-11-06T19:59:00.000Z', status: 'Scheduled' },
      ],
      now: NOW,
    });
    expect(out).toEqual({ ok: false, code: 'GAME_STARTED', gameId: '200' });
  });

  it('rejects live and final games even if the start time looks future', () => {
    for (const status of ['1st Qtr', 'Final', 'Halftime']) {
      const out = checkFeedPostLock({
        gameIds: ['100'],
        games: [{ game_id: '100', start_time: '2026-11-07T00:00:00.000Z', status }],
        now: NOW,
      });
      expect(out.ok).toBe(false);
    }
  });

  it('fails closed on a missing game or start time', () => {
    expect(checkFeedPostLock({ gameIds: ['999'], games: [], now: NOW })).toEqual({
      ok: false,
      code: 'GAME_NOT_FOUND',
      gameId: '999',
    });
    expect(
      checkFeedPostLock({
        gameIds: ['100'],
        games: [{ game_id: '100', start_time: null, status: 'Scheduled' }],
        now: NOW,
      }).ok
    ).toBe(false);
  });
});

describe('validateFeedLegs', () => {
  it('requires gradeable markets and a price on every leg', () => {
    expect(validateFeedLegs([leg()])).toBeNull();
    expect(validateFeedLegs([leg({ market: 'blocks' })])?.code).toBe('UNSUPPORTED_MARKET');
    expect(validateFeedLegs([leg({ selectedOdds: null })])?.code).toBe('MISSING_ODDS');
    expect(validateFeedLegs([leg(), leg()])?.code).toBe('DUPLICATE_LEG');
  });
});

describe('gradeFeedLeg', () => {
  it('grades over/under from the box score and voids an unreadable line', () => {
    expect(gradeFeedLeg(leg({ line: 20.5 }), STATS)).toBe('win');
    expect(gradeFeedLeg(leg({ side: 'under', line: 20.5 }), STATS)).toBe('loss');
    expect(gradeFeedLeg(leg({ line: 25 }), STATS)).toBe('push');
    expect(gradeFeedLeg(leg({ market: 'points_rebounds_assists', line: 36.5 }), STATS)).toBe('win');
  });
});

describe('gradeFeedParlay (one post = one record unit)', () => {
  it('all legs win → win at the combined price', () => {
    const g = gradeFeedParlay({ legGrades: ['win', 'win'], legOdds: [100, 100], stakeUnits: 1 });
    expect(g.result).toBe('win');
    expect(g.effectiveOddsAmerican).toBe(300);
    expect(g.profitUnits).toBeCloseTo(3, 6);
  });

  it('any losing leg → loss of one unit', () => {
    const g = gradeFeedParlay({ legGrades: ['win', 'loss', 'void'], legOdds: [100, 100, 100], stakeUnits: 1 });
    expect(g).toEqual({ result: 'loss', profitUnits: -1, effectiveOddsAmerican: null });
  });

  it('a void leg drops out and the price is recomputed from the rest', () => {
    const g = gradeFeedParlay({ legGrades: ['win', 'void', 'win'], legOdds: [100, -110, 100], stakeUnits: 1 });
    expect(g.result).toBe('win');
    expect(g.effectiveOddsAmerican).toBe(300);
  });

  it('a pushed leg drops out like a void', () => {
    const g = gradeFeedParlay({ legGrades: ['push', 'win'], legOdds: [-110, 150], stakeUnits: 1 });
    expect(g.result).toBe('win');
    expect(g.profitUnits).toBeCloseTo(1.5, 6);
  });

  it('every leg void or push → push', () => {
    expect(gradeFeedParlay({ legGrades: ['void', 'push'], legOdds: [100, 100], stakeUnits: 1 })).toEqual({
      result: 'push',
      profitUnits: 0,
      effectiveOddsAmerican: null,
    });
  });
});

describe('feedLegState', () => {
  const base = { leg: leg(), gameHasBoxScore: true, outcome: STATS };
  it('waits until the game is Final and the box score is loaded', () => {
    expect(feedLegState({ ...base, gameStatus: '3rd Qtr' })).toEqual({ kind: 'pending' });
    expect(feedLegState({ ...base, gameStatus: 'Final', gameHasBoxScore: false })).toEqual({ kind: 'pending' });
  });
  it('voids postponed games and players without a box-score row', () => {
    expect(feedLegState({ ...base, gameStatus: 'Postponed' })).toEqual({ kind: 'graded', grade: 'void' });
    expect(feedLegState({ ...base, gameStatus: 'Final', outcome: null })).toEqual({ kind: 'graded', grade: 'void' });
  });
  it('grades a Final leg', () => {
    expect(feedLegState({ ...base, gameStatus: 'Final' })).toEqual({ kind: 'graded', grade: 'win' });
  });
});

describe('summarizeFeedRecord', () => {
  it('matches the paper portfolio math, one row per post', () => {
    const rows = [
      { result: 'win', profitUnits: 3, stakeUnits: 1 },
      { result: 'loss', profitUnits: -1, stakeUnits: 1 },
      { result: 'push', profitUnits: 0, stakeUnits: 1 },
    ];
    const s = summarizeFeedRecord(rows);
    expect(s).toEqual(summarizeSettledPaperPortfolio(rows));
    expect(s.roi).toBeCloseTo(2 / 3, 6);
    expect(formatFeedRecord(s)).toBe('1-1-1');
  });
});
