import { describe, expect, it } from 'vitest';
import { mapServingRowsToPlayerMarketMovement, summarizePlayerMarketMovementForFree } from '../market-movement-api';
import {
  formatAmericanOdds,
  formatConsensusRange,
  formatImpliedProbabilityDeltaPp,
  formatMarketLine,
  formatSignedLineDelta,
  formatSnapshotQuote,
} from '../market-movement-format';
import {
  MM_EMPTY_TITLE,
  MM_FREE_TITLE,
  MM_PRO_SUBTITLE,
  MM_UNSUPPORTED_TITLE,
  presentPlayerMarketMovement,
  presentedCopyBlob,
  shoppingStillVisible,
} from '../market-movement-present';

const LEGACY_MOVEMENT_LANGUAGE = /\bOpened\b|\bOpening Line\b|\bFirst Print\b|\bMarket Open\b/i;

function servingRow(partial: Record<string, unknown>) {
  return {
    game_id: 'g1',
    player_id: 'p1',
    player_name: 'Test Player',
    prop_type: 'points',
    vendor: 'betmgm',
    reference_kind: '3_hour_pre_tip',
    reference_line: 25.5,
    reference_over_odds: -110,
    reference_under_odds: -110,
    reference_timestamp: '2026-04-10T20:00:00.000Z',
    comparison_kind: 'decision_close',
    comparison_line: 25.5,
    comparison_over_odds: -110,
    comparison_under_odds: -110,
    comparison_timestamp: '2026-04-09T18:00:00.000Z',
    line_delta: 0,
    over_implied_probability_delta: 0,
    under_implied_probability_delta: 0,
    movement_class: 'A',
    ...partial,
  };
}

describe('market-movement-format', () => {
  it('formats odds and missing values with an em dash', () => {
    expect(formatAmericanOdds(-110)).toBe('-110');
    expect(formatAmericanOdds(105)).toBe('+105');
    expect(formatAmericanOdds(null)).toBe('—');
    expect(formatMarketLine(null)).toBe('—');
    expect(formatSignedLineDelta(null)).toBe('—');
    expect(formatSnapshotQuote(null, -110)).toBe('—');
    expect(formatSnapshotQuote(25.5, null)).toBe('25.5');
  });

  it('formats implied-probability deltas as percentage points, not 0.024', () => {
    expect(formatImpliedProbabilityDeltaPp(0.024)).toBe('+2.4 pp');
    expect(formatImpliedProbabilityDeltaPp(-0.062)).toBe('-6.2 pp');
    expect(formatImpliedProbabilityDeltaPp(0)).toBeNull();
    expect(formatImpliedProbabilityDeltaPp(null)).toBeNull();
    expect(formatImpliedProbabilityDeltaPp(Number.NaN)).toBeNull();
  });

  it('formats consensus range without repeating Consensus', () => {
    expect(formatConsensusRange({ min: 25.5, max: 26.5, bookCount: 4 })).toBe(
      '25.5–26.5 range · 4 books'
    );
    expect(formatConsensusRange({ min: 25.5, max: 25.5, bookCount: 2 })).toBe('25.5 · 2 books');
    expect(formatConsensusRange({ min: null, max: 26.5, bookCount: 2 })).toBeNull();
    expect(formatSignedLineDelta(Number.NaN)).toBe('—');
    expect(formatMarketLine(Number.NaN)).toBe('—');
  });
});

