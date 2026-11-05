import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildGameRecap, buildStartersRecap, type ClosingLine } from '@/lib/pregame-matchup/recap';
import { closingLine, type BookOddsRow } from '@/lib/pregame-matchup/odds-consensus';
import { GameRecap } from '@/components/matchup/GameRecap';

const close = (over: Partial<ClosingLine> = {}): ClosingLine => ({
  spread: 2.5,
  total: 227.5,
  homeProb: 43,
  books: 10,
  openSpread: 3.5,
  openTotal: 228.5,
  ...over,
});

const five = (prefix: string) => [1, 2, 3, 4, 5].map((i) => ({ playerId: `${prefix}${i}`, name: `${prefix.toUpperCase()} Player ${i}` }));

describe('buildGameRecap', () => {
  it('grades the final against the closing spread, total, favorite and move', () => {
    const recap = buildGameRecap({ awayAbbr: 'POR', homeAbbr: 'PHX', awayScore: 132, homeScore: 119, close: close(), starters: null });
    expect(recap.headline).toBe('POR won at PHX 132–119');
    expect(recap.market).toEqual([
      { label: 'Spread', text: 'Closed POR −2.5. POR covered by 10.5.' },
      { label: 'Total', text: 'Closed 227.5. Final total 251: Over by 23.5.' },
      { label: 'Favorite', text: 'POR won as 57% favorites (no-vig).' },
      { label: 'Line move', text: 'Spread moved toward PHX (PHX +3.5 → +2.5); POR covered · total moved down (228.5 → 227.5); went over.' },
    ]);
    expect(recap.marketCaption).toBe('Closing consensus of 10 sportsbooks, last pull before tip');
  });

  it('calls pushes and overtime', () => {
    const recap = buildGameRecap({
      awayAbbr: 'MIA',
      homeAbbr: 'LAC',
      awayScore: 110,
      homeScore: 113,
      overtimePeriods: 2,
      close: close({ spread: -3, total: 223, homeProb: 60, openSpread: -3, openTotal: 223 }),
      starters: null,
    });
    expect(recap.headline).toBe('LAC beat MIA 113–110 (2OT)');
    expect(recap.market.map((m) => m.text)).toEqual([
      'Closed LAC −3. Push.',
      'Closed 223. Final total 223: Push.',
      'LAC won as 60% favorites (no-vig).',
      'Lines held steady from our first pull to tip.',
    ]);
  });

  it('calls an upset when the no-vig underdog wins', () => {
    const recap = buildGameRecap({ awayAbbr: 'IND', homeAbbr: 'MEM', awayScore: 107, homeScore: 103, close: close({ spread: -5.5, homeProb: 67 }), starters: null });
    expect(recap.market.find((m) => m.label === 'Favorite')!.text).toBe('Upset: IND won as 33% underdogs (no-vig).');
  });

  it('says so when no closing line is stored', () => {
    const recap = buildGameRecap({ awayAbbr: 'A', homeAbbr: 'B', awayScore: 100, homeScore: 101, close: null, starters: null });
    expect(recap.market).toEqual([]);
    expect(recap.marketNote).toBe('No closing line stored for this game.');
    expect(recap.starters).toBeNull();
  });
});

describe('buildStartersRecap', () => {
  it('compares the starting five with the previous game', () => {
    const prev = five('p');
    const actual = [...prev.slice(0, 3), { playerId: 'n1', name: 'New One' }, { playerId: 'n2', name: 'New Two' }];
    const team = buildStartersRecap({ teamId: '1', abbr: 'BOS', actual, previous: { date: '2026-11-02', players: prev } })!;
    expect(team.summary).toBe('3 of 5 from the previous game (Nov 2).');
    expect(team.in.map((p) => p.name)).toEqual(['New One', 'New Two']);
    expect(team.out.map((p) => p.playerId)).toEqual(['p4', 'p5']);
    expect(buildStartersRecap({ teamId: '1', abbr: 'BOS', actual: prev, previous: { date: '2026-11-02', players: prev } })!.summary).toBe(
      'Same five as the previous game (Nov 2).'
    );
    expect(buildStartersRecap({ teamId: '1', abbr: 'BOS', actual: prev, previous: null })!.summary).toBe('First starting five on record this season.');
    expect(buildStartersRecap({ teamId: '1', abbr: 'BOS', actual: [], previous: null })).toBeNull();
  });
});

describe('closingLine', () => {
  const tip = '2026-11-05T02:00:00Z';
  const row = (vendor: string, snapshotAt: string, homeSpread: number, total: number): BookOddsRow => ({
    vendor,
    snapshotAt,
    homeMoneyline: 120,
    awayMoneyline: -140,
    homeSpread,
    homeSpreadOdds: -110,
    awaySpreadOdds: -110,
    total,
    overOdds: -110,
    underOdds: -110,
  });

  it('uses each book’s last pregame price and the first pull for the move', () => {
    const rows = [
      row('draftkings', '2026-11-04T13:00:00Z', 3.5, 228.5),
      row('fanduel', '2026-11-04T13:00:00Z', 3.5, 228.5),
      row('draftkings', '2026-11-05T01:45:00Z', 2.5, 227.5),
      row('fanduel', '2026-11-05T01:45:00Z', 2.5, 227.5),
      row('draftkings', '2026-11-05T02:30:00Z', 9.5, 240.5),
      row('polymarket', '2026-11-05T01:45:00Z', 9.5, 240.5),
    ];
    expect(closingLine(rows, tip)).toEqual({ spread: 2.5, total: 227.5, homeProb: expect.any(Number), books: 2, openSpread: 3.5, openTotal: 228.5 });
    expect(closingLine(rows.slice(0, 1), tip)).toBeNull();
    expect(closingLine(rows, null)).toBeNull();
  });
});

describe('GameRecap', () => {
  it('renders the market lines and linked starters', () => {
    const prev = five('p');
    const recap = buildGameRecap({
      awayAbbr: 'POR',
      homeAbbr: 'PHX',
      awayScore: 132,
      homeScore: 119,
      close: close(),
      starters: [{ teamId: '1', abbr: 'POR', actual: [...prev.slice(0, 4), { playerId: 'n1', name: 'New One' }], previous: { date: '2026-11-02', players: prev } }],
    });
    const html = renderToStaticMarkup(createElement(GameRecap, { recap, flow: true }));
    expect(html).toContain('id="section-recap"');
    expect(html).toContain('POR covered by 10.5.');
    expect(html).toContain('href="/betting/players/n1">New One</a>');
    expect(html).toContain('New in the five: ');
    expect(html).toContain('Dropped: ');
    expect(html).not.toMatch(/won \$|payout|profit/i);
  });
});
