import { describe, expect, it } from 'vitest';
import {
  isBetterAmericanPrice,
  isPresentLineValue,
  liveShoppingAvailability,
  marketContextLabels,
  parseLineValue,
  pickBestLine,
  pickBestPriceAtLine,
  propsComparisonLabel,
  shoppingUnavailableMessage,
  summarizeComparableBoard,
  type PropMarketBookRow,
} from '../prop-market-compare';

const DK_OVER: PropMarketBookRow = {
  sportsbook: 'draftkings',
  side: 'over',
  lineValue: 25.5,
  oddsAmerican: -115,
  snapshotAt: '2026-05-01T18:00:00.000Z',
};

function book(partial: Partial<PropMarketBookRow> & Pick<PropMarketBookRow, 'sportsbook'>): PropMarketBookRow {
  return { ...DK_OVER, ...partial };
}

describe('line value 0 is present', () => {
  it('treats 0 as a valid line rather than missing', () => {
    expect(isPresentLineValue(0)).toBe(true);
    expect(parseLineValue('0')).toBe(0);
    expect(parseLineValue(0)).toBe(0);
    expect(parseLineValue('')).toBeNull();
    expect(parseLineValue(null)).toBeNull();
  });
});

describe('best-line semantics', () => {
  it('Over best-line chooses the lower threshold', () => {
    const best = pickBestLine(
      [
        book({ sportsbook: 'draftkings', lineValue: 25.5, oddsAmerican: -115 }),
        book({ sportsbook: 'fanduel', lineValue: 24.5, oddsAmerican: -110 }),
      ],
      'over'
    );
    expect(best?.sportsbook).toBe('fanduel');
    expect(best?.lineValue).toBe(24.5);
  });

  it('Under best-line chooses the higher threshold', () => {
    const best = pickBestLine(
      [
        book({ sportsbook: 'draftkings', side: 'under', lineValue: 25.5, oddsAmerican: -110 }),
        book({ sportsbook: 'caesars', side: 'under', lineValue: 26.5, oddsAmerican: -115 }),
      ],
      'under'
    );
    expect(best?.sportsbook).toBe('caesars');
    expect(best?.lineValue).toBe(26.5);
  });
});

describe('best-price semantics', () => {
  it('same-line better American price prefers -105 over -120', () => {
    expect(isBetterAmericanPrice(-105, -120)).toBe(true);
    expect(isBetterAmericanPrice(100, -110)).toBe(true);
    const best = pickBestPriceAtLine(
      [
        book({ sportsbook: 'draftkings', lineValue: 25.5, oddsAmerican: -120 }),
        book({ sportsbook: 'betmgm', lineValue: 25.5, oddsAmerican: -105 }),
      ],
      'over',
      25.5
    );
    expect(best?.sportsbook).toBe('betmgm');
    expect(best?.oddsAmerican).toBe(-105);
    expect(best?.lineValue).toBe(25.5);
  });

  it('does not conflate a different line with a better price at the selected line', () => {
    const rows = [
      book({ sportsbook: 'draftkings', lineValue: 25.5, oddsAmerican: -115 }),
      book({ sportsbook: 'fanduel', lineValue: 24.5, oddsAmerican: -110 }),
      book({ sportsbook: 'betmgm', lineValue: 25.5, oddsAmerican: -105 }),
    ];
    const board = summarizeComparableBoard(rows, {
      side: 'over',
      lineValue: 25.5,
      sportsbook: 'draftkings',
    });
    expect(board?.bestAvailableOverLine?.sportsbook).toBe('fanduel');
    expect(board?.bestAvailableOverLine?.lineValue).toBe(24.5);
    expect(board?.bestPriceAtSelectedLine?.sportsbook).toBe('betmgm');
    expect(board?.bestPriceAtSelectedLine?.lineValue).toBe(25.5);
    expect(board?.bestPriceAtSelectedLine?.oddsAmerican).toBe(-105);
  });

  it('keeps a true line of 0 eligible for best-line and same-line price', () => {
    const rows = [
      book({ sportsbook: 'draftkings', side: 'under', lineValue: 0, oddsAmerican: -120 }),
      book({ sportsbook: 'fanduel', side: 'under', lineValue: 0.5, oddsAmerican: -110 }),
      book({ sportsbook: 'betmgm', side: 'under', lineValue: 0, oddsAmerican: -105 }),
    ];
    expect(pickBestLine(rows, 'under')?.lineValue).toBe(0.5);
    expect(pickBestPriceAtLine(rows, 'under', 0)?.sportsbook).toBe('betmgm');
  });
});

describe('historical vs current labels', () => {
  it('never describes historical comparison as current or live', () => {
    expect(propsComparisonLabel('historical')).toBe('Historical sportsbook comparison');
    expect(propsComparisonLabel('historical')).not.toMatch(/current|live/i);
    const labels = marketContextLabels('historical');
    expect(labels.lineLabel).toBe('Historical closing line');
    expect(labels.lineLabel).not.toMatch(/current|live/i);
    expect(labels.comparisonLabel).not.toMatch(/current|live/i);
    expect(propsComparisonLabel('live')).toBe('Current market comparison');
  });
});

describe('live shopping freshness', () => {
  const now = new Date('2026-09-06T16:00:00.000Z');

  it('marks frozen current comparison unavailable', () => {
    const result = liveShoppingAvailability({
      frozen: true,
      newestSnapshotAt: now.toISOString(),
      selectedSnapshotAt: now.toISOString(),
      now,
    });
    expect(result).toEqual({ ok: false, reason: 'frozen_current' });
  });

  it('marks stale current snapshots unavailable', () => {
    const result = liveShoppingAvailability({
      frozen: false,
      newestSnapshotAt: '2026-03-09T17:00:00.000Z',
      selectedSnapshotAt: now.toISOString(),
      now,
    });
    expect(result).toEqual({ ok: false, reason: 'stale_current' });
  });

  it('does not compare a fresh selected row against an older shopping snapshot', () => {
    const result = liveShoppingAvailability({
      frozen: false,
      newestSnapshotAt: '2026-09-06T15:00:00.000Z',
      selectedSnapshotAt: '2026-09-06T16:00:00.000Z',
      now,
    });
    expect(result).toEqual({ ok: false, reason: 'stale_current' });
  });

  it('allows a current comparison inside the 30-minute window', () => {
    const result = liveShoppingAvailability({
      frozen: false,
      newestSnapshotAt: '2026-09-06T15:45:00.000Z',
      selectedSnapshotAt: '2026-09-06T15:50:00.000Z',
      now,
    });
    expect(result).toEqual({ ok: true });
  });
});

describe('missing shopping data', () => {
  it('returns a truthful unavailable board when there are no comparable rows', () => {
    expect(
      summarizeComparableBoard([], { side: 'over', lineValue: 25.5, sportsbook: 'draftkings' })
    ).toBeNull();
    expect(shoppingUnavailableMessage()).toBe('Line comparison unavailable');
  });
});

describe('legacy movement helper', () => {
  it('does not export summarizePropMovement', async () => {
    const mod = await import('../prop-market-compare');
    expect('summarizePropMovement' in mod).toBe(false);
    expect('movementUnavailableMessage' in mod).toBe(false);
    expect('PropMovementPoint' in mod).toBe(false);
  });
});
