import { describe, expect, it } from 'vitest';
import { consensusQuote, latestPregameBooks, type BookOddsRow } from '@/lib/pregame-matchup/odds-consensus';

const tip = '2026-11-06T02:00:00Z';
const now = new Date('2026-11-05T15:00:00Z');

const book = (vendor: string, over: Partial<BookOddsRow> = {}): BookOddsRow => ({
  vendor,
  snapshotAt: '2026-11-05T14:00:00Z',
  homeMoneyline: -114,
  awayMoneyline: -104,
  homeSpread: -1.5,
  homeSpreadOdds: -106,
  awaySpreadOdds: -114,
  total: 223.5,
  overOdds: -110,
  underOdds: -110,
  ...over,
});

const rows = [
  book('draftkings', { overOdds: -106, underOdds: -114 }),
  book('fanduel', { homeMoneyline: -110, awayMoneyline: -108 }),
  book('fanduel', { snapshotAt: '2026-11-05T05:00:00Z', homeSpread: -2.5, homeMoneyline: -132, awayMoneyline: 112 }),
  book('betmgm', { homeMoneyline: -118, awayMoneyline: -102, homeSpreadOdds: -105, awaySpreadOdds: -115 }),
  book('caesars', { homeSpread: -1, homeMoneyline: -110, awayMoneyline: -110, total: 223 }),
  // Spread sign contradicts its own moneyline (home favoured, home +0.5): skipped for the spread.
  book('betrivers', { homeSpread: 0.5, homeMoneyline: -114, awayMoneyline: -109, underOdds: -105 }),
  // Not a sportsbook, and a snapshot after tip.
  book('polymarket', { homeSpread: -4.5 }),
  book('rebet', { snapshotAt: '2026-11-06T02:30:00Z', awayMoneyline: 200 }),
];

describe('latestPregameBooks', () => {
  it('keeps the latest pregame sportsbook snapshot per vendor', () => {
    const books = latestPregameBooks(rows, tip, now);
    expect(books.map((b) => b.vendor)).toEqual(['betmgm', 'betrivers', 'caesars', 'draftkings', 'fanduel']);
    expect(books.find((b) => b.vendor === 'fanduel')!.homeSpread).toBe(-1.5);
  });

  it('drops snapshots more than 36 hours before tip', () => {
    expect(latestPregameBooks([book('draftkings', { snapshotAt: '2026-11-04T12:00:00Z' })], tip, now)).toEqual([]);
  });
});

describe('consensusQuote', () => {
  it('builds the line most books hang, median prices, no-vig and best price', () => {
    const q = consensusQuote({ rows, tipAt: tip, now, awayAbbr: 'ORL', homeAbbr: 'PHX' })!;
    expect(q.vendorLabel).toBe('Consensus of 5 sportsbooks');
    expect(q.caption).toContain('spread 3 of 4, total 4 of 5');
    expect(q.caption).toContain('not live');
    expect(q.spreadAway).toBe('ORL +1.5 −114');
    expect(q.spreadHome).toBe('PHX −1.5 −106');
    expect(q.total).toBe('O/U 223.5');
    expect(q.moneylineAway).toBe('ORL −108');
    expect(q.moneylineHome).toBe('PHX −114');
    expect(q.implied).toMatch(/^No-vig implied probability: ORL \d+%, PHX \d+%$/);
    expect(q.best).toContain('ORL ML −102 (BetMGM)');
    expect(q.best).toContain('O 223.5 −106 (DraftKings)');
    expect(q.best).toContain('U 223.5 −105 (BetRivers)');
  });

  it('needs at least two sportsbooks', () => {
    expect(consensusQuote({ rows: [book('draftkings'), book('polymarket')], tipAt: tip, now, awayAbbr: 'ORL', homeAbbr: 'PHX' })).toBeNull();
  });
});
