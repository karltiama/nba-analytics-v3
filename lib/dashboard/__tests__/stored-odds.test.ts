import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GameCard, type Game } from '@/components/betting/GameCard';
import {
  STORED_ODDS_CACHE_CONTROL,
  STORED_ODDS_DATE,
  STORED_ODDS_FRESH_MS,
  STORED_ODDS_FUTURE_SKEW_MS,
  STORED_ODDS_SQL,
  applyStoredOdds,
  classifyStoredOddsRow,
  collectStoredOdds,
  draftKingsPatch,
  formatStoredEt,
  isStoredOddsCaption,
  mergeDashboardStoredOdds,
  parseStoredOddsPayload,
  storedOddsCaption,
  storedOddsFailureLog,
  storedOddsMapFromResponse,
  storedOddsResponseBody,
  type StoredOddsPatch,
  type StoredOddsSourceRow,
} from '@/lib/dashboard/stored-odds';

const NOW = new Date('2026-10-20T18:30:00.000Z');
const OBSERVED = '2026-10-20T17:41:01.317Z';
const STORED = '2026-10-20T18:20:00.000Z';
const FRESH_CAPTION = 'DraftKings · stored 2:20 PM ET · Recently saved';

function row(over: Partial<StoredOddsSourceRow> = {}): StoredOddsSourceRow {
  return {
    game_id: '21717856',
    vendor: 'draftkings',
    snapshot_at: OBSERVED,
    updated_at: STORED,
    home_moneyline: -180,
    away_moneyline: 150,
    home_spread: -4.5,
    home_spread_odds: -110,
    away_spread: 4.5,
    away_spread_odds: -110,
    total: 231.5,
    over_odds: -112,
    under_odds: -108,
    ...over,
  };
}

function pregame(over: Partial<Game> = {}): Game {
  return {
    id: '21717856',
    startTime: '7:00 PM ET',
    homeTeam: { id: '20', name: 'New York Knicks', abbreviation: 'NYK', record: null },
    awayTeam: { id: '23', name: 'Philadelphia 76ers', abbreviation: 'PHI', record: null },
    homeOdds: { moneyline: null, spread: null, spreadOdds: null },
    awayOdds: { moneyline: null, spread: null, spreadOdds: null },
    overUnder: null,
    overOdds: null,
    underOdds: null,
    homeImpliedProb: null,
    awayImpliedProb: null,
    isFavorite: null,
    isClose: false,
    hasOdds: false,
    scoreboard: { phase: 'pregame' } as Game['scoreboard'],
    ...over,
  };
}

