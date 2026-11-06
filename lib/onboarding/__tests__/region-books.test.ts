import { describe, expect, it } from 'vitest';
import { EXPLORER_BOOKS } from '@/lib/betting/props-explorer-filters';
import { CA_PROVINCES, US_STATES, isValidSubdivision } from '../regions';
import {
  SPORTSBOOK_CATALOG,
  booksWithOdds,
  groupBooksForRegion,
  hasOddsData,
  normalizeBookIds,
} from '../sportsbooks';
import { resolveRegionBooks } from '../region-books-input';

const ids = (books: { id: string }[]) => books.map((b) => b.id);

describe('region list', () => {
  it('covers 50 states + DC and 13 provinces/territories', () => {
    expect(US_STATES).toHaveLength(51);
    expect(CA_PROVINCES).toHaveLength(13);
    expect(isValidSubdivision('CA', 'ON')).toBe(true);
    expect(isValidSubdivision('US', 'ON')).toBe(false);
    expect(isValidSubdivision('OTHER', 'ON')).toBe(false);
  });
});

describe('sportsbook catalog', () => {
  it('offers exactly the books we carry odds for, plus Kalshi and Polymarket', () => {
    const all = SPORTSBOOK_CATALOG.map((b) => b.id);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(
      [...EXPLORER_BOOKS.map((b) => b.id), 'kalshi', 'polymarket'].sort()
    );
    for (const book of SPORTSBOOK_CATALOG) {
      expect(hasOddsData(book.id)).toBe(book.kind === 'sportsbook');
    }
  });

  it('never hides a book: every region shows the whole catalog', () => {
    for (const [country, region] of [
      ['US', 'NJ'],
      ['CA', 'ON'],
      ['CA', 'AB'],
      ['OTHER', null],
      [null, null],
    ] as const) {
      const g = groupBooksForRegion(country, region);
      expect(g.common.length + g.other.length + g.predictionMarkets.length).toBe(SPORTSBOOK_CATALOG.length);
    }
  });

  it('puts Ontario-licensed books first for Ontario, Betway elsewhere in Canada', () => {
    expect(ids(groupBooksForRegion('CA', 'ON').common)).toEqual(
      expect.arrayContaining(['fanduel', 'draftkings', 'betmgm', 'caesars', 'betrivers', 'betway'])
    );
    expect(ids(groupBooksForRegion('CA', 'ON').common)).not.toContain('fanatics');
    expect(ids(groupBooksForRegion('CA', 'AB').common)).toEqual(['betway']);
  });

  it('keeps prediction markets apart and has no "common" group outside US/CA', () => {
    const us = groupBooksForRegion('US', 'TX');
    expect(ids(us.predictionMarkets)).toEqual(['kalshi', 'polymarket']);
    expect(ids(us.common)).not.toContain('kalshi');
    expect(groupBooksForRegion('OTHER', null).common).toHaveLength(0);
  });

  it('normalizes ids and finds the ones with odds', () => {
    expect(normalizeBookIds(['fanduel', 'nope', 'bet365', 'kalshi', 'fanduel', 3])).toEqual(['fanduel', 'kalshi']);
    expect(normalizeBookIds(null)).toEqual([]);
    expect(booksWithOdds(['kalshi', 'fanduel', 'polymarket'])).toEqual(['fanduel']);
  });
});

describe('resolveRegionBooks', () => {
  it('leaves fields unchanged when omitted', () => {
    expect(resolveRegionBooks({})).toEqual({
      ok: true,
      values: { bettingCountry: null, bettingRegion: null, sportsbooks: null },
    });
  });

  it('keeps an explicit empty book list (answered: none)', () => {
    const r = resolveRegionBooks({ sportsbooks: [] });
    expect(r.ok && r.values.sportsbooks).toEqual([]);
  });

  it('rejects a region without a country or outside it', () => {
    expect(resolveRegionBooks({ bettingRegion: 'ON' }).ok).toBe(false);
    expect(resolveRegionBooks({ bettingCountry: 'US', bettingRegion: 'ON' }).ok).toBe(false);
    expect(resolveRegionBooks({ bettingCountry: 'CA', bettingRegion: 'ON' }).ok).toBe(true);
  });

  it('allows a country with no region yet, and drops unknown books', () => {
    const r = resolveRegionBooks({ bettingCountry: 'OTHER', sportsbooks: ['polymarket', 'bet365'] });
    expect(r).toEqual({
      ok: true,
      values: { bettingCountry: 'OTHER', bettingRegion: null, sportsbooks: ['polymarket'] },
    });
  });
});
