import { describe, expect, it } from 'vitest';
import { quotesFromBdlOddsRow } from '@/lib/betting/game-odds-from-bdl';
import {
  applyGameOddsObservation,
  certifyGameOddsClose,
  classifySportsbookCoverage,
  estimateInjuriesOddsRequestBudget,
  firstObservedLabel,
  gameOddsMarketKey,
  type BookMarketState,
  type GameOddsQuote,
} from '@/lib/betting/game-odds-lifecycle';

function quote(partial: Partial<GameOddsQuote> & Pick<GameOddsQuote, 'market'>): GameOddsQuote {
  return {
    gameId: '21717856',
    vendor: 'draftkings',
    homeMoneyline: -140,
    awayMoneyline: 120,
    homeSpread: -3.5,
    awaySpread: 3.5,
    homeSpreadOdds: -110,
    awaySpreadOdds: -110,
    total: 224.5,
    overOdds: -110,
    underOdds: -110,
    providerUpdatedAt: '2026-10-19T12:00:00.000Z',
    observedAt: '2026-10-19T12:01:00.000Z',
    ...partial,
  };
}

describe('game odds from BDL row', () => {
  it('maps moneyline, spread, and total without inventing the missing side', () => {
    const quotes = quotesFromBdlOddsRow(
      {
        game_id: 21717856,
        vendor: 'fanduel',
        moneyline_home_odds: -150,
        moneyline_away_odds: null,
        total_value: '225.5',
        total_over_odds: -108,
        total_under_odds: null,
        spread_home_value: '-4.5',
        spread_away_value: '4.5',
        spread_home_odds: -110,
        updated_at: '2026-10-19T15:00:00Z',
      },
      '2026-10-19T15:00:05.000Z'
    );
    const ml = quotes.find((q) => q.market === 'moneyline')!;
    expect(ml.homeMoneyline).toBe(-150);
    expect(ml.awayMoneyline).toBeNull();
    expect(ml.providerUpdatedAt).toBe('2026-10-19T15:00:00Z');
    expect(ml.observedAt).toBe('2026-10-19T15:00:05.000Z');
    expect(quotes.find((q) => q.market === 'total')!.total).toBe(225.5);
    expect(quotes.find((q) => q.market === 'spread')!.homeSpread).toBe(-4.5);
  });
});

describe('First Observed immutability', () => {
  it('keeps First Observed at 224.5 while Current moves 225 then 226', () => {
    const store = new Map<string, BookMarketState>();
    const a = applyGameOddsObservation(store, quote({ market: 'total', total: 224.5, observedAt: 't1' }));
    const b = applyGameOddsObservation(store, quote({ market: 'total', total: 225.0, observedAt: 't2' }));
    const c = applyGameOddsObservation(store, quote({ market: 'total', total: 226.0, observedAt: 't3' }));
    expect(a.action).toBe('first_observed');
    expect(b.action).toBe('current_update');
    expect(c.action).toBe('current_update');
    const state = store.get(gameOddsMarketKey('21717856', 'draftkings', 'total'))!;
    expect(state.firstObserved.total).toBe(224.5);
    expect(state.current.total).toBe(226.0);
    expect(firstObservedLabel()).toBe('First Observed');
  });

  it('gives a later sportsbook its own First Observed, not the other book’s time', () => {
    const store = new Map<string, BookMarketState>();
    applyGameOddsObservation(
      store,
      quote({ market: 'total', vendor: 'draftkings', total: 224.5, observedAt: 't-dk' })
    );
    applyGameOddsObservation(
      store,
      quote({ market: 'total', vendor: 'fanduel', total: 225.0, observedAt: 't-fd' })
    );
    const dk = store.get(gameOddsMarketKey('21717856', 'draftkings', 'total'))!;
    const fd = store.get(gameOddsMarketKey('21717856', 'fanduel', 'total'))!;
    expect(dk.firstObserved.observedAt).toBe('t-dk');
    expect(dk.firstObserved.total).toBe(224.5);
    expect(fd.firstObserved.observedAt).toBe('t-fd');
    expect(fd.firstObserved.total).toBe(225.0);
  });
});

