import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildBoxLines, buildGameRecap, buildStartersRecap, type ClosingLine, type RecapBoxInput } from '@/lib/pregame-matchup/recap';
import { closingLine, type BookOddsRow } from '@/lib/pregame-matchup/odds-consensus';
import { GameRecap } from '@/components/matchup/GameRecap';
import { PregameMatchupView } from '@/components/scoreboard/PregameMatchupView';
import type { PregameMatchupModel } from '@/lib/pregame-matchup/compose';

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

const box = (playerId: string, over: Partial<RecapBoxInput> = {}): RecapBoxInput => ({
  playerId,
  name: `Name ${playerId}`,
  minutes: '20:00',
  points: 10,
  rebounds: 4,
  assists: 2,
  steals: 1,
  blocks: 0,
  turnovers: 1,
  fgm: 4,
  fga: 9,
  tpm: 1,
  tpa: 3,
  ftm: 1,
  fta: 2,
  plusMinus: 3,
  ...over,
});

const noTeams = { teams: [] };

describe('buildGameRecap', () => {
  it('grades the final against the closing spread, total, favorite and move', () => {
    const recap = buildGameRecap({ awayAbbr: 'POR', homeAbbr: 'PHX', awayScore: 132, homeScore: 119, close: close(), ...noTeams });
    expect(recap.headline).toBe('POR won at PHX 132–119');
    expect(recap.score).toEqual({ away: 132, home: 119 });
    expect(recap.market).toEqual([
      { label: 'Spread', chip: 'POR covered', text: 'Closed POR −2.5. POR covered by 10.5.' },
      { label: 'Total', chip: 'Over 23.5', text: 'Closed 227.5. Final total 251: Over by 23.5.' },
      { label: 'Favorite', chip: 'Favorite won', text: 'POR won as 57% favorites (no-vig).' },
      {
        label: 'Line move',
        chip: 'Toward PHX',
        text: 'Spread moved toward PHX (PHX +3.5 → +2.5); POR covered · total moved down (228.5 → 227.5); went over.',
      },
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
      ...noTeams,
    });
    expect(recap.headline).toBe('LAC beat MIA 113–110 (2OT)');
    expect(recap.market.map((m) => [m.chip, m.text])).toEqual([
      ['Push', 'Closed LAC −3. Push.'],
      ['Push', 'Closed 223. Final total 223: Push.'],
      ['Favorite won', 'LAC won as 60% favorites (no-vig).'],
      ['Steady', 'Lines held steady from our first pull to tip.'],
    ]);
  });

  it('calls an upset when the no-vig underdog wins', () => {
    const recap = buildGameRecap({ awayAbbr: 'IND', homeAbbr: 'MEM', awayScore: 107, homeScore: 103, close: close({ spread: -5.5, homeProb: 67 }), ...noTeams });
    expect(recap.market.find((m) => m.label === 'Favorite')).toEqual({
      label: 'Favorite',
      chip: 'Upset',
      text: 'IND won as 33% underdogs (no-vig).',
    });
  });

  it('says so when no closing line is stored', () => {
    const recap = buildGameRecap({ awayAbbr: 'A', homeAbbr: 'B', awayScore: 100, homeScore: 101, close: null, ...noTeams });
    expect(recap.market).toEqual([]);
    expect(recap.marketNote).toBe('No closing line stored for this game.');
  });
});

describe('buildStartersRecap', () => {
  it('compares the starting five with the previous game', () => {
    const prev = five('p');
    const actual = [...prev.slice(0, 3), { playerId: 'n1', name: 'New One' }, { playerId: 'n2', name: 'New Two' }];
    const team = buildStartersRecap({ actual, previous: { date: '2026-11-02', players: prev } })!;
    expect(team.summary).toBe('3 of 5 starters from the previous game (Nov 2).');
    expect(team.in.map((p) => p.name)).toEqual(['New One', 'New Two']);
    expect(team.out.map((p) => p.playerId)).toEqual(['p4', 'p5']);
    expect(buildStartersRecap({ actual: prev, previous: { date: '2026-11-02', players: prev } })!.summary).toBe(
      'Same five as the previous game (Nov 2).'
    );
    expect(buildStartersRecap({ actual: prev, previous: null })!.summary).toBe('First starting five on record this season.');
    expect(buildStartersRecap({ actual: [], previous: null })).toBeNull();
  });
});

