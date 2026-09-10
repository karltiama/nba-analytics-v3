import { describe, expect, it } from 'vitest';
import { sanitizePropMarketResearch } from '../sanitize-prop-market';
import { foundingProEntitlement, freeEntitlement } from '../resolve';
import type { PropMarketResearch } from '@/lib/betting/prop-market-serving';
import { mapServingRowsToPlayerMarketMovement } from '@/lib/betting/market-movement-api';

const FULL: PropMarketResearch = {
  marketContext: 'historical',
  lineLabel: 'Historical closing line',
  comparisonLabel: 'Historical sportsbook comparison',
  paperBetAllowed: false,
  selected: {
    gameId: '1',
    playerId: '9',
    propType: 'points',
    sportsbook: 'draftkings',
    side: 'over',
    lineValue: 10.5,
    oddsAmerican: -114,
    snapshotAt: '2026-05-01T18:00:00.000Z',
  },
  shopping: {
    status: 'ok',
    reason: null,
    message: null,
    sourceTable: 'research.prop_decision_lines',
    bookCount: 3,
    marketMinLine: 10.5,
    marketMaxLine: 11.5,
    latestSnapshotAt: '2026-05-01T18:00:00.000Z',
    bestAvailableOverLine: {
      sportsbook: 'draftkings',
      side: 'over',
      lineValue: 10.5,
      oddsAmerican: -114,
      snapshotAt: '2026-05-01T18:00:00.000Z',
    },
    bestAvailableUnderLine: {
      sportsbook: 'fanduel',
      side: 'under',
      lineValue: 10.5,
      oddsAmerican: -105,
      snapshotAt: '2026-05-01T18:00:00.000Z',
    },
    bestPriceAtSelectedLine: {
      sportsbook: 'fanduel',
      side: 'over',
      lineValue: 10.5,
      oddsAmerican: -104,
      snapshotAt: '2026-05-01T18:00:00.000Z',
    },
    books: [
      {
        sportsbook: 'draftkings',
        side: 'over',
        lineValue: 10.5,
        oddsAmerican: -114,
        snapshotAt: '2026-05-01T18:00:00.000Z',
      },
    ],
  },
  marketMovement: mapServingRowsToPlayerMarketMovement({
    gameId: '1',
    playerId: '9',
    propType: 'points',
    rows: [
      {
        game_id: '1',
        player_id: '9',
        player_name: 'A',
        prop_type: 'points',
        vendor: 'betmgm',
        reference_kind: '3_hour_pre_tip',
        reference_line: 10.5,
        reference_over_odds: -110,
        reference_under_odds: -110,
        reference_timestamp: '2026-05-01T16:00:00.000Z',
        comparison_kind: 'decision_close',
        comparison_line: 11.5,
        comparison_over_odds: -110,
        comparison_under_odds: -110,
        comparison_timestamp: '2026-05-01T18:00:00.000Z',
        line_delta: 1,
        over_implied_probability_delta: 0,
        under_implied_probability_delta: 0,
        movement_class: 'C',
      },
      {
        game_id: '1',
        player_id: '9',
        player_name: 'A',
        prop_type: 'points',
        vendor: 'fanduel',
        reference_kind: '3_hour_pre_tip',
        reference_line: 10.5,
        reference_over_odds: -110,
        reference_under_odds: -110,
        reference_timestamp: '2026-05-01T16:00:00.000Z',
        comparison_kind: 'decision_close',
        comparison_line: 11.5,
        comparison_over_odds: -110,
        comparison_under_odds: -110,
        comparison_timestamp: '2026-05-01T18:00:00.000Z',
        line_delta: 1,
        over_implied_probability_delta: 0,
        under_implied_probability_delta: 0,
        movement_class: 'C',
      },
    ],
  }),
};

describe('sanitizePropMarketResearch', () => {
  it('strips premium fields for Free and keeps selected/range context', () => {
    const out = sanitizePropMarketResearch(FULL, freeEntitlement());
    expect(out.selected.sportsbook).toBe('draftkings');
    expect(out.shopping.bookCount).toBe(3);
    expect(out.shopping.marketMinLine).toBe(10.5);
    expect(out.shopping.marketMaxLine).toBe(11.5);
    expect(out.shopping.bestAvailableOverLine).toBeNull();
    expect(out.shopping.bestAvailableUnderLine).toBeNull();
    expect(out.shopping.bestPriceAtSelectedLine).toBeNull();
    expect(out.shopping.books).toEqual([]);
    expect(out.entitlement.isPro).toBe(false);
    expect(out.marketMovement.detail).toBe('summary');
    expect(out.marketMovement.books).toEqual([]);
    expect(out.marketMovement.consensus.comparison.available).toBe(true);
    expect(out.marketMovement.consensus.reference.available).toBe(false);
    expect(out.marketMovement.reference.timestamp).toBeNull();
  });

  it('does not turn empty certified movement into a premium lock', () => {
    const noHistory: PropMarketResearch = {
      ...FULL,
      marketMovement: mapServingRowsToPlayerMarketMovement({
        gameId: '1',
        playerId: '9',
        propType: 'points',
        rows: [],
      }),
    };
    const out = sanitizePropMarketResearch(noHistory, freeEntitlement());
    expect(out.marketMovement.status).toBe('empty');
    expect(out.marketMovement.reason).toBe('no_certified_historical_snapshot');
    expect(out.marketMovement.books).toEqual([]);
  });

  it('keeps premium fields for Founding Pro', () => {
    const out = sanitizePropMarketResearch(
      FULL,
      foundingProEntitlement({ status: 'active', currentPeriodEnd: null, source: 'row' })
    );
    expect(out.shopping.bestPriceAtSelectedLine?.sportsbook).toBe('fanduel');
    expect(out.shopping.books).toHaveLength(1);
    expect(out.shopping.bestAvailableOverLine?.sportsbook).toBe('draftkings');
    expect(out.shopping.bestAvailableUnderLine?.sportsbook).toBe('fanduel');
    expect(out.entitlement.isPro).toBe(true);
    expect(out.marketMovement.detail).toBe('full');
    expect(out.marketMovement.books).toHaveLength(2);
    expect(out.marketMovement.books[0]?.movement.class).toBe('Line');
  });
});