describe('stored DraftKings dashboard odds', () => {
  it('reads only current DraftKings rows and does not write', () => {
    expect(STORED_ODDS_SQL).toContain('analytics.game_odds_current');
    expect(STORED_ODDS_SQL).toContain('c.snapshot_at');
    expect(STORED_ODDS_SQL).toContain('c.updated_at');
    expect(STORED_ODDS_SQL).not.toContain('provider_updated_at');
    expect(STORED_ODDS_SQL).toContain("lower(c.vendor) = 'draftkings'");
    expect(STORED_ODDS_SQL).toMatch(/start_time > \$2/);
    expect(STORED_ODDS_SQL).not.toMatch(/\b(insert|update|delete)\b/i);
    expect(STORED_ODDS_CACHE_CONTROL).toBe('no-store');
  });

  it('keeps home and away prices on their own teams and labels the observation', () => {
    expect(formatStoredEt(STORED)).toBe('2:20 PM ET');
    expect(formatStoredEt(OBSERVED)).toBe('1:41 PM ET');
    const patch = draftKingsPatch(row(), NOW);
    expect(applyStoredOdds(pregame(), patch).status).toBeUndefined();
    expect(patch).toMatchObject({
      status: 'fresh',
      storedAt: STORED,
      snapshotAt: new Date(OBSERVED).toISOString(),
      providerUpdatedAt: null,
      incomplete: false,
      oddsFreshness: 'fresh',
      homeOdds: { moneyline: -180, spread: -4.5, spreadOdds: -110 },
      awayOdds: { moneyline: 150, spread: 4.5, spreadOdds: -110 },
      overUnder: 231.5,
      overOdds: -112,
      underOdds: -108,
      hasOdds: true,
      marketCaption: FRESH_CAPTION,
    });
    expect(patch?.marketCaption).not.toMatch(/live|synced|provider updated|guaranteed/i);
    const html = renderToStaticMarkup(createElement(GameCard, { game: applyStoredOdds(pregame(), patch), presentation: 'scoreboard' }));
    expect(html).toContain('NYK -4.5');
    expect(html).toContain('PHI +4.5');
    expect(html).toContain('NYK -180');
    expect(html).toContain('PHI +150');
    expect(html).toContain('O/U 231.5');
    expect(html).toContain('O -112 / U -108');
    expect(html).toContain(FRESH_CAPTION);
    expect(html).toContain('data-odds-freshness="fresh"');
    expect(html).not.toContain('>LIVE<');
    expect(html).not.toContain('text-amber-800');
  });

  it('prints the stored Boston prices and does not fill a different price with -110', () => {
    const patch = draftKingsPatch(
      row({
        game_id: '21717855',
        home_moneyline: 105,
        away_moneyline: -125,
        home_spread: '1.5',
        away_spread: '-1.5',
        home_spread_odds: -105,
        away_spread_odds: -115,
        total: '220.5',
        over_odds: -112,
        under_odds: -108,
      }),
      NOW
    );
    expect(patch).toMatchObject({
      homeOdds: { moneyline: 105, spread: 1.5, spreadOdds: -105 },
      awayOdds: { moneyline: -125, spread: -1.5, spreadOdds: -115 },
      overUnder: 220.5,
      overOdds: -112,
      underOdds: -108,
    });
    const game = applyStoredOdds(
      pregame({
        id: '21717855',
        homeTeam: { id: 'DET', name: 'Pistons', abbreviation: 'DET', record: null },
        awayTeam: { id: 'BOS', name: 'Celtics', abbreviation: 'BOS', record: null },
      }),
      patch
    );
    const html = renderToStaticMarkup(createElement(GameCard, { game, presentation: 'scoreboard' }));
    expect(html).toContain('BOS -1.5');
    expect(html).toContain('DET +1.5');
    expect(html).toContain('O/U 220.5');
    expect(html).toContain('O -112 / U -108');
    expect(html).toContain('class="block whitespace-nowrap sm:hidden">O -112');
    expect(html).toContain('class="block whitespace-nowrap sm:hidden">U -108');
    expect(html).toContain('BOS -125');
    expect(html).toContain('DET +105');
    expect(html).not.toContain('-110');
  });

  it('leaves a missing total price blank', () => {
    const patch = draftKingsPatch(row({ over_odds: null, under_odds: null }), NOW);
    expect(patch?.overUnder).toBe(231.5);
    expect(patch?.overOdds).toBeNull();
    expect(patch?.underOdds).toBeNull();
    expect(patch?.incomplete).toBe(true);
    const html = renderToStaticMarkup(createElement(GameCard, { game: applyStoredOdds(pregame(), patch), presentation: 'scoreboard' }));
    expect(html).toContain('O — / U —');
    expect(html).not.toContain('-110');
  });

  it('labels a two-hour-old row stale and keeps the prices', () => {
    const storedAt = new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const patch = draftKingsPatch(row({ updated_at: storedAt, snapshot_at: storedAt }), NOW);
    expect(patch?.status).toBe('stale');
    expect(patch?.incomplete).toBe(false);
    expect(patch?.homeOdds.spread).toBe(-4.5);
    expect(patch?.marketCaption).toBe('DraftKings · Stale · stored Oct 20, 12:30 PM ET');
    const html = renderToStaticMarkup(createElement(GameCard, { game: applyStoredOdds(pregame(), patch), presentation: 'scoreboard' }));
    expect(html).toContain('data-odds-freshness="stale"');
    expect(html).toContain('text-amber-800');
    expect(html).toContain('Stale');
    expect(html).toContain('Oct 20, 12:30 PM ET');
    expect(html).toContain('NYK -4.5');
    expect(html).not.toContain('Recently saved');
    expect(html).not.toContain('>LIVE<');
  });

  it('treats a storedAt exactly 45 minutes old as fresh and one millisecond older as stale', () => {
    const onBoundary = new Date(NOW.getTime() - STORED_ODDS_FRESH_MS).toISOString();
    const pastBoundary = new Date(NOW.getTime() - STORED_ODDS_FRESH_MS - 1).toISOString();
    expect(draftKingsPatch(row({ updated_at: onBoundary, snapshot_at: onBoundary }), NOW)?.status).toBe('fresh');
    expect(draftKingsPatch(row({ updated_at: pastBoundary, snapshot_at: pastBoundary }), NOW)?.status).toBe('stale');
    expect(storedOddsCaption('stale', pastBoundary, NOW)).toContain('Oct 20,');
  });

  it('withholds missing, malformed, and future clocks and does not invent a provider time', () => {
    const ahead = new Date(NOW.getTime() + STORED_ODDS_FUTURE_SKEW_MS + 1).toISOString();
    const withinSkew = new Date(NOW.getTime() + 60_000).toISOString();
    expect(classifyStoredOddsRow(row({ updated_at: null }), NOW).outcome).toBe('withheld');
    expect(classifyStoredOddsRow(row({ snapshot_at: null }), NOW).outcome).toBe('withheld');
    expect(classifyStoredOddsRow(row({ updated_at: 'not-a-time' }), NOW).outcome).toBe('withheld');
    expect(classifyStoredOddsRow(row({ snapshot_at: ahead }), NOW).outcome).toBe('withheld');
    expect(classifyStoredOddsRow(row({ updated_at: ahead }), NOW).outcome).toBe('withheld');
    expect(draftKingsPatch(row({ updated_at: null }), NOW)).toBeNull();
    expect(draftKingsPatch(row({ snapshot_at: ahead, updated_at: STORED }), NOW)).toBeNull();
    expect(draftKingsPatch(row({ updated_at: withinSkew, snapshot_at: withinSkew }), NOW)?.status).toBe('fresh');
    const collected = collectStoredOdds(
      [row({ game_id: 'bad-clock', updated_at: null }), row({ game_id: 'other-book', vendor: 'fanduel' })],
      NOW
    );
    expect(collected.withheld).toEqual({ 'bad-clock': 'unknown' });
    expect(collected.odds['other-book']).toBeUndefined();
    expect(collected.withheld['other-book']).toBeUndefined();
  });

  it('leaves a game with no DraftKings row unavailable', () => {
    const collected = collectStoredOdds([row()], NOW);
    const slate = [pregame(), pregame({ id: 'missing-game' })];
    const merged = mergeDashboardStoredOdds(slate, storedOddsResponseBody(NOW, collected));
    expect(merged[0].hasOdds).toBe(true);
    expect(merged[1].hasOdds).toBe(false);
    expect(merged[1].marketCaption).toBeUndefined();
    expect(collected.withheld[slate[1].id]).toBeUndefined();
  });

  it('logs a database failure as a code and omits the connection string', () => {
    const logged = storedOddsFailureLog(Object.assign(new Error('connect postgres://user:secret@db.example/app'), { code: 'ECONNREFUSED' }));
    expect(logged).toEqual({ code: 'ECONNREFUSED' });
    expect(JSON.stringify(logged)).not.toContain('postgres');
    expect(storedOddsFailureLog(new Error('relation missing'))).toEqual({ code: 'unknown' });
  });

  it('maps the stored opening slate without swapping a home underdog', () => {
    const slate = [
      ['21717855', 'DET', 1.5, 'BOS', -1.5, 220.5, 105, -125],
      ['21717856', 'NYK', -4.5, 'PHI', 4.5, 231.5, -180, 150],
      ['21717857', 'SAS', -1.5, 'OKC', 1.5, 230.5, -112, -108],
      ['21717928', 'NOP', 3.5, 'IND', -3.5, 239.5, 136, -162],
    ] as const;
    for (const [id, home, homeSpread, away, awaySpread, total, homeMl, awayMl] of slate) {
      const patch = draftKingsPatch(
        row({
          game_id: id,
          home_spread: String(homeSpread),
          away_spread: String(awaySpread),
          home_spread_odds: id === '21717855' ? -105 : id === '21717857' ? -102 : id === '21717928' ? -105 : -110,
          away_spread_odds: id === '21717855' ? -115 : id === '21717857' ? -118 : id === '21717928' ? -115 : -110,
          total: String(total),
          over_odds: id === '21717857' ? -108 : -112,
          under_odds: id === '21717857' ? -112 : -108,
          home_moneyline: homeMl,
          away_moneyline: awayMl,
        }),
        NOW
      );
      expect(patch?.homeOdds, home).toMatchObject({ spread: homeSpread, moneyline: homeMl });
      expect(patch?.awayOdds, away).toMatchObject({ spread: awaySpread, moneyline: awayMl });
      expect(patch?.overUnder).toBe(total);
      expect(patch?.marketCaption).toBe(FRESH_CAPTION);
      expect(patch?.providerUpdatedAt).toBeNull();
    }
  });

  it('keeps a valid market when another market on the row is incomplete', () => {
    const patch = draftKingsPatch(row({ total: null, over_odds: null, under_odds: null, home_moneyline: 50 }), NOW);
    expect(patch?.overUnder).toBeNull();
    expect(patch?.homeOdds.moneyline).toBeNull();
    expect(patch?.homeOdds.spread).toBe(-4.5);
    expect(patch?.awayOdds.spread).toBe(4.5);
    expect(patch?.incomplete).toBe(true);
    expect(patch?.status).toBe('fresh');
  });

  it('returns nothing when the book, the time, or every market is unusable', () => {
    expect(draftKingsPatch(row({ vendor: 'fanduel' }), NOW)).toBeNull();
    expect(draftKingsPatch(row({ snapshot_at: null }), NOW)).toBeNull();
    expect(draftKingsPatch(row({ snapshot_at: '2026-10-20T18:40:00.000Z' }), NOW)).toBeNull();
    expect(draftKingsPatch(row({ home_spread: 4.5, away_spread: 4.5, home_moneyline: null, away_moneyline: null, total: null }), NOW)).toBeNull();
  });

  it('does not attach a stored quote to a live, final, already-quoted, or tipped card', () => {
    const patch = draftKingsPatch(row(), NOW);
    expect(applyStoredOdds(pregame({ hasOdds: true, homeOdds: { moneyline: -200, spread: -3, spreadOdds: -110 } }), patch).homeOdds.moneyline).toBe(-200);
    expect(applyStoredOdds(pregame({ scoreboard: { ...pregame().scoreboard!, phase: 'live' } }), patch).hasOdds).toBe(false);
    expect(applyStoredOdds(pregame({ scoreboard: { ...pregame().scoreboard!, phase: 'final' } }), patch).hasOdds).toBe(false);
    expect(applyStoredOdds(pregame({ scoreboard: undefined, schedulePreview: { tipPassed: true } }), patch).hasOdds).toBe(false);
    for (const phase of ['live', 'final'] as const) {
      const card = applyStoredOdds(pregame({ scoreboard: { ...pregame().scoreboard!, phase } }), patch);
      const html = renderToStaticMarkup(createElement(GameCard, { game: card, presentation: 'scoreboard' }));
      expect(html).not.toContain('data-odds-freshness');
      expect(html).not.toContain('Recently saved');
      expect(html).not.toContain('Stale');
      expect(html).not.toContain('Market spread');
      expect(html).toContain(phase === 'live' ? '>LIVE<' : '>FINAL<');
    }
  });

  it('shows the market panel on an upcoming preview card and keeps the tipped notice', () => {
    const patch = draftKingsPatch(row(), NOW)!;
    const upcoming = pregame({ scoreboard: undefined, schedulePreview: { tipPassed: false } });
    const upcomingHtml = renderToStaticMarkup(createElement(GameCard, { game: applyStoredOdds(upcoming, patch), presentation: 'scoreboard' }));
    expect(upcomingHtml).toContain('Market spread');
    expect(upcomingHtml).toContain('data-betting="visible"');
    expect(upcomingHtml).not.toContain('betting lines, and player stats are not shown');
    const tipped = pregame({ scoreboard: undefined, schedulePreview: { tipPassed: true } });
    const tippedHtml = renderToStaticMarkup(createElement(GameCard, { game: applyStoredOdds(tipped, patch), presentation: 'scoreboard' }));
    expect(tippedHtml).toContain('A live score is not available');
    expect(tippedHtml).not.toContain('Market spread');
  });
});

