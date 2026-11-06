import { describe, expect, it } from 'vitest';
import {
  bestSingleBook,
  computeParlayTrueCost,
  computeTrueCostLeg,
  formatDollars,
  type BookLegQuote,
} from '../true-cost';
import { isBestBookViewEnabled, quotesForLegs } from '../true-cost-quotes';

function standardLegs(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `leg-${i}`, priceAmerican: -110, oppositeAmerican: -110 }));
}

describe('computeTrueCostLeg', () => {
  it('devigs a −110/−110 market to 50% with ~4.8% hold', () => {
    const leg = computeTrueCostLeg({ id: 'a', priceAmerican: -110, oppositeAmerican: -110 });
    expect(leg.impliedProbability).toBeCloseTo(110 / 210, 10);
    expect(leg.fair.status).toBe('known');
    if (leg.fair.status !== 'known') return;
    expect(leg.fair.probability).toBeCloseTo(0.5, 10);
    expect(leg.fair.hold).toBeCloseTo(220 / 210 - 1, 10);
    expect(leg.fair.houseEdge).toBeCloseTo(1 - 0.5 * (1 + 100 / 110), 10);
    expect(leg.heavyFavorite).toBe(false);
  });

  it('uses q_side / (q_side + q_other) for uneven prices', () => {
    const leg = computeTrueCostLeg({ id: 'a', priceAmerican: -150, oppositeAmerican: 125 });
    const qSide = 150 / 250;
    const qOther = 100 / 225;
    expect(leg.fair.status).toBe('known');
    if (leg.fair.status !== 'known') return;
    expect(leg.fair.probability).toBeCloseTo(qSide / (qSide + qOther), 10);
    expect(leg.fair.hold).toBeCloseTo(qSide + qOther - 1, 10);
  });

  it('returns unknown, not a guess, when the opposite side is missing', () => {
    const leg = computeTrueCostLeg({ id: 'a', priceAmerican: -110 });
    expect(leg.fair).toEqual({ status: 'unknown', reason: 'MISSING_OPPOSITE_SIDE' });
    expect(leg.impliedProbability).toBeCloseTo(110 / 210, 10);
  });

  it('flags heavy favorites at −300 or shorter', () => {
    expect(computeTrueCostLeg({ id: 'a', priceAmerican: -300, oppositeAmerican: 240 }).heavyFavorite).toBe(true);
    expect(computeTrueCostLeg({ id: 'b', priceAmerican: -450, oppositeAmerican: 330 }).heavyFavorite).toBe(true);
    expect(computeTrueCostLeg({ id: 'c', priceAmerican: -299, oppositeAmerican: 240 }).heavyFavorite).toBe(false);
  });

  it('treats impossible American prices as invalid', () => {
    expect(computeTrueCostLeg({ id: 'a', priceAmerican: 50, oppositeAmerican: -110 }).fair).toEqual({
      status: 'unknown',
      reason: 'INVALID_PRICE',
    });
    expect(computeTrueCostLeg({ id: 'a', priceAmerican: -110, oppositeAmerican: 0 }).fair).toEqual({
      status: 'unknown',
      reason: 'INVALID_PRICE',
    });
  });
});