describe('buildBoxLines', () => {
  it('orders starters, then bench by minutes, and marks players who did not play', () => {
    const rows = [
      box('bench-short', { minutes: '9:42', points: 0 }),
      box('dnp', { minutes: '0', points: 0, rebounds: 0, assists: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, steals: 0, turnovers: 0, plusMinus: 0 }),
      box('starter', { minutes: '33:10', points: 26 }),
      box('bench-long', { minutes: '21:57', points: 3 }),
    ];
    const { players, totals } = buildBoxLines(rows, new Set(['starter']));
    expect(players.map((p) => [p.playerId, p.starter, p.dnp, p.min])).toEqual([
      ['starter', true, false, '33:10'],
      ['bench-long', false, false, '21:57'],
      ['bench-short', false, false, '9:42'],
      ['dnp', false, true, 'DNP'],
    ]);
    expect(players[0]).toMatchObject({ fg: '4-9', tp: '1-3', ft: '1-2', pm: 3 });
    expect(totals).toMatchObject({ pts: 29, fg: '12-27', tp: '3-9', ft: '3-6' });
    expect(buildBoxLines([], new Set())).toEqual({ players: [], totals: null });
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

function recapFixture() {
  const prev = five('p');
  return buildGameRecap({
    awayAbbr: 'POR',
    homeAbbr: 'PHX',
    awayScore: 132,
    homeScore: 119,
    close: close(),
    teams: [
      {
        teamId: '1',
        abbr: 'POR',
        name: 'Portland Trail Blazers',
        starters: { actual: [...prev.slice(0, 4), { playerId: 'n1', name: 'New One' }], previous: { date: '2026-11-02', players: prev } },
        box: [box('n1', { name: 'New One', points: 30 }), box('b1', { name: 'Bench One' }), box('d1', { name: 'Sat Out', minutes: '0', points: 0, rebounds: 0, assists: 0, fga: 0, fta: 0 })],
      },
      { teamId: '2', abbr: 'PHX', name: 'Phoenix Suns', starters: null, box: [] },
    ],
  });
}

describe('GameRecap', () => {
  it('renders result tiles and a box score per team tab, away first, with starters marked', () => {
    const html = renderToStaticMarkup(createElement(GameRecap, { recap: recapFixture(), flow: true }));
    expect(html).toMatch(/data-box-tab="POR"[^>]*>POR 132</);
    expect(html).toMatch(/data-box-tab="PHX"[^>]*>PHX 119</);
    // Only the selected (away) team's table is rendered until the other tab is opened.
    expect(html).not.toContain('Box score not loaded yet.');
    expect(html).toContain('id="section-recap"');
    expect(html).toContain('id="section-box"');
    expect(html).toContain('data-recap-tile="Spread"');
    expect(html).toContain('POR covered</span>');
    expect(html).toContain('data-box-player="n1" data-starter="true"');
    expect(html).toContain('href="/betting/players/n1">New One</a>');
    expect(html).toContain('New in the five: ');
    expect(html).toMatch(/Did not play: <span><a [^>]*href="\/betting\/players\/d1">Sat Out<\/a><\/span>/);
    expect(html).not.toMatch(/won \$|payout|profit/i);
  });
});

describe('PregameMatchupView on a Final game', () => {
  it('shows the score in the header, the recap first, and hides today’s injury sections', () => {
    const model = {
      gameId: '1',
      awayAbbr: 'POR',
      awayName: 'Portland Trail Blazers',
      homeAbbr: 'PHX',
      homeName: 'Phoenix Suns',
      tipLabel: '9:00 PM ET',
      seasonLabel: 'Regular season',
      statusLabel: 'Final',
      updatedLabel: 'Scoreboard',
      returnHref: '/dashboard',
      history: null,
      historyNote: null,
      current: null,
      currentNote: null,
      context: null,
      insights: [],
      contributors: null,
      roster: { status: 'unavailable', note: 'Roster unavailable.' },
      quote: null,
      quoteNote: 'Pregame prices stay off once the game has tipped.',
      recap: recapFixture(),
    } as unknown as PregameMatchupModel;
    const html = renderToStaticMarkup(createElement(PregameMatchupView, { model }));
    expect(html).toContain('data-header-score');
    expect(html).toContain('href="#section-box"');
    expect(html).toContain('data-before-game');
    expect(html.indexOf('data-game-recap')).toBeLessThan(html.indexOf('id="section-story"'));
    expect(html).not.toContain('Pregame prices stay off');
  });
});