function patchFor(
  gameId: string,
  homeSpread: number,
  awaySpread: number,
  total: number,
  homeMoneyline = -180,
  awayMoneyline = 150
): StoredOddsPatch {
  return draftKingsPatch(
    row({
      game_id: gameId,
      home_spread: homeSpread,
      away_spread: awaySpread,
      home_moneyline: homeMoneyline,
      away_moneyline: awayMoneyline,
      total,
    }),
    NOW
  )!;
}

describe('dashboard stored-odds merge', () => {
  it('accepts only a real calendar date', () => {
    expect(STORED_ODDS_DATE.test('2026-10-20')).toBe(true);
    expect(STORED_ODDS_DATE.test('today')).toBe(false);
    expect(STORED_ODDS_DATE.test('2026-10-20;drop')).toBe(false);
  });

  it('merges October 20 quotes onto pregame cards and leaves the tipped game alone', () => {
    const bos = pregame({
      id: '21717855',
      awayTeam: { id: 'BOS', name: 'Celtics', abbreviation: 'BOS', record: null },
      homeTeam: { id: 'DET', name: 'Pistons', abbreviation: 'DET', record: null },
      scoreboard: { phase: 'live', seasonLabel: 'Regular season' } as Game['scoreboard'],
    });
    const phi = pregame({ id: '21717856' });
    const okc = pregame({
      id: '21717857',
      awayTeam: { id: 'OKC', name: 'Thunder', abbreviation: 'OKC', record: null },
      homeTeam: { id: 'SAS', name: 'Spurs', abbreviation: 'SAS', record: null },
    });
    const body = {
      odds: {
        '21717855': patchFor('21717855', 1.5, -1.5, 220.5),
        '21717856': patchFor('21717856', -4.5, 4.5, 231.5),
        '21717857': patchFor('21717857', -1.5, 1.5, 230.5),
      },
    };
    const merged = mergeDashboardStoredOdds([bos, phi, okc], body);
    expect(merged[0].hasOdds).toBe(false);
    expect(merged[1]).toMatchObject({ overUnder: 231.5, awayOdds: { spread: 4.5 }, homeOdds: { spread: -4.5 } });
    expect(merged[2]).toMatchObject({ overUnder: 230.5, awayOdds: { spread: 1.5 }, homeOdds: { spread: -1.5 } });
    const html = renderToStaticMarkup(createElement(GameCard, { game: merged[1], presentation: 'scoreboard' }));
    expect(html).toContain('PHI +4.5');
    expect(html).toContain('NYK -4.5');
    expect(html).toContain(FRESH_CAPTION);
    expect(html).toContain('data-odds-freshness="fresh"');
  });

  it('switches to the October 21 slate, including the home underdog', () => {
    const nop = pregame({
      id: '21717928',
      awayTeam: { id: 'IND', name: 'Pacers', abbreviation: 'IND', record: null },
      homeTeam: { id: 'NOP', name: 'Pelicans', abbreviation: 'NOP', record: null },
    });
    const others = Array.from({ length: 10 }, (_, index) => pregame({ id: `2026-10-21-${index}` }));
    const odds: Record<string, StoredOddsPatch> = {
      '21717928': patchFor('21717928', 3.5, -3.5, 239.5, 136, -162),
    };
    for (const game of others) odds[game.id] = patchFor(game.id, -1.5, 1.5, 220.5);
    const merged = mergeDashboardStoredOdds([nop, ...others], { odds });
    expect(merged).toHaveLength(11);
    expect(merged[0]).toMatchObject({ homeOdds: { spread: 3.5, moneyline: 136 }, awayOdds: { spread: -3.5, moneyline: -162 } });
    expect(merged.every((game) => game.hasOdds)).toBe(true);
    const staleOctober20 = mergeDashboardStoredOdds([nop], { odds: { '21717856': patchFor('21717856', -4.5, 4.5, 231.5) } });
    expect(staleOctober20[0].hasOdds).toBe(false);
  });

  it('keeps the slate unchanged when the odds response fails or is unlabeled', () => {
    const slate = [pregame()];
    expect(mergeDashboardStoredOdds(slate, null)[0].hasOdds).toBe(false);
    expect(mergeDashboardStoredOdds(slate, { error: 'stored_odds_unavailable' })[0].hasOdds).toBe(false);
    expect(parseStoredOddsPayload({ odds: { '21717856': { hasOdds: true, marketCaption: 'DraftKings · BDL synced 1m ago' } } })).toEqual({});
    const quoted = pregame({ hasOdds: true, overUnder: 200, marketCaption: 'DraftKings · BDL synced 3m ago' });
    expect(mergeDashboardStoredOdds([quoted], { odds: { '21717856': patchFor('21717856', -4.5, 4.5, 231.5) } })[0].overUnder).toBe(200);
    const patch = patchFor('21717856', -4.5, 4.5, 231.5);
    expect(parseStoredOddsPayload({ odds: { '21717856': { ...patch, providerUpdatedAt: STORED } } })).toEqual({});
    expect(parseStoredOddsPayload({ odds: { '21717856': { ...patch, marketCaption: 'DraftKings · live 2:20 PM ET · Recently saved' } } })).toEqual({});
    expect(isStoredOddsCaption('DraftKings · stored 2:20 PM ET · Recently saved', 'fresh')).toBe(true);
    expect(isStoredOddsCaption('Open DraftKings · stored 2:20 PM ET · Recently saved', 'fresh')).toBe(false);
  });

  it('clears an overlay from the base slate after a non-OK response', () => {
    const base = [pregame()];
    const patch = patchFor('21717856', -4.5, 4.5, 231.5);
    const shown = mergeDashboardStoredOdds(base, { asOf: NOW.toISOString(), odds: { '21717856': patch }, withheld: {} });
    expect(shown[0].hasOdds).toBe(true);
    expect(shown[0]).not.toBe(base[0]);
    expect(base[0].hasOdds).toBe(false);
    expect(storedOddsMapFromResponse(false, { odds: { '21717856': patch } })).toEqual({});
    const cleared = mergeDashboardStoredOdds(base, { odds: storedOddsMapFromResponse(false, { odds: { '21717856': patch } }) });
    expect(cleared[0].hasOdds).toBe(false);
    expect(cleared[0].marketCaption).toBeUndefined();
    expect(cleared[0].oddsFreshness).toBeUndefined();
  });

  it('returns one asOf with null provider clocks and keeps no-store on the route', () => {
    const collected = collectStoredOdds([row(), row({ game_id: 'bad', updated_at: null })], NOW);
    const body = storedOddsResponseBody(NOW, collected);
    expect(body.asOf).toBe(NOW.toISOString());
    expect(body.odds['21717856'].providerUpdatedAt).toBeNull();
    expect(body.odds['21717856'].storedAt).toBe(STORED);
    expect(body.withheld).toEqual({ bad: 'unknown' });
    const route = readFileSync('app/api/dashboard/stored-odds/route.ts', 'utf8');
    const page = readFileSync('app/dashboard/page.tsx', 'utf8');
    const card = readFileSync('components/betting/GameCard.tsx', 'utf8');
    expect(route).toContain('STORED_ODDS_CACHE_CONTROL');
    expect(route).not.toMatch(/balldontlie|\binsert\b|\bupdate\b|\bdelete\b/i);
    expect(route).not.toContain('sportsbook-handoff');
    expect(page).toContain('STORED_ODDS_MIN_REFRESH_MS');
    expect(page).not.toContain('sportsbook-handoff');
    expect(card).not.toContain('sportsbook-handoff');
    const pollStart = page.indexOf('const scoreboardPollDelay');
    const pollEnd = page.indexOf('const previewActive');
    expect(page.slice(pollStart, pollEnd)).not.toContain('stored-odds');
  });
});
