import { describe, expect, it } from 'vitest';
import {
  JUICE_IMPLIED_PROB_THRESHOLD,
  PLAYER_PROP_CONSENSUS_MIN_BOOKS,
  PLAYER_PROP_V1_PROP_TYPES,
  PLAYER_PROP_V1_VENDORS,
  americanOddsToImpliedProbability,
  canonicalizePropType,
  classifyPropMovement,
  displayPropType,
  findAmbiguousSimultaneousLineKeys,
  interpolatingMedian,
  isPlayerPropV1PropType,
  isPlayerPropV1Vendor,
  normalizeVendor,
  parseAmericanOdds,
  playerPropApiDisplayLabel,
  playerPropConsensus,
  playerPropMatchKey,
} from '../market-movement';

describe('americanOddsToImpliedProbability', () => {
  it('converts positive American odds', () => {
    expect(americanOddsToImpliedProbability(150)).toBeCloseTo(100 / 250, 10);
  });

  it('converts negative American odds', () => {
    expect(americanOddsToImpliedProbability(-110)).toBeCloseTo(110 / 210, 10);
  });

  it('treats +100 and -100 as even money (0.5)', () => {
    expect(americanOddsToImpliedProbability(100)).toBe(0.5);
    expect(americanOddsToImpliedProbability(-100)).toBe(0.5);
  });

  it('returns null for null, zero, and non-finite', () => {
    expect(americanOddsToImpliedProbability(null)).toBeNull();
    expect(americanOddsToImpliedProbability(undefined)).toBeNull();
    expect(americanOddsToImpliedProbability(0)).toBeNull();
    expect(americanOddsToImpliedProbability(Number.NaN)).toBeNull();
    expect(americanOddsToImpliedProbability(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('parseAmericanOdds treats 0 and malformed as missing', () => {
    expect(parseAmericanOdds(0)).toBeNull();
    expect(parseAmericanOdds(null)).toBeNull();
    expect(parseAmericanOdds('')).toBeNull();
    expect(parseAmericanOdds('abc')).toBeNull();
    expect(parseAmericanOdds(-110)).toBe(-110);
    expect(parseAmericanOdds('+150')).toBe(150);
  });
});

describe('classifyPropMovement (Step 7E taxonomy)', () => {
  const implied110 = americanOddsToImpliedProbability(-110);
  const implied105 = americanOddsToImpliedProbability(-105);
  const implied120 = americanOddsToImpliedProbability(-120);

  it('A Quiet: unchanged line + <2pp juice', () => {
    expect(
      classifyPropMovement({
        referenceLine: 25.5,
        comparisonLine: 25.5,
        referenceOverImplied: implied110,
        comparisonOverImplied: implied105,
        referenceUnderImplied: implied110,
        comparisonUnderImplied: implied105,
      })
    ).toBe('A');
    expect(Math.abs((implied105 ?? 0) - (implied110 ?? 0))).toBeLessThan(JUICE_IMPLIED_PROB_THRESHOLD);
  });

  it('B Juice: unchanged line + >=2pp juice', () => {
    expect(
      classifyPropMovement({
        referenceLine: 25.5,
        comparisonLine: 25.5,
        referenceOverImplied: implied110,
        comparisonOverImplied: implied120,
        referenceUnderImplied: null,
        comparisonUnderImplied: null,
      })
    ).toBe('B');
    expect(Math.abs((implied120 ?? 0) - (implied110 ?? 0))).toBeGreaterThanOrEqual(
      JUICE_IMPLIED_PROB_THRESHOLD
    );
  });

  it('C Line: line changed without material juice', () => {
    expect(
      classifyPropMovement({
        referenceLine: 25.5,
        comparisonLine: 26.5,
        referenceOverImplied: implied110,
        comparisonOverImplied: implied105,
        referenceUnderImplied: implied110,
        comparisonUnderImplied: implied105,
      })
    ).toBe('C');
  });

  it('D Line+Price: line changed + material juice', () => {
    expect(
      classifyPropMovement({
        referenceLine: 25.5,
        comparisonLine: 26.5,
        referenceOverImplied: implied110,
        comparisonOverImplied: implied120,
        referenceUnderImplied: null,
        comparisonUnderImplied: null,
      })
    ).toBe('D');
  });

  it('unclassified when a line is missing', () => {
    expect(
      classifyPropMovement({
        referenceLine: null,
        comparisonLine: 25.5,
        referenceOverImplied: 0.5,
        comparisonOverImplied: 0.5,
        referenceUnderImplied: null,
        comparisonUnderImplied: null,
      })
    ).toBe('unclassified');
  });
});

describe('interpolatingMedian / playerPropConsensus', () => {
  it('odd count: 25.5, 26.5, 26.5 → 26.5', () => {
    expect(interpolatingMedian([25.5, 26.5, 26.5])).toBe(26.5);
  });

  it('even count: 25.5, 26.5 → 26.0 (not necessarily an offered line)', () => {
    expect(interpolatingMedian([25.5, 26.5])).toBe(26);
  });

  it('requires at least 2 eligible books', () => {
    expect(PLAYER_PROP_CONSENSUS_MIN_BOOKS).toBe(2);
    const one = playerPropConsensus([{ vendor: 'betmgm', line: 25.5 }]);
    expect(one.available).toBe(false);
    expect(one.median).toBeNull();
    expect(one.count).toBe(1);
    expect(one.reason).toBe('insufficient_books');

    const two = playerPropConsensus([
      { vendor: 'betmgm', line: 25.5 },
      { vendor: 'fanduel', line: 26.5 },
    ]);
    expect(two.available).toBe(true);
    if (two.available) {
      expect(two.median).toBe(26);
      expect(two.min).toBe(25.5);
      expect(two.max).toBe(26.5);
      expect(two.count).toBe(2);
    }
  });

  it('does not manufacture numbers from null lines', () => {
    const out = playerPropConsensus([
      { vendor: 'betmgm', line: null },
      { vendor: 'fanduel', line: 25.5 },
    ]);
    expect(out.available).toBe(false);
    expect(out.median).toBeNull();
    expect(out.count).toBe(1);
  });

  it('does not count unsupported vendors toward v1 consensus', () => {
    const out = playerPropConsensus([
      { vendor: 'betmgm', line: 25.5 },
      { vendor: 'betrivers', line: 24.5 },
      { vendor: 'fanatics', line: 27.5 },
    ]);
    expect(out.available).toBe(false);
    expect(out.count).toBe(1);
    expect(out.min).toBeNull();
  });

  it('preserves min/max range across four v1 books', () => {
    const out = playerPropConsensus([
      { vendor: 'BetMGM', line: 25.5 },
      { vendor: 'FanDuel', line: 26.5 },
      { vendor: 'DraftKings', line: 26.5 },
      { vendor: 'Caesars', line: 25.5 },
    ]);
    expect(out.available).toBe(true);
    if (out.available) {
      expect(out.min).toBe(25.5);
      expect(out.max).toBe(26.5);
      expect(out.count).toBe(4);
      expect(out.median).toBe(26);
    }
  });
});

describe('vendor / prop normalization', () => {
  it('canonicalizes approved v1 vendors without fuzzy matching', () => {
    for (const v of PLAYER_PROP_V1_VENDORS) {
      expect(isPlayerPropV1Vendor(v)).toBe(true);
    }
    expect(normalizeVendor('BetMGM')?.canonical).toBe('betmgm');
    expect(normalizeVendor('FanDuel')?.canonical).toBe('fanduel');
    expect(normalizeVendor('DraftKings')?.canonical).toBe('draftkings');
    expect(normalizeVendor('Caesars')?.canonical).toBe('caesars');
    expect(normalizeVendor('  FANDUEL  ')?.isPlayerPropV1Vendor).toBe(true);
  });

  it('returns unknown vendors explicitly and does not map Fan Duel', () => {
    const spaced = normalizeVendor('Fan Duel');
    expect(spaced?.canonical).toBe('fan duel');
    expect(spaced?.isPlayerPropV1Vendor).toBe(false);
    expect(normalizeVendor('bet365')?.isPlayerPropV1Vendor).toBe(false);
    expect(normalizeVendor('')).toBeNull();
    expect(normalizeVendor(null)).toBeNull();
  });

  it('canonicalizes v1 props including PRA → points_rebounds_assists', () => {
    for (const p of PLAYER_PROP_V1_PROP_TYPES) {
      expect(isPlayerPropV1PropType(p)).toBe(true);
    }
    expect(canonicalizePropType('points')).toBe('points');
    expect(canonicalizePropType('PTS')).toBe('points');
    expect(canonicalizePropType('PRA')).toBe('points_rebounds_assists');
    expect(canonicalizePropType('pra')).toBe('points_rebounds_assists');
    expect(canonicalizePropType('points_rebounds_assists')).toBe('points_rebounds_assists');
    expect(displayPropType('points_rebounds_assists')).toBe('PRA');
    expect(playerPropApiDisplayLabel('points_rebounds_assists')).toBe('PRA');
    expect(playerPropApiDisplayLabel('threes')).toBe('3-Pointers');
    expect(playerPropApiDisplayLabel('points_rebounds')).toBe('Points + Rebounds');
    expect(playerPropApiDisplayLabel('points_assists')).toBe('Points + Assists');
  });

  it('recognizes non-v1 canonical props without making them v1', () => {
    expect(canonicalizePropType('blocks')).toBe('blocks');
    expect(isPlayerPropV1PropType('blocks')).toBe(false);
    expect(canonicalizePropType('steals')).toBe('steals');
    expect(isPlayerPropV1PropType('steals')).toBe(false);
    expect(canonicalizePropType('rebounds_assists')).toBe('rebounds_assists');
    expect(isPlayerPropV1PropType('rebounds_assists')).toBe(false);
    expect(canonicalizePropType('double_double')).toBeNull();
    expect(canonicalizePropType('triple_double')).toBeNull();
  });
});

describe('ambiguous simultaneous variants', () => {
  it('excludes the whole group when two lines share the same key', () => {
    const keys = findAmbiguousSimultaneousLineKeys([
      { gameId: '1', playerId: '9', vendor: 'betrivers', propType: 'points', line: 24.5 },
      { gameId: '1', playerId: '9', vendor: 'betrivers', propType: 'points', line: 25.5 },
    ]);
    expect(keys.has(playerPropMatchKey({
      gameId: '1',
      playerId: '9',
      vendor: 'betrivers',
      propType: 'points',
    }))).toBe(true);
  });

  it('does not pick min or max as a winner', () => {
    const rows = [
      { gameId: '1', playerId: '9', vendor: 'betrivers', propType: 'points', line: 24.5 },
      { gameId: '1', playerId: '9', vendor: 'betrivers', propType: 'points', line: 26.5 },
    ];
    const keys = findAmbiguousSimultaneousLineKeys(rows);
    expect(keys.size).toBe(1);
    expect(Math.min(24.5, 26.5)).toBe(24.5);
    expect([...keys][0]).not.toContain('24.5');
  });

  it('leaves a single-line group deterministic', () => {
    const keys = findAmbiguousSimultaneousLineKeys([
      { gameId: '1', playerId: '9', vendor: 'betmgm', propType: 'points', line: 25.5 },
      { gameId: '1', playerId: '9', vendor: 'betmgm', propType: 'points', line: 25.5 },
    ]);
    expect(keys.size).toBe(0);
  });
});
