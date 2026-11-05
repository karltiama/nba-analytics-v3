import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn(), queryOne: vi.fn() }));
import { priceScopeForBooks } from '@/lib/betting/props-explorer-serving';
import { bestPriceLabel, priceColumnCopy } from '@/lib/betting/props-explorer-row-display';

const name = (b: string | null) => (b === 'betmgm' ? 'BetMGM' : String(b));

describe('one selected book compares with the whole market', () => {
  it('switches scope only for exactly one book', () => {
    expect(priceScopeForBooks(null)).toBe('selected_books');
    expect(priceScopeForBooks([])).toBe('selected_books');
    expect(priceScopeForBooks(['fanduel'])).toBe('market');
    expect(priceScopeForBooks(['fanduel', 'draftkings'])).toBe('selected_books');
  });

  it('says where the better price is', () => {
    const bp = { oddsAmerican: 115, sportsbook: 'betmgm', bookCount: 6, isBest: false, vsAverage: -0.02 };
    expect(bestPriceLabel({ ...bp, marketWide: true }, name)).toBe('Elsewhere +115 BetMGM');
    expect(bestPriceLabel({ ...bp, marketWide: false }, name)).toBe('+115 BetMGM');
    expect(bestPriceLabel({ ...bp, isBest: true, marketWide: true }, name)).toBe('Best of 6');
  });

  it('relabels the comparison column', () => {
    expect(priceColumnCopy('market').vsHeader).toBe('vs market');
    expect(priceColumnCopy('selected_books').vsHeader).toBe('vs Avg');
    expect(priceColumnCopy(undefined).vsHeader).toBe('vs Avg');
  });
});
