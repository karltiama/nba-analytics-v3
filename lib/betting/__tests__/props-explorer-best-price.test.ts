import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn(), queryOne: vi.fn() }));
import {
  PRICE_GAP_SORT,
  marketPriceLateralSql,
  toBestPrice,
} from '@/lib/betting/props-explorer-serving';
import {
  bestPriceLabel,
  formatVsAverage,
  priceColumnCopy,
  vsAverageTextClass,
} from '@/lib/betting/props-explorer-row-display';
import { EXPLORER_BOOKS, EXPLORER_SORT_OPTIONS, explorerBookDisplayName } from '@/lib/betting/props-explorer-filters';

const ROOT = join(__dirname, '../../..');

describe('toBestPrice', () => {
  const market = {
    best_odds_american: 115,
    best_odds_decimal: '2.15',
    best_sportsbook: 'fanduel',
    avg_odds_decimal: '1.95',
    market_book_count: '4',
  };

  it('marks the best row and measures its payout over the average book', () => {
    const bp = toBestPrice({ ...market, odds_american: 115, odds_decimal: '2.15' })!;
    expect(bp.isBest).toBe(true);
    expect(bp.bookCount).toBe(4);
    expect(bp.vsAverage).toBeCloseTo(2.15 / 1.95 - 1, 10);
  });

  it('points a worse row at the better book and goes negative vs the average', () => {
    const bp = toBestPrice({ ...market, odds_american: -120, odds_decimal: null })!;
    expect(bp.isBest).toBe(false);
    expect(bp.sportsbook).toBe('fanduel');
    expect(bp.vsAverage).toBeCloseTo((1 + 100 / 120) / 1.95 - 1, 10);
    expect(bp.vsAverage!).toBeLessThan(0);
  });

  it('has no comparison for a line only one book quotes', () => {
    const bp = toBestPrice({ ...market, market_book_count: 1, odds_american: 115, odds_decimal: 2.15 })!;
    expect(bp.isBest).toBe(true);
    expect(bp.vsAverage).toBeNull();
  });

  it('returns null without market data', () => {
    expect(
      toBestPrice({
        odds_american: -110,
        odds_decimal: null,
        best_odds_american: null,
        best_odds_decimal: null,
        best_sportsbook: null,
        avg_odds_decimal: null,
        market_book_count: null,
      })
    ).toBeNull();
  });
});

describe('market price SQL', () => {
  it('compares the same line and side, and honours the book filter', () => {
    const all = marketPriceLateralSql('live', null);
    expect(all).toContain('analytics.player_props_current m');
    expect(all).toContain('m.line_value = p.line_value');
    expect(all).toContain('lower(m.side) = lower(p.side)');
    expect(all).not.toContain('ANY(');
    expect(marketPriceLateralSql('historical', 4)).toContain('lower(trim(m.sportsbook)) = ANY($4)');
    expect(marketPriceLateralSql('historical', null)).toContain('research.prop_decision_lines m');
  });
});

describe('best price display', () => {
  const name = explorerBookDisplayName;
  it('labels the cell', () => {
    expect(bestPriceLabel(null, name)).toBe('—');
    expect(bestPriceLabel({ oddsAmerican: 115, sportsbook: 'fanduel', bookCount: 1, isBest: true, vsAverage: null }, name)).toBe('Only book');
    expect(bestPriceLabel({ oddsAmerican: 115, sportsbook: 'fanduel', bookCount: 4, isBest: true, vsAverage: 0.03 }, name)).toBe('Best of 4');
    expect(bestPriceLabel({ oddsAmerican: 115, sportsbook: 'fanduel', bookCount: 4, isBest: false, vsAverage: -0.02 }, name)).toBe('+115 FanDuel');
  });

  it('formats and colours the gap vs the average book', () => {
    expect(formatVsAverage(0.0318)).toBe('+3.2%');
    expect(formatVsAverage(-0.014)).toBe('−1.4%');
    expect(formatVsAverage(0.0001)).toBe('0.0%');
    expect(formatVsAverage(null)).toBe('—');
    expect(vsAverageTextClass(0.03)).toBe('text-[#178A45]');
    expect(vsAverageTextClass(-0.03)).toBe('text-[#8A5A00]');
    expect(vsAverageTextClass(null)).toBe('text-[#4a6366]');
  });

  it('offers the price-gap sort and lists BetParx', () => {
    expect(EXPLORER_SORT_OPTIONS.map((o) => o.value)).toContain(PRICE_GAP_SORT);
    expect(EXPLORER_BOOKS.map((b) => b.id)).toContain('betparx');
    expect(explorerBookDisplayName('betparx')).toBe('BetParx');
  });
});

describe('props explorer best-price contract', () => {
  const page = readFileSync(join(ROOT, 'app/betting/props-explorer/page.tsx'), 'utf8');
  const skeleton = readFileSync(join(ROOT, 'components/betting/PropsExplorerTableSkeleton.tsx'), 'utf8');
  it('shows Best price and vs Avg by default, and the skeleton matches', () => {
    expect(page).toContain('Best price');
    // Header text comes from priceColumnCopy: "vs Avg", or "vs market" with one book selected.
    expect(page).toContain('{priceCopy.vsHeader}');
    expect(priceColumnCopy('selected_books').vsHeader).toBe('vs Avg');
    expect(page).toContain('colSpan={showAdvancedMetrics ? 17 : 12}');
    const header = (src: string) => (src.match(/<th /g) ?? []).length;
    expect(skeleton).toContain('Best price');
    expect(header(skeleton)).toBe(12);
    const cells = skeleton.slice(skeleton.indexOf('<tbody>'));
    expect((cells.match(/<td /g) ?? []).length).toBe(12);
  });
});