describe('game odds isolation', () => {
  it('accepts a partial market (ML without total) as First Observed', () => {
    const store = new Map<string, BookMarketState>();
    const ml = applyGameOddsObservation(
      store,
      quote({ market: 'moneyline', total: null, overOdds: null, underOdds: null })
    );
    const tot = applyGameOddsObservation(
      store,
      quote({ market: 'total', total: null, overOdds: null, underOdds: null, homeMoneyline: null, awayMoneyline: null })
    );
    expect(ml.action).toBe('first_observed');
    expect(tot.action).toBe('skipped_empty');
  });

  it('classifies one book vs multi-book vs empty', () => {
    expect(classifySportsbookCoverage([])).toBe('NO_CURRENT_MARKET');
    expect(classifySportsbookCoverage(['draftkings'])).toBe('SINGLE_BOOK_ONLY');
    expect(classifySportsbookCoverage(['draftkings', 'fanduel'])).toBe('MULTI_BOOK_READY');
  });

  it('skips unknown game IDs and malformed prices without poisoning the store', () => {
    const store = new Map<string, BookMarketState>();
    const unknown = applyGameOddsObservation(
      store,
      quote({ market: 'total', gameId: '999' }),
      { knownGameIds: new Set(['21717856']) }
    );
    const bad = applyGameOddsObservation(store, quote({ market: 'total', total: Number.NaN }));
    expect(unknown.action).toBe('skipped_unknown_game');
    expect(bad.action).toBe('skipped_malformed');
    expect(store.size).toBe(0);
  });

  it('does not treat no-odds-yet as a failure', () => {
    expect(classifySportsbookCoverage([])).toBe('NO_CURRENT_MARKET');
  });
});

describe('Close protection', () => {
  it('keeps a certified Close when Current later changes', () => {
    const store = new Map<string, BookMarketState>();
    applyGameOddsObservation(store, quote({ market: 'total', total: 224.5, observedAt: 't1' }));
    const key = gameOddsMarketKey('21717856', 'draftkings', 'total');
    const closed = certifyGameOddsClose(store, key, {
      gameStatus: 'Scheduled',
      tipTime: '2026-10-20T23:00:00.000Z',
      now: new Date('2026-10-20T20:00:00.000Z'),
    });
    expect(closed.ok).toBe(true);
    applyGameOddsObservation(store, quote({ market: 'total', total: 228.0, observedAt: 't-late' }));
    const state = store.get(key)!;
    expect(state.close?.total).toBe(224.5);
    expect(state.current.total).toBe(228.0);
    expect(state.firstObserved.total).toBe(224.5);
  });

  it('refuses to certify Close after tip / In Progress', () => {
    const store = new Map<string, BookMarketState>();
    applyGameOddsObservation(store, quote({ market: 'total', total: 224.5 }));
    const key = gameOddsMarketKey('21717856', 'draftkings', 'total');
    expect(
      certifyGameOddsClose(store, key, {
        gameStatus: 'In Progress',
        tipTime: '2026-10-20T23:00:00.000Z',
        now: new Date('2026-10-20T23:05:00.000Z'),
      }).ok
    ).toBe(false);
    expect(store.get(key)!.close).toBeNull();
  });
});

describe('request budget', () => {
  it('sizes a 10-game slate at the 13s safety rate without props', () => {
    const staged = estimateInjuriesOddsRequestBudget({
      injuryPagesPerPull: 2,
      injuryPullsPerDay: 3,
      oddsRequestsPerCycle: 2,
      oddsCyclesPerDay: 4 + 24 + 18,
      intervalMs: 13_000,
    });
    expect(staged.injuryRequestsPerDay).toBe(6);
    expect(staged.oddsRequestsPerDay).toBe(92);
    expect(staged.totalRequestsPerDay).toBe(98);
    expect(staged.elapsedMsAtSafetyRate).toBe(98 * 13_000);
  });
});