describe('presentPlayerMarketMovement', () => {
  it('presents a Pro full result as 3-Hour Pre-Tip → Close', () => {
    const mm = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points',
      rows: [
        servingRow({ vendor: 'betmgm', movement_class: 'A' }),
        servingRow({ vendor: 'fanduel', movement_class: 'A' }),
      ],
    });
    const presented = presentPlayerMarketMovement(mm, 'over');
    expect(presented.state).toBe('pro');
    if (presented.state !== 'pro') return;
    expect(presented.subtitle).toBe(MM_PRO_SUBTITLE);
    expect(presented.referenceKind).toBe('3_hour_pre_tip');
    expect(presented.comparisonKind).toBe('decision_close');
    expect(presented.referenceLabel).toBe('3-Hour Pre-Tip');
    expect(presented.comparisonLabel).toBe('Close');
    expect(presentedCopyBlob(presented)).toMatch(/3-Hour Pre-Tip/);
    expect(presentedCopyBlob(presented)).not.toMatch(LEGACY_MOVEMENT_LANGUAGE);
    expect(presented.acrossLabel).toBe('25.5 · 2 books');
    expect(presented.reference.medianLabel).toBe('25.5');
    expect(presented.comparison.medianLabel).toBe('25.5');
    expect(presented.consensusDeltaLabel).toBe('0');
  });

  it('labels Quiet as no meaningful movement', () => {
    const mm = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points',
      rows: [servingRow({ vendor: 'betmgm', movement_class: 'A' }), servingRow({ vendor: 'fanduel' })],
    });
    const presented = presentPlayerMarketMovement(mm, 'over');
    if (presented.state !== 'pro') throw new Error('expected pro');
    expect(presented.books[0]?.classLabel).toBe('Quiet');
    expect(presented.books[0]?.classExplanation).toBe('Little meaningful movement');
    expect(presented.books[0]?.priceMovementLabel).toBeNull();
  });

  it('shows juice price movement on an unchanged line', () => {
    const mm = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points',
      rows: [
        servingRow({
          vendor: 'fanduel',
          movement_class: 'B',
          over_implied_probability_delta: 0.024,
          comparison_over_odds: -125,
        }),
        servingRow({ vendor: 'betmgm', movement_class: 'A' }),
      ],
    });
    const presented = presentPlayerMarketMovement(mm, 'over');
    if (presented.state !== 'pro') throw new Error('expected pro');
    const juice = presented.books.find((b) => b.vendor === 'fanduel');
    expect(juice?.classLabel).toBe('Juice');
    expect(juice?.classExplanation).toBe('Price moved, line held');
    expect(juice?.lineDeltaLabel).toBeNull();
    expect(juice?.priceMovementLabel).toBe('+2.4 pp');
    expect(juice?.juiceContext).toBe(
      'Line stayed at 25.5, but the price shifted +2.4 percentage points.'
    );
    expect(juice?.referenceQuote).toBe('25.5 -110');
    expect(juice?.comparisonQuote).toBe('25.5 -125');
    expect(presentedCopyBlob(presented)).not.toMatch(/-110 → -125 = -15/);
  });

  it('surfaces Line deltas', () => {
    const mm = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points',
      rows: [
        servingRow({
          vendor: 'fanduel',
          movement_class: 'C',
          comparison_line: 26.5,
          line_delta: 1,
        }),
        servingRow({ vendor: 'betmgm', comparison_line: 26.5, line_delta: 1, movement_class: 'C' }),
      ],
    });
    const presented = presentPlayerMarketMovement(mm, 'over');
    if (presented.state !== 'pro') throw new Error('expected pro');
    expect(presented.books[1]?.classLabel).toBe('Line');
    expect(presented.books[1]?.lineDeltaLabel).toBe('+1');
    expect(presented.consensusDeltaLabel).toBe('+1');
  });

  it('surfaces Line+Price as both line and juice', () => {
    const mm = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points_rebounds_assists',
      rows: [
        servingRow({
          vendor: 'betmgm',
          prop_type: 'points_rebounds_assists',
          movement_class: 'D',
          reference_line: 19.5,
          comparison_line: 20.5,
          line_delta: 1,
          over_implied_probability_delta: -0.062,
        }),
        servingRow({
          vendor: 'fanduel',
          prop_type: 'points_rebounds_assists',
          movement_class: 'D',
          reference_line: 19.5,
          comparison_line: 20.5,
          line_delta: 1,
          over_implied_probability_delta: -0.05,
        }),
      ],
    });
    const presented = presentPlayerMarketMovement(mm, 'over');
    if (presented.state !== 'pro') throw new Error('expected pro');
    expect(presented.books[0]?.classLabel).toBe('Line+Price');
    expect(presented.books[0]?.classExplanation).toBe('Both line and price moved');
    expect(presented.books[0]?.lineDeltaLabel).toBe('+1');
    expect(presented.books[0]?.priceMovementLabel).toBe('-6.2 pp');
  });

  it('shows interpolating median with range and book count, not an offered line', () => {
    const mm = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points_rebounds',
      rows: [
        servingRow({ vendor: 'betmgm', reference_line: 25.5, comparison_line: 25.5 }),
        servingRow({ vendor: 'fanduel', reference_line: 26.5, comparison_line: 26.5 }),
      ],
    });
    const presented = presentPlayerMarketMovement(mm, 'over');
    if (presented.state !== 'pro') throw new Error('expected pro');
    expect(presented.comparison.medianLabel).toBe('26');
    expect(presented.comparison.rangeLabel).toBe('25.5–26.5 range · 2 books');
    expect(presented.acrossLabel).toBe('25.5–26.5 range · 2 books');
    expect(presented.books.some((b) => b.comparisonQuote.startsWith('26 '))).toBe(false);
    expect(presented.disclaimer).toMatch(/not necessarily a line any book offered/);
    expect(presentedCopyBlob(presented)).not.toMatch(/Consensus across/);
  });

  it('keeps 3-Hour and Close spans visible when they differ', () => {
    const mm = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points',
      rows: [
        servingRow({ vendor: 'betmgm', reference_line: 25.5, comparison_line: 25.5, line_delta: 0 }),
        servingRow({
          vendor: 'fanduel',
          reference_line: 25.5,
          comparison_line: 26.5,
          line_delta: 1,
          movement_class: 'C',
        }),
      ],
    });
    const presented = presentPlayerMarketMovement(mm, 'over');
    if (presented.state !== 'pro') throw new Error('expected pro');
    expect(presented.acrossLabel).toBe('3-Hour 25.5 · Close 25.5–26.5 · 2 books');
  });

  it('does not call a one-book line consensus', () => {
    const mm = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points',
      rows: [servingRow({ vendor: 'betmgm' })],
    });
    const presented = presentPlayerMarketMovement(mm, 'over');
    if (presented.state !== 'pro') throw new Error('expected pro');
    expect(presented.books).toHaveLength(1);
    expect(presented.comparison.available).toBe(false);
    expect(presented.consensusUnavailable).toBe(true);
    expect(presented.oneBook).toBe(true);
    expect(presentedCopyBlob(presented)).toContain('1 supported book available');
    expect(presentedCopyBlob(presented)).not.toMatch(/Consensus 25\.5/);
    expect(presentedCopyBlob(presented)).not.toContain('Consensus across');
  });

  it('uses an informational empty state', () => {
    const mm = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points',
      rows: [],
    });
    const presented = presentPlayerMarketMovement(mm);
    expect(presented.state).toBe('empty');
    expect(presentedCopyBlob(presented)).toContain(MM_EMPTY_TITLE);
    expect(presentedCopyBlob(presented)).not.toMatch(LEGACY_MOVEMENT_LANGUAGE);
    expect(presentedCopyBlob(presented)).not.toMatch(/0 →/);
  });

  it('uses a scoped unsupported-prop message', () => {
    const mm = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points',
      rows: [],
    });
    const unsupported = { ...mm, status: 'unsupported_prop' as const, reason: 'unsupported_prop' as const };
    const presented = presentPlayerMarketMovement(unsupported);
    expect(presented.state).toBe('unsupported');
    expect(presentedCopyBlob(presented)).toContain(MM_UNSUPPORTED_TITLE);
    expect(presentedCopyBlob(presented)).not.toMatch(/allowlist|v1/i);
  });

  it('Free summary hides 3-Hour values and per-book rows', () => {
    const full = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points',
      rows: [
        servingRow({ vendor: 'betmgm', reference_line: 24.5, comparison_line: 25.5, line_delta: 1 }),
        servingRow({ vendor: 'fanduel', reference_line: 25.5, comparison_line: 26.5, line_delta: 1 }),
      ],
    });
    const presented = presentPlayerMarketMovement(summarizePlayerMarketMovementForFree(full), 'over');
    expect(presented.state).toBe('free');
    if (presented.state !== 'free') return;
    expect(presented.title).toBe(MM_FREE_TITLE);
    expect(presented.close.medianLabel).toBe('26');
    const blob = presentedCopyBlob(presented);
    expect(blob).not.toMatch(/3-Hour Pre-Tip/);
    expect(blob).not.toMatch(/BetMGM|FanDuel/);
    expect(blob).not.toMatch(/24\.5/);
    expect(blob).toMatch(/3 hours before tip/);
    expect(blob).not.toMatch(LEGACY_MOVEMENT_LANGUAGE);
    expect(presented.acrossLabel).toBe('Close consensus');
    expect(presented.close.rangeLabel).toMatch(/books/);
    expect(presented.close.medianLabel).toBe('26');
  });

  it('keeps shopping visible when certified movement is empty', () => {
    expect(shoppingStillVisible('ok', 'empty')).toBe(true);
    expect(shoppingStillVisible('unavailable', 'ok')).toBe(false);
  });

  it('does not reorder snapshots from inverted timestamps', () => {
    const mm = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points',
      rows: [
        servingRow({
          vendor: 'betmgm',
          reference_timestamp: '2026-04-23T20:00:00.000Z',
          comparison_timestamp: '2026-04-23T18:00:00.000Z',
        }),
        servingRow({ vendor: 'fanduel' }),
      ],
    });
    const presented = presentPlayerMarketMovement(mm, 'over');
    if (presented.state !== 'pro') throw new Error('expected pro');
    expect(presented.subtitle.startsWith('3-Hour Pre-Tip')).toBe(true);
    expect(presentedCopyBlob(presented)).not.toMatch(/2026-04-23/);
  });

  it('uses em dash for missing odds instead of zero', () => {
    const mm = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points',
      rows: [
        servingRow({
          vendor: 'betmgm',
          reference_over_odds: null,
          comparison_over_odds: null,
          comparison_line: null,
          line_delta: null,
        }),
        servingRow({ vendor: 'fanduel' }),
      ],
    });
    const presented = presentPlayerMarketMovement(mm, 'over');
    if (presented.state !== 'pro') throw new Error('expected pro');
    expect(presented.books[0]?.referenceQuote).toBe('25.5');
    expect(presented.books[0]?.comparisonQuote).toBe('—');
    expect(presentedCopyBlob(presented)).not.toMatch(/\bNaN\b|\bundefined\b/);
    expect(presentedCopyBlob(presented)).not.toMatch(/\+NaN pp/);
  });

  it('shows selected Under odds, not Over odds', () => {
    const mm = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points',
      rows: [
        servingRow({
          vendor: 'betmgm',
          reference_over_odds: -150,
          reference_under_odds: +130,
          comparison_over_odds: -160,
          comparison_under_odds: +140,
        }),
        servingRow({ vendor: 'fanduel' }),
      ],
    });
    const over = presentPlayerMarketMovement(mm, 'over');
    const under = presentPlayerMarketMovement(mm, 'Under');
    if (over.state !== 'pro' || under.state !== 'pro') throw new Error('expected pro');
    expect(over.books[0]?.referenceQuote).toBe('25.5 -150');
    expect(over.books[0]?.comparisonQuote).toBe('25.5 -160');
    expect(under.books[0]?.referenceQuote).toBe('25.5 +130');
    expect(under.books[0]?.comparisonQuote).toBe('25.5 +140');
  });

  it('orders sportsbook rows BetMGM → FanDuel → DraftKings → Caesars', () => {
    const mm = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points',
      rows: [
        servingRow({ vendor: 'caesars' }),
        servingRow({ vendor: 'draftkings' }),
        servingRow({ vendor: 'fanduel' }),
        servingRow({ vendor: 'betmgm' }),
      ],
    });
    const presented = presentPlayerMarketMovement(mm, 'over');
    if (presented.state !== 'pro') throw new Error('expected pro');
    expect(presented.books.map((b) => b.vendor)).toEqual([
      'betmgm',
      'fanduel',
      'draftkings',
      'caesars',
    ]);
  });

  it('does not fabricate juice pp when implied probability is missing', () => {
    const mm = mapServingRowsToPlayerMarketMovement({
      gameId: 'g1',
      playerId: 'p1',
      propType: 'points',
      rows: [
        servingRow({
          vendor: 'fanduel',
          movement_class: 'B',
          over_implied_probability_delta: null,
          under_implied_probability_delta: null,
        }),
        servingRow({ vendor: 'betmgm' }),
      ],
    });
    const presented = presentPlayerMarketMovement(mm, 'over');
    if (presented.state !== 'pro') throw new Error('expected pro');
    const juice = presented.books.find((b) => b.vendor === 'fanduel');
    expect(juice?.classExplanation).toBe('Price moved, line held');
    expect(juice?.priceMovementLabel).toBeNull();
    expect(juice?.juiceContext).toBeNull();
    expect(presentedCopyBlob(presented)).not.toMatch(/NaN|undefined|\+0 pp/);
  });
});