describe('computeParlayTrueCost', () => {
  it.each([
    [2, 0.089, 0.0005],
    [3, 0.13, 0.001],
    [4, 0.169, 0.001],
  ])('%i-leg −110 parlay has about the expected house edge', (n, edge, tol) => {
    const result = computeParlayTrueCost(standardLegs(n));
    expect(result.fair.status).toBe('known');
    if (result.fair.status !== 'known' || result.book.status !== 'known') throw new Error('expected known');
    expect(Math.abs(result.fair.houseEdge - edge)).toBeLessThan(tol);
    expect(result.fair.evPerDollar).toBeCloseTo(-result.fair.houseEdge, 12);
    expect(result.fair.probability).toBeCloseTo(0.5 ** n, 12);
    expect(result.book.decimal).toBeCloseTo((1 + 100 / 110) ** n, 10);
    expect(result.book.breakEvenHitRate).toBeCloseTo(1 / (1 + 100 / 110) ** n, 10);
  });

  it('reports book and fair American odds for a 2-leg −110 parlay', () => {
    const result = computeParlayTrueCost(standardLegs(2));
    if (result.fair.status !== 'known' || result.book.status !== 'known') throw new Error('expected known');
    expect(result.book.american).toBe(264);
    expect(result.fair.american).toBe(300);
    expect(result.fair.decimal).toBeCloseTo(4, 10);
  });

  it('house edge rises with leg count (approx. 1 − 0.9545^n)', () => {
    const edges = [2, 3, 4].map((n) => {
      const r = computeParlayTrueCost(standardLegs(n));
      return r.fair.status === 'known' ? r.fair.houseEdge : NaN;
    });
    expect(edges[0]!).toBeLessThan(edges[1]!);
    expect(edges[1]!).toBeLessThan(edges[2]!);
  });

  it('marks fair odds unknown and names the leg when an opposite side is missing', () => {
    const result = computeParlayTrueCost([
      { id: 'a', priceAmerican: -110, oppositeAmerican: -110 },
      { id: 'b', priceAmerican: 120, oppositeAmerican: null },
    ]);
    expect(result.book.status).toBe('known');
    expect(result.fair).toEqual({ status: 'unknown', reason: 'MISSING_OPPOSITE_SIDE', legIds: ['b'] });
  });

  it('marks the book payout unknown when a leg has no price', () => {
    const result = computeParlayTrueCost([
      { id: 'a', priceAmerican: -110, oppositeAmerican: -110 },
      { id: 'b', priceAmerican: null, oppositeAmerican: -110 },
    ]);
    expect(result.book).toEqual({ status: 'unknown', reason: 'MISSING_PRICE' });
    expect(result.fair.status).toBe('unknown');
  });

  it('returns NO_LEGS for an empty slip', () => {
    const result = computeParlayTrueCost([]);
    expect(result.book).toEqual({ status: 'unknown', reason: 'NO_LEGS' });
    expect(result.fair).toEqual({ status: 'unknown', reason: 'NO_LEGS', legIds: [] });
  });

  it('handles mixed prices', () => {
    const legs = [
      { id: 'fav', priceAmerican: -350, oppositeAmerican: 260 },
      { id: 'dog', priceAmerican: 150, oppositeAmerican: -180 },
      { id: 'even', priceAmerican: -115, oppositeAmerican: -105 },
    ];
    const result = computeParlayTrueCost(legs);
    if (result.fair.status !== 'known' || result.book.status !== 'known') throw new Error('expected known');

    const q = (a: number) => (a < 0 ? -a / (-a + 100) : 100 / (a + 100));
    const d = (a: number) => (a < 0 ? 1 + 100 / -a : 1 + a / 100);
    const pFair = legs.reduce((acc, l) => acc * (q(l.priceAmerican) / (q(l.priceAmerican) + q(l.oppositeAmerican))), 1);
    const dBook = legs.reduce((acc, l) => acc * d(l.priceAmerican), 1);

    expect(result.fair.probability).toBeCloseTo(pFair, 12);
    expect(result.book.decimal).toBeCloseTo(dBook, 12);
    expect(result.fair.houseEdge).toBeCloseTo(1 - pFair * dBook, 12);
    expect(result.fair.evPerDollar).toBeCloseTo(pFair * dBook - 1, 12);
    expect(result.legs.map((l) => l.heavyFavorite)).toEqual([true, false, false]);
  });
});

