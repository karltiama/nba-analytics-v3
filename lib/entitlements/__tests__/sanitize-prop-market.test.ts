import { describe, expect, it } from 'vitest';
import { sanitizePropMarketResearch } from '../sanitize-prop-market';
import { foundingProEntitlement, freeEntitlement } from '../resolve';
import type { PropMarketResearch } from '@/lib/betting/prop-market-serving';

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
  movement: {
    status: 'ok',
    reason: null,
    message: null,
    openedLine: 10.5,
    closedLine: 11.5,
    delta: 1,
    from: '2026-05-01T16:00:00.000Z',
    to: '2026-05-01T18:00:00.000Z',
  },
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
    expect(out.movement.openedLine).toBeNull();
    expect(out.movement.closedLine).toBeNull();
    expect(out.movement.reason).toBe('entitlement');
    expect(out.entitlement.isPro).toBe(false);
  });

  it('keeps premium fields for Founding Pro', () => {
    const out = sanitizePropMarketResearch(
      FULL,
      foundingProEntitlement({ status: 'active', currentPeriodEnd: null, source: 'row' })
    );
    expect(out.shopping.bestPriceAtSelectedLine?.sportsbook).toBe('fanduel');
    expect(out.shopping.books).toHaveLength(1);
    expect(out.movement.openedLine).toBe(10.5);
    expect(out.entitlement.isPro).toBe(true);
  });
});
