import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn(), queryOne: vi.fn() }));
import { arbExistsSql } from '@/lib/betting/props-explorer-serving';
import { arbInstructions, findArb, formatArbProfit, type ArbQuote } from '@/lib/betting/props-explorer-arb';
import { EXPLORER_BOOKS } from '@/lib/betting/props-explorer-filters';

const T = '2026-11-04T19:00:00Z';
const q = (over: Partial<ArbQuote>): ArbQuote => ({ sportsbook: 'draftkings', side: 'over', oddsAmerican: -110, oddsDecimal: null, snapshotAt: T, ...over });

describe('findArb', () => {
  const row = q({ sportsbook: 'draftkings', side: 'over', oddsAmerican: 110 });

  it('pairs with the best fresh opposite price at another book', () => {
    const arb = findArb(row, [
      q({ sportsbook: 'fanduel', side: 'under', oddsAmerican: -105 }),
      q({ sportsbook: 'betmgm', side: 'under', oddsAmerican: 100 }),
      q({ sportsbook: 'caesars', side: 'over', oddsAmerican: 150 }),
    ])!;
    expect(arb.otherSportsbook).toBe('betmgm');
    expect(arb.otherSide).toBe('under');
    // 2.10 and 2.00: 1/2.1 + 1/2 = 0.97619 -> 2.44% return
    expect(arb.profit).toBeCloseTo(1 / (1 / 2.1 + 1 / 2) - 1, 10);
    expect(arb.stakeShare).toBeCloseTo(1 / 2.1 / (1 / 2.1 + 1 / 2), 10);
  });

  it('is null when the two sides add up to 100% or more', () => {
    expect(findArb(q({ oddsAmerican: -110 }), [q({ sportsbook: 'fanduel', side: 'under', oddsAmerican: -110 })])).toBeNull();
    expect(findArb(q({ oddsAmerican: 100 }), [q({ sportsbook: 'fanduel', side: 'under', oddsAmerican: 100 })])).toBeNull();
  });

  it('ignores the same book and quotes captured more than 10 minutes apart', () => {
    expect(findArb(row, [q({ sportsbook: 'DraftKings ', side: 'under', oddsAmerican: 120 })])).toBeNull();
    expect(findArb(row, [q({ sportsbook: 'fanduel', side: 'under', oddsAmerican: 120, snapshotAt: '2026-11-04T18:45:00Z' })])).toBeNull();
    expect(findArb(row, [q({ sportsbook: 'fanduel', side: 'under', oddsAmerican: 120, snapshotAt: '2026-11-04T18:52:00Z' })])?.quoteGapMinutes).toBeCloseTo(8);
  });

  it('explains the bet for a $100 total', () => {
    const arb = findArb(row, [q({ sportsbook: 'fanduel', side: 'under', oddsAmerican: 100 })])!;
    expect(formatArbProfit(arb.profit)).toBe('Arb +2.4%');
    const text = arbInstructions({
      arb, side: 'over', sportsbook: 'draftkings',
      bookName: (b) => (b === 'fanduel' ? 'FanDuel' : 'DraftKings'),
      formatOdds: (a) => (a == null ? '—' : a > 0 ? `+${a}` : String(a)),
    });
    expect(text).toBe('Bet $49 on Over at DraftKings and $51 on Under +100 at FanDuel. Either result returns about $102.44.');
  });
});

describe('arb filter SQL', () => {
  it('needs a fresh opposite quote at another book, before tip, within the book filter', () => {
    const sql = arbExistsSql(null);
    expect(sql).toContain('g.start_time > now()');
    expect(sql).toContain('lower(trim(o.sportsbook)) <> lower(trim(p.sportsbook))');
    expect(sql).toContain('<= 600');
    expect(sql).not.toContain('ANY(');
    expect(arbExistsSql(4)).toContain('lower(trim(o.sportsbook)) = ANY($4)');
  });

  it('lists every book in the live feed', () => {
    expect(EXPLORER_BOOKS.map((b) => b.id)).toEqual(expect.arrayContaining(['ballybet', 'betway', 'betparx']));
  });
});