describe('bestSingleBook', () => {
  const q = (vendor: string, priceAmerican: number | null): BookLegQuote => ({
    vendor,
    displayName: vendor.toUpperCase(),
    priceAmerican,
    oppositeAmerican: null,
  });

  it('picks the one book with the best combined price, skipping books missing a leg', () => {
    const quotesPerLeg = [
      [q('draftkings', -110), q('fanduel', -105), q('betmgm', 100)],
      [q('draftkings', -110), q('fanduel', -105)],
    ];
    const result = bestSingleBook({
      quotesPerLeg,
      fairProbability: 0.25,
      currentVendor: 'draftkings',
      currentDecimal: null,
    });
    expect(result.status).toBe('known');
    if (result.status !== 'known') return;
    expect(result.books.map((b) => b.vendor)).toEqual(['fanduel', 'draftkings']);
    expect(result.best.vendor).toBe('fanduel');
    expect(result.current?.vendor).toBe('draftkings');
    const dk = (1 + 100 / 110) ** 2;
    const fd = (1 + 100 / 105) ** 2;
    expect(result.best.houseEdge).toBeCloseTo(1 - 0.25 * fd, 12);
    expect(result.houseEdgeDifference).toBeCloseTo(0.25 * (fd - dk), 12);
    expect(result.best.extraPayoutPer100).toBeCloseTo((fd - dk) * 100, 10);
  });

  it('leaves house edge unknown when fair probability is unknown', () => {
    const result = bestSingleBook({
      quotesPerLeg: [[q('fanduel', -105)]],
      fairProbability: null,
      currentVendor: 'fanduel',
      currentDecimal: null,
    });
    if (result.status !== 'known') throw new Error('expected known');
    expect(result.best.houseEdge).toBeNull();
    expect(result.houseEdgeDifference).toBeNull();
  });

  it('returns unknown when no single book prices every leg', () => {
    const result = bestSingleBook({
      quotesPerLeg: [[q('fanduel', -105)], [q('draftkings', -110)]],
      fairProbability: 0.25,
      currentVendor: null,
      currentDecimal: null,
    });
    expect(result).toEqual({ status: 'unknown', reason: 'NO_BOOK_PRICES_EVERY_LEG' });
  });

  it('compares against the slip price when the user book is not in current prices', () => {
    const result = bestSingleBook({
      quotesPerLeg: [[q('fanduel', -105)], [q('fanduel', -105)]],
      fairProbability: 0.25,
      currentVendor: 'caesars',
      currentDecimal: (1 + 100 / 110) ** 2,
    });
    if (result.status !== 'known') throw new Error('expected known');
    expect(result.current).toBeNull();
    expect(result.houseEdgeDifference).toBeCloseTo(0.25 * ((1 + 100 / 105) ** 2 - (1 + 100 / 110) ** 2), 12);
  });
});

describe('formatDollars', () => {
  it('formats signed amounts', () => {
    expect(formatDollars(8.9)).toBe('$8.90');
    expect(formatDollars(-3.25)).toBe('−$3.25');
    expect(formatDollars(1234.5)).toBe('$1,235');
  });
});


describe('quotesForLegs', () => {
  const leg = { gameId: '101', playerId: '7', market: 'points', side: 'over' as const, line: 24.5 };
  const row = (sportsbook: string, side: string, odds: number, extra: Record<string, unknown> = {}) => ({
    game_id: 101,
    player_id: '7',
    sportsbook,
    prop_type: 'points',
    side,
    line_value: '24.5',
    odds_american: odds,
    ...extra,
  });

  it('pairs each book side with its opposite and ignores other lines and unsupported books', () => {
    const quotes = quotesForLegs(
      [leg],
      [
        row('draftkings', 'over', -115),
        row('draftkings', 'under', -105),
        row('FanDuel', 'Over', -110),
        row('betmgm', 'over', -120, { line_value: '25.5' }),
        row('somebook', 'over', 100),
      ]
    );
    expect(quotes).toEqual([
      [
        { vendor: 'draftkings', displayName: expect.any(String), priceAmerican: -115, oppositeAmerican: -105 },
        { vendor: 'fanduel', displayName: expect.any(String), priceAmerican: -110, oppositeAmerican: null },
      ],
    ]);
  });

  it('matches prop aliases and returns an empty list for unpriced legs', () => {
    const quotes = quotesForLegs(
      [leg, { ...leg, playerId: '8' }],
      [row('caesars', 'over', -112, { prop_type: 'player_points' })]
    );
    expect(quotes[0]!.map((q) => q.vendor)).toEqual(['caesars']);
    expect(quotes[1]).toEqual([]);
  });
});

describe('isBestBookViewEnabled', () => {
  it('defaults on and turns off with 0/false/off', () => {
    expect(isBestBookViewEnabled(undefined)).toBe(true);
    expect(isBestBookViewEnabled('1')).toBe(true);
    expect(isBestBookViewEnabled('0')).toBe(false);
    expect(isBestBookViewEnabled('off')).toBe(false);
  });
});
