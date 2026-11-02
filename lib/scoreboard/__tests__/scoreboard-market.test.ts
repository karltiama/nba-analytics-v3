import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GameCard } from '@/components/betting/GameCard';
import type { AcquiringBdlFetch } from '@/lib/games/status-sync-acquisition';
import type { StoredOddsQuote, StoredScoreboardGame } from '@/lib/scoreboard/contract';
import { runScoreboardCycle, scoreboardOddsUrl } from '@/lib/scoreboard/collector';
import { scoreboardPollDelayMs, SCOREBOARD_MARKET_REFRESH_MS } from '@/lib/scoreboard/client';
import { auditPregameGame, auditPregameMarket, scoreboardGame, scoreboardResponse } from '@/lib/scoreboard/fixtures';
import { resolveScoreboardCollection, resolveScoreboardOddsCollection } from '@/lib/scoreboard/flags';
import {
  checkMarkets,
  marketSourceCaption,
  normalizeOddsRows,
  oddsDue,
  oddsEligibleGames,
  SCOREBOARD_ODDS_POLICY,
  selectMarket,
} from '@/lib/scoreboard/market';
import { presentMarket } from '@/lib/scoreboard/present';
import { serveScoreboard } from '@/lib/scoreboard/serve';
import { mergeTodaysGames, scoreboardToSlateGame } from '@/lib/scoreboard/slate-merge';
import { createMemoryScoreboardStore, type ScoreboardStore } from '@/lib/scoreboard/store';

const TIP = '2026-10-10T00:00:00.000Z';
const MIN = 60_000;
const at = (offsetMs: number) => new Date(Date.parse(TIP) + offsetMs);
const NOW = at(-180 * MIN);

const LIVE_ENV = {
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
  LIVE_INGESTION_ENABLED: '1',
  SCOREBOARD_COLLECT_PRESEASON: '1',
  SCOREBOARD_TARGET_SEASON: '2026',
};
const ODDS_ENV = { ...LIVE_ENV, SCOREBOARD_COLLECT_ODDS: '1' };

/** Shape and values of the audited DraftKings /v2/odds row for game 21717909 (strings for lines, as BDL sends). */
function oddsRow(over: Record<string, unknown> = {}) {
  return {
    id: 306617711,
    game_id: 5001,
    vendor: 'draftkings',
    spread_home_value: '-2.5',
    spread_home_odds: -110,
    spread_away_value: '2.5',
    spread_away_odds: -110,
    moneyline_home_odds: -135,
    moneyline_away_odds: 114,
    total_value: '230.5',
    total_over_odds: -110,
    total_under_odds: -110,
    updated_at: new Date(NOW.getTime() - MIN).toISOString(),
    deeplinkSelections: ['spread_home'],
    ...over,
  };
}

function stored(over: Partial<StoredScoreboardGame> = {}): StoredScoreboardGame {
  return {
    gameId: '5001',
    season: 2026,
    seasonType: 'preseason',
    seasonTypeSource: 'request_season_type',
    etDate: '2026-10-09',
    scheduledTip: TIP,
    homeTeamId: '5',
    homeAbbr: 'CHI',
    homeName: 'Chicago Bulls',
    homeScore: null,
    visitorTeamId: '15',
    visitorAbbr: 'MEM',
    visitorName: 'Memphis Grizzlies',
    visitorScore: null,
    providerStatus: TIP,
    providerStatusState: null,
    period: 0,
    clock: null,
    overtimePeriods: 0,
    lifecycle: 'scheduled',
    gamesRequestId: 'req-0',
    firstObservedAt: at(-48 * 60 * MIN).toISOString(),
    lastObservedAt: new Date(NOW.getTime() - MIN).toISOString(),
    lastChangedAt: at(-48 * 60 * MIN).toISOString(),
    terminalConfirmations: 0,
    finalObservedAt: null,
    pollingState: 'pending',
    boxCompleteness: 'none',
    boxRequestId: null,
    boxObservedAt: null,
    finalBoxAttempts: 0,
    ...over,
  };
}

function quote(over: Partial<StoredOddsQuote> = {}): StoredOddsQuote {
  const observed = new Date(NOW.getTime() - 2 * MIN).toISOString();
  return {
    gameId: '5001',
    vendor: 'draftkings',
    quoteKind: 'current',
    moneylineHome: -135,
    moneylineAway: 114,
    spreadHome: -2.5,
    spreadHomeOdds: -110,
    spreadAway: 2.5,
    spreadAwayOdds: -110,
    total: 230.5,
    totalOverOdds: -110,
    totalUnderOdds: -110,
    providerUpdatedAt: observed,
    vendorSyncedAt: observed,
    openedAt: null,
    firstObservedAt: observed,
    observedAt: observed,
    requestId: 'req-odds',
    withdrawnAt: null,
    withdrawnRequestId: null,
    ...over,
  };
}

type OddsReply = { data: unknown[]; next_cursor?: number | null } | { status: number } | { blocked: string } | 'throw';

function fakeFetchers(odds: (url: string, pageIndex: number) => OddsReply, games: () => unknown[] = () => []) {
  const calls: string[] = [];
  let n = 0;
  const evidence = () => {
    n += 1;
    return { requestIds: [`req-${n}`], archiveStatuses: ['ARCHIVED' as const], s3Keys: [], blockedReason: null };
  };
  const list =
    (respond: () => unknown[]): AcquiringBdlFetch =>
    async (url) => {
      calls.push(url);
      return { status: 200, ok: true, json: { data: respond() as never[], meta: { next_cursor: null } }, acquisition: evidence() };
    };
  const oddsFetch: AcquiringBdlFetch = async (url, ctx) => {
    calls.push(url);
    const out = odds(url, ctx?.pageIndex ?? 0);
    if (out === 'throw') throw new Error('socket hang up');
    const ev = evidence();
    if ('blocked' in out) return { status: 200, ok: false, acquisition: { ...ev, blockedReason: out.blocked } };
    if ('status' in out) return { status: out.status, ok: false, acquisition: ev };
    return {
      status: 200,
      ok: true,
      json: { data: out.data as never[], meta: { next_cursor: out.next_cursor ?? null } },
      acquisition: ev,
    };
  };
  return { fetch: { games: list(games), liveBox: list(() => []), odds: oddsFetch }, calls };
}

/** Stored scheduled game 3 hours before tip, with a games request one minute ago (no games call due). */
function seededStore(games: StoredScoreboardGame[] = [stored()]) {
  const store = createMemoryScoreboardStore();
  for (const g of games) store.games.set(g.gameId, g);
  store.gamesRequests.set('preseason', { at: new Date(NOW.getTime() - MIN).toISOString(), requestId: 'req-0' });
  return store;
}

const oddsCalls = (calls: string[]) => calls.filter((u) => u.includes('/v2/odds'));

describe('odds parsing: exact identity, field-level quarantine', () => {
  const ctx = { eligibleGameIds: new Set(['5001']), observedAt: NOW.toISOString() };

  it('parses the audited row shape: string lines become numbers, prices stay integers', () => {
    const r = normalizeOddsRows([{ rows: [oddsRow()], requestId: 'req-1' }], ctx);
    expect(r.rejected).toEqual([]);
    expect(r.quotes).toHaveLength(1);
    expect(r.quotes[0]).toMatchObject({
      gameId: '5001',
      vendor: 'draftkings',
      quoteKind: 'current',
      moneylineHome: -135,
      moneylineAway: 114,
      spreadHome: -2.5,
      spreadAway: 2.5,
      total: 230.5,
      requestId: 'req-1',
      openedAt: null,
    });
  });

  it('a row for a game that is not eligible is dropped, so odds never add a game', () => {
    const r = normalizeOddsRows([{ rows: [oddsRow({ game_id: 5002 }), oddsRow({ game_id: '5001x' })], requestId: 'r' }], ctx);
    expect(r.quotes).toEqual([]);
    expect(r.rejected.map((x) => x.reason)).toEqual(['not_eligible_game', 'invalid_game_id']);
  });

  it('malformed prices and lines are stored as null individually; the rest of the row survives', () => {
    const r = normalizeOddsRows(
      [{ rows: [oddsRow({ moneyline_home_odds: 'abc', spread_home_value: '-2.25', total_over_odds: -110.5, total_under_odds: 50 })], requestId: 'r' }],
      ctx
    );
    expect(r.quarantinedFields).toBe(4);
    expect(r.quotes[0]).toMatchObject({ moneylineHome: null, moneylineAway: 114, spreadHome: null, totalOverOdds: null, totalUnderOdds: null, total: 230.5 });
  });

  it('duplicate vendor rows keep the newer provider sync; vendor sync time spans pages', () => {
    const old = oddsRow({ moneyline_home_odds: -150, updated_at: new Date(NOW.getTime() - 5 * MIN).toISOString() });
    const fresh = oddsRow({ moneyline_home_odds: -135 });
    const r = normalizeOddsRows(
      [
        { rows: [fresh], requestId: 'p1' },
        { rows: [old], requestId: 'p2' },
      ],
      ctx
    );
    expect(r.quotes).toHaveLength(1);
    expect(r.quotes[0].moneylineHome).toBe(-135);
    expect(r.quotes[0].requestId).toBe('p1');
    expect(r.rejected.map((x) => x.reason)).toEqual(['duplicate_vendor_row']);
  });

  it('the odds URL asks only for the eligible game ids', () => {
    const url = scoreboardOddsUrl(['21826163', '21717909'], 7);
    expect(url).toBe('https://api.balldontlie.io/v2/odds?game_ids%5B%5D=21826163&game_ids%5B%5D=21717909&per_page=100&cursor=7');
    expect(url).not.toMatch(/season_type|dates/);
  });
});

describe('American odds validation', () => {
  const ml = (home: unknown, away: unknown, over: Partial<StoredOddsQuote> = {}) =>
    checkMarkets(quote({ moneylineHome: home as number, moneylineAway: away as number, ...over })).moneyline;

  it('accepts valid +100 sportsbook prices: +100 against a favorite, and a fair even-money pair', () => {
    expect(ml(100, -120)).toEqual({ home: 100, away: -120 });
    expect(ml(-120, 100)).toEqual({ home: -120, away: 100 });
    expect(ml(100, -100, { spreadHome: -1, spreadAway: 1 })).toEqual({ home: 100, away: -100 });
    expect(ml(100, 100, { spreadHome: 1.5, spreadAway: -1.5 })).toEqual({ home: 100, away: 100 });
    const m = checkMarkets(quote({ spreadHomeOdds: 100, spreadAwayOdds: -120, totalOverOdds: -100, totalUnderOdds: 100 }));
    expect(m.spread).toMatchObject({ home_odds: 100, away_odds: -120 });
    expect(m.total).toMatchObject({ over_odds: -100, under_odds: 100 });
  });

  it('accepts valid opposing pairs from the audited capture', () => {
    expect(ml(-135, 114)).toEqual({ home: -135, away: 114 });
    expect(ml(200, -245, { spreadHome: 7.5, spreadAway: -7.5 })).toEqual({ home: 200, away: -245 });
    expect(ml(-110, -110, { spreadHome: -1, spreadAway: 1 })).toEqual({ home: -110, away: -110 });
  });

  it('-100 and +100 are the same price: neither side is the favorite, so either spread side is allowed', () => {
    for (const [sh, sa] of [
      [-1.5, 1.5],
      [1.5, -1.5],
    ]) {
      const m = checkMarkets(quote({ moneylineHome: -100, moneylineAway: 100, spreadHome: sh, spreadAway: sa }));
      expect(m.moneyline, `${sh}`).not.toBeNull();
      expect(m.spread, `${sh}`).not.toBeNull();
    }
  });

  it('a dead-even moneyline that contradicts a large spread in its own row is dropped; the spread stays', () => {
    const m = checkMarkets(quote({ moneylineHome: 100, moneylineAway: 100, spreadHome: -7.5, spreadAway: 7.5 }));
    expect(m.moneyline).toBeNull();
    expect(m.spread).toMatchObject({ home: -7.5, away: 7.5 });
  });

  it('prediction-market placeholder records never reach a card, whatever their prices', () => {
    const game = { gameId: '5001', lifecycle: 'scheduled' as const, scheduledTip: TIP };
    for (const vendor of ['kalshi', 'polymarket']) {
      const placeholder = quote({ vendor, moneylineHome: 100, moneylineAway: 100, spreadHome: null, spreadAway: null, total: null });
      const plausible = quote({ vendor });
      expect(selectMarket({ game, now: NOW, quotes: [placeholder, plausible] })).toMatchObject({ status: 'unavailable', market: null });
    }
  });

  it('missing one side blanks that market only', () => {
    expect(ml(-135, null)).toBeNull();
    expect(ml(null, 114)).toBeNull();
    const m = checkMarkets(quote({ spreadAway: null, totalUnderOdds: null }));
    expect(m.spread).toBeNull();
    expect(m.total).toEqual({ line: 230.5, over_odds: null, under_odds: null });
    expect(m.moneyline).not.toBeNull();
  });

  it('rejects an impossible or absurd overround', () => {
    expect(ml(110, 110)).toBeNull();
    expect(ml(105, -102)).toBeNull();
    expect(ml(-500, -500)).toBeNull();
    expect(ml(-300, -110)).toBeNull();
  });

  it('rejects null and malformed prices', () => {
    for (const bad of [null, undefined, '', 'abc', '0x64', '1e2', 99, -99, 0, 110.5, '110.5', NaN, Infinity, 200_000, {}, []]) {
      expect(ml(bad, 114), String(bad)).toBeNull();
    }
    expect(ml('-135', '+114')).toEqual({ home: -135, away: 114 });
  });
});

describe('spread and total precision', () => {
  const ctx = { eligibleGameIds: new Set(['5001']), observedAt: NOW.toISOString() };
  const parse = (over: Record<string, unknown>) => normalizeOddsRows([{ rows: [oddsRow(over)], requestId: 'r' }], ctx).quotes[0];

  it('accepts whole- and half-point spreads and totals, from numbers or numeric strings', () => {
    for (const [home, away] of [
      ['-4', '4'],
      ['-4.5', '+4.5'],
      [-4, 4],
      [-4.5, 4.5],
      ['-4.0', '4.0'],
    ] as const) {
      const q = parse({ spread_home_value: home, spread_away_value: away });
      expect([q.spreadHome, q.spreadAway], `${home}/${away}`).toEqual([Number(home), Number(away)]);
      expect(checkMarkets(q).spread, `${home}/${away}`).toMatchObject({ home: Number(home), away: Number(away) });
    }
    for (const total of ['220', '220.5', 220, 220.5, ' 220 ']) {
      const q = parse({ total_value: total });
      expect(checkMarkets(q).total?.line, String(total)).toBe(Number(String(total).trim()));
    }
  });

  it('rejects an invalid spread orientation', () => {
    expect(checkMarkets(quote({ spreadHome: -4, spreadAway: -4 })).spread).toBeNull();
    expect(checkMarkets(quote({ spreadHome: -4, spreadAway: 4.5 })).spread).toBeNull();
    expect(checkMarkets(quote({ spreadHome: 4, spreadAway: -4 })).spread).toBeNull();
    expect(checkMarkets(quote({ spreadHome: 0, spreadAway: 0 })).spread).toMatchObject({ home: 0, away: 0 });
  });

  it('rejects non-numeric and off-grid lines', () => {
    for (const bad of ['abc', '-4.25', '4,5', '0x4', '1e1', 'NaN', '', true]) {
      expect(parse({ spread_home_value: bad }).spreadHome, String(bad)).toBeNull();
    }
    for (const bad of ['220.25', '99.5', '400.5', 'two-twenty']) {
      expect(parse({ total_value: bad }).total, bad).toBeNull();
    }
  });

  it('a line survives without a valid price pair; the prices are dropped, not guessed', () => {
    const m = checkMarkets(quote({ totalOverOdds: null, spreadHomeOdds: 110, spreadAwayOdds: 110 }));
    expect(m.total).toEqual({ line: 230.5, over_odds: null, under_odds: null });
    expect(m.spread).toEqual({ home: -2.5, away: 2.5, home_odds: null, away_odds: null });
  });
});

describe('selectMarket: one vendor, freshness, identity', () => {
  const game = { gameId: '5001', lifecycle: 'scheduled' as const, scheduledTip: TIP };

  it('prefers DraftKings over FanDuel when both are fresh and complete', () => {
    const r = selectMarket({ game, now: NOW, quotes: [quote({ vendor: 'fanduel' }), quote()] });
    expect(r.status).toBe('fresh');
    expect(r.market?.vendor).toBe('draftkings');
    expect(r.market?.vendor_label).toBe('DraftKings');
  });

  it('a fresh lower-ranked book beats a delayed preferred book', () => {
    const delayed = new Date(NOW.getTime() - 25 * MIN).toISOString();
    const r = selectMarket({
      game,
      now: NOW,
      quotes: [quote({ observedAt: delayed, providerUpdatedAt: delayed, firstObservedAt: delayed }), quote({ vendor: 'betway' })],
    });
    expect(r.market?.vendor).toBe('betway');
    expect(r.market?.freshness).toBe('fresh');
  });

  it('a complete book beats a preferred book with one market, and markets are never mixed across books', () => {
    const dkMoneylineOnly = quote({ spreadHome: null, spreadAway: null, total: null });
    const fd = quote({ vendor: 'fanduel', moneylineHome: -140, moneylineAway: 118, spreadHome: -3, spreadAway: 3, total: 229 });
    const r = selectMarket({ game, now: NOW, quotes: [dkMoneylineOnly, fd] });
    expect(r.market).toMatchObject({ vendor: 'fanduel', moneyline: { home: -140, away: 118 }, spread: { home: -3 }, total: { line: 229 } });
  });

  it('ignores prediction markets and unlisted books, other game ids, opening and withdrawn quotes', () => {
    const r = selectMarket({
      game,
      now: NOW,
      quotes: [
        quote({ vendor: 'kalshi' }),
        quote({ vendor: 'polymarket' }),
        quote({ gameId: '50011' }),
        quote({ quoteKind: 'opening', openedAt: NOW.toISOString() }),
        quote({ vendor: 'fanduel', withdrawnAt: NOW.toISOString(), withdrawnRequestId: 'r2' }),
      ],
    });
    expect(r).toMatchObject({ status: 'unavailable', market: null });
  });

  it('delayed after 20 minutes, stale and hidden after 35; provider sync age counts too', () => {
    const iso = (m: number) => new Date(NOW.getTime() - m * MIN).toISOString();
    const pick = (q: StoredOddsQuote) => selectMarket({ game, now: NOW, quotes: [{ ...q, vendorSyncedAt: q.providerUpdatedAt }] });
    expect(pick(quote({ observedAt: iso(20), firstObservedAt: iso(20), providerUpdatedAt: iso(20) })).status).toBe('fresh');
    expect(pick(quote({ observedAt: iso(21), firstObservedAt: iso(21), providerUpdatedAt: iso(21) })).status).toBe('delayed');
    expect(pick(quote({ observedAt: iso(36), firstObservedAt: iso(36), providerUpdatedAt: iso(36) })).status).toBe('stale');
    expect(pick(quote({ observedAt: iso(1), firstObservedAt: iso(1), providerUpdatedAt: iso(40) })).status).toBe('stale');
    expect(SCOREBOARD_ODDS_POLICY.FRESH_MS).toBeGreaterThan(SCOREBOARD_ODDS_POLICY.INTERVAL_MS + MIN);
  });

  it('a vendor row lagging the same vendor by more than 10 minutes is not current', () => {
    const lagging = quote({ providerUpdatedAt: new Date(NOW.getTime() - 14 * MIN).toISOString(), vendorSyncedAt: new Date(NOW.getTime() - 2 * MIN).toISOString() });
    expect(selectMarket({ game, now: NOW, quotes: [lagging] }).status).toBe('unavailable');
  });

  it('only scheduled games before tip whose status is current get a market', () => {
    for (const lifecycle of ['live', 'halftime', 'overtime', 'final', 'postponed', 'canceled', 'unknown'] as const) {
      expect(selectMarket({ game: { ...game, lifecycle }, now: NOW, quotes: [quote()] }).status, lifecycle).toBe('not_pregame');
    }
    expect(selectMarket({ game, now: at(MIN), quotes: [quote()] }).status).toBe('not_pregame');
    expect(selectMarket({ game, now: NOW, quotes: [quote()], gameStale: true }).status).toBe('not_pregame');
  });

  it('caption names the book and the BDL sync age; without a sync time it states no age', () => {
    expect(marketSourceCaption(auditPregameMarket(), Date.parse('2026-10-09T23:41:00.000Z'))).toBe('DraftKings · BDL synced 3m ago');
    expect(marketSourceCaption(auditPregameMarket({ provider_updated_at: null }), Date.parse('2026-10-09T23:41:00.000Z'))).toBe('DraftKings');
    expect(marketSourceCaption(null, 0)).toBeNull();
  });
});

describe('odds gates and cadence', () => {
  it('odds ride on the games gate and never enable a season type', () => {
    const on = resolveScoreboardOddsCollection(ODDS_ENV, resolveScoreboardCollection(ODDS_ENV));
    expect(on).toEqual({ enabled: true, seasonTypes: ['preseason'], reason: null });
    for (const env of [
      LIVE_ENV,
      { ...ODDS_ENV, SCOREBOARD_COLLECT_ODDS: 'true' },
      { ...ODDS_ENV, DATA_MODE: undefined },
      { ...ODDS_ENV, SCOREBOARD_COLLECT_PRESEASON: '0' },
      { ...ODDS_ENV, SCOREBOARD_COLLECT_PRESEASON: '0', SCOREBOARD_COLLECT_REGULAR: '1' },
    ]) {
      expect(resolveScoreboardOddsCollection(env, resolveScoreboardCollection(env)).enabled).toBe(false);
    }
  });

  it('due on the 15th tick (14.5 min), 5th tick after a failure (4.5 min); never on consecutive ticks', () => {
    const s = (m: number, lastOutcome: 'success' | 'failed' | 'started') => ({ lastAttemptAt: new Date(NOW.getTime() - m * MIN).toISOString(), lastOutcome });
    expect(oddsDue(null, NOW)).toBe(true);
    expect(oddsDue(s(14, 'success'), NOW)).toBe(false);
    expect(oddsDue(s(14.5, 'success'), NOW)).toBe(true);
    expect(oddsDue(s(4, 'failed'), NOW)).toBe(false);
    expect(oddsDue(s(4.5, 'failed'), NOW)).toBe(true);
    expect(oddsDue(s(1, 'failed'), NOW)).toBe(false);
    expect(oddsDue(s(14, 'started'), NOW)).toBe(false);
  });

  it('eligible: scheduled, before tip, today or tomorrow ET', () => {
    const games = [
      stored({ gameId: 'a' }),
      stored({ gameId: 'live', lifecycle: 'live', pollingState: 'active' }),
      stored({ gameId: 'final', lifecycle: 'final', pollingState: 'complete' }),
      stored({ gameId: 'post', lifecycle: 'postponed' }),
      stored({ gameId: 'past', scheduledTip: at(-200 * MIN).toISOString() }),
      stored({ gameId: 'tomorrow', etDate: '2026-10-10', scheduledTip: at(24 * 60 * MIN).toISOString() }),
      stored({ gameId: 'later', etDate: '2026-10-11', scheduledTip: at(48 * 60 * MIN).toISOString() }),
    ];
    expect(oddsEligibleGames(games, NOW).map((g) => g.gameId)).toEqual(['a', 'tomorrow']);
  });
});

describe('collector odds step', () => {
  it('flag off: no odds request and no odds result', async () => {
    const f = fakeFetchers(() => ({ data: [oddsRow()] }));
    const r = await runScoreboardCycle({ env: LIVE_ENV, store: seededStore(), fetch: f.fetch, now: NOW });
    expect(oddsCalls(f.calls)).toEqual([]);
    expect(r.odds).toBeUndefined();
  });

  it('requests once per 15 minutes, independent of the games cadence, and stores the quote', async () => {
    const store = seededStore();
    const f = fakeFetchers(() => ({ data: [oddsRow()] }));
    const r1 = await runScoreboardCycle({ env: ODDS_ENV, store, fetch: f.fetch, now: NOW, clock: () => NOW });
    expect(r1.status).toBe('success');
    expect(r1.odds).toMatchObject({ status: 'success', eligibleGames: 1, requestedGames: 1, pages: 1, quotes: 1, written: 1, vendors: ['draftkings'] });
    expect(oddsCalls(f.calls)).toEqual([scoreboardOddsUrl(['5001'])]);
    expect(f.calls.some((u) => u.includes('/v1/games'))).toBe(false);
    expect(await store.loadCurrentOdds(['5001'])).toHaveLength(1);

    for (const m of [1, 5, 14]) {
      const t = new Date(NOW.getTime() + m * MIN);
      const r = await runScoreboardCycle({ env: ODDS_ENV, store, fetch: f.fetch, now: t, clock: () => t });
      expect(r.odds?.status, `+${m}m`).toBe('not_due');
    }
    expect(oddsCalls(f.calls)).toHaveLength(1);
    const t15 = new Date(NOW.getTime() + 15 * MIN);
    await runScoreboardCycle({ env: ODDS_ENV, store, fetch: f.fetch, now: t15, clock: () => t15 });
    expect(oddsCalls(f.calls)).toHaveLength(2);
  });

  it('no eligible game (live, final, postponed, or a season type not collecting): no request and no claim', async () => {
    const store = seededStore([
      stored({ gameId: '1', lifecycle: 'live', pollingState: 'active', scheduledTip: at(-200 * MIN).toISOString() }),
      stored({ gameId: '2', lifecycle: 'final', pollingState: 'complete' }),
      stored({ gameId: '3', lifecycle: 'postponed' }),
      stored({ gameId: '4', seasonType: 'regular' }),
    ]);
    const f = fakeFetchers(() => ({ data: [oddsRow()] }));
    const r = await runScoreboardCycle({ env: ODDS_ENV, store, fetch: f.fetch, now: NOW });
    expect(r.odds?.status).toBe('no_eligible_games');
    expect(oddsCalls(f.calls)).toEqual([]);
    expect(store.oddsState.current).toBeNull();
  });

  it('an empty odds response is a success with no quotes', async () => {
    const store = seededStore();
    const f = fakeFetchers(() => ({ data: [] }));
    const r = await runScoreboardCycle({ env: ODDS_ENV, store, fetch: f.fetch, now: NOW });
    expect(r.odds).toMatchObject({ status: 'success', quotes: 0, written: 0 });
    expect(store.odds.size).toBe(0);
  });

  it('odds failures never change the scores result or games rows, and retry after 5 minutes', async () => {
    for (const reply of [{ status: 429 }, { blocked: 'archive_failed' }, 'throw'] as const) {
      const store = createMemoryScoreboardStore();
      const games = () => [
        { id: 5001, date: '2026-10-09', datetime: TIP, season: 2026, status: TIP, period: 0, time: null, postseason: false,
          home_team: { id: 5, abbreviation: 'CHI', full_name: 'Chicago Bulls' },
          visitor_team: { id: 15, abbreviation: 'MEM', full_name: 'Memphis Grizzlies' },
          home_team_score: 0, visitor_team_score: 0 },
      ];
      const f = fakeFetchers(() => reply, games);
      const r = await runScoreboardCycle({ env: ODDS_ENV, store, fetch: f.fetch, now: NOW, clock: () => NOW });
      expect(r.status, JSON.stringify(reply)).toBe('success');
      expect(r.reason).toBeNull();
      expect(r.seasonTypes[0].upserted).toBe(1);
      expect(store.games.get('5001')?.lifecycle).toBe('scheduled');
      expect(r.odds?.status).toBe('failed');
      expect(store.odds.size).toBe(0);
      expect(store.oddsState.current?.lastOutcome).toBe('failed');

      const t4 = new Date(NOW.getTime() + 4 * MIN);
      expect((await runScoreboardCycle({ env: ODDS_ENV, store, fetch: f.fetch, now: t4, clock: () => t4 })).odds?.status).toBe('not_due');
      const t5 = new Date(NOW.getTime() + 5 * MIN);
      await runScoreboardCycle({ env: ODDS_ENV, store, fetch: f.fetch, now: t5, clock: () => t5 });
      expect(oddsCalls(f.calls)).toHaveLength(2);
    }
  });

  it('a failed games step skips odds for that tick (no extra request on a failing limiter)', async () => {
    const store = createMemoryScoreboardStore();
    store.games.set('5001', stored());
    const f = fakeFetchers(() => ({ data: [oddsRow()] }));
    f.fetch.games = async () => ({
      status: 503,
      ok: false,
      acquisition: { requestIds: ['g1'], archiveStatuses: ['ARCHIVED'], s3Keys: [], blockedReason: null },
    });
    const r = await runScoreboardCycle({ env: ODDS_ENV, store, fetch: f.fetch, now: NOW });
    expect(r.status).toBe('failed');
    expect(r.reason).toMatch(/games request failed/);
    expect(r.odds?.status).toBe('skipped');
    expect(oddsCalls(f.calls)).toEqual([]);
  });

  it('follows next_cursor; a failed later page writes nothing', async () => {
    const store = seededStore([stored(), stored({ gameId: '5002', scheduledTip: at(30 * MIN).toISOString() })]);
    const f = fakeFetchers((_url, page) => (page === 0 ? { data: [oddsRow()], next_cursor: 9 } : { data: [oddsRow({ game_id: 5002 })] }));
    const r = await runScoreboardCycle({ env: ODDS_ENV, store, fetch: f.fetch, now: NOW });
    expect(r.odds).toMatchObject({ status: 'success', pages: 2, quotes: 2, truncated: false });
    expect(oddsCalls(f.calls)[1]).toContain('cursor=9');

    const store2 = seededStore();
    const f2 = fakeFetchers((_url, page) => (page === 0 ? { data: [oddsRow()], next_cursor: 9 } : { status: 500 }));
    const r2 = await runScoreboardCycle({ env: ODDS_ENV, store: store2, fetch: f2.fetch, now: NOW });
    expect(r2.odds?.status).toBe('failed');
    expect(store2.odds.size).toBe(0);
  });

  it('stops at 3 pages; a truncated read withdraws nothing', async () => {
    const store = seededStore();
    await store.applyOddsAcquisition({ quotes: [quote({ vendor: 'fanduel' })], observedAt: quote().observedAt, requestId: 'old', withdrawGameIds: [] });
    const f = fakeFetchers(() => ({ data: [oddsRow()], next_cursor: 1 }));
    const r = await runScoreboardCycle({ env: ODDS_ENV, store, fetch: f.fetch, now: NOW });
    expect(oddsCalls(f.calls)).toHaveLength(SCOREBOARD_ODDS_POLICY.MAX_PAGES);
    expect(r.odds).toMatchObject({ truncated: true, withdrawn: 0 });
    expect((await store.loadCurrentOdds(['5001'])).map((q) => q.vendor).sort()).toEqual(['draftkings', 'fanduel']);
  });

  it('a complete later acquisition without a vendor withdraws that vendor (partial vendors)', async () => {
    const store = seededStore();
    const f = fakeFetchers(() => ({ data: [oddsRow(), oddsRow({ vendor: 'fanduel' })] }));
    await runScoreboardCycle({ env: ODDS_ENV, store, fetch: f.fetch, now: NOW, clock: () => NOW });
    const t15 = new Date(NOW.getTime() + 15 * MIN);
    const f2 = fakeFetchers(() => ({ data: [oddsRow({ vendor: 'fanduel', updated_at: t15.toISOString() })] }));
    const r = await runScoreboardCycle({ env: ODDS_ENV, store, fetch: f2.fetch, now: t15, clock: () => t15 });
    expect(r.odds?.withdrawn).toBe(1);
    expect((await store.loadCurrentOdds(['5001'])).map((q) => q.vendor)).toEqual(['fanduel']);
  });

  it('two full slates (15 today + 15 tomorrow) are covered in one request; coverage is complete', async () => {
    const games = [
      ...Array.from({ length: 15 }, (_, i) => stored({ gameId: String(7000 + i), scheduledTip: at(i * MIN).toISOString() })),
      ...Array.from({ length: 15 }, (_, i) =>
        stored({ gameId: String(8000 + i), etDate: '2026-10-10', scheduledTip: at(24 * 60 * MIN + i * MIN).toISOString() })
      ),
    ];
    const store = seededStore(games);
    const f = fakeFetchers(() => ({ data: [] }));
    const r = await runScoreboardCycle({ env: ODDS_ENV, store, fetch: f.fetch, now: NOW });
    expect(r.odds).toMatchObject({ eligibleGames: 30, requestedGames: 30, skippedGames: [], coverage: 'complete' });
    const url = oddsCalls(f.calls)[0];
    for (const g of games) expect(url).toContain(`game_ids%5B%5D=${g.gameId}`);
  });

  it('over the cap: deterministic earliest-tip coverage, skipped ids and dates reported, coverage partial', async () => {
    const games = Array.from({ length: 32 }, (_, i) =>
      stored({
        gameId: String(9000 + i),
        etDate: i < 16 ? '2026-10-09' : '2026-10-10',
        scheduledTip: at((i < 16 ? 0 : 24 * 60) * MIN + i * MIN).toISOString(),
      })
    );
    const store = seededStore(games.slice().reverse());
    const f = fakeFetchers(() => ({ data: [] }));
    const r = await runScoreboardCycle({ env: ODDS_ENV, store, fetch: f.fetch, now: NOW });
    expect(r.odds).toMatchObject({
      status: 'success',
      requestedGames: 30,
      coverage: 'partial',
      skippedGames: [
        { gameId: '9030', etDate: '2026-10-10' },
        { gameId: '9031', etDate: '2026-10-10' },
      ],
    });
    expect(r.odds?.reason).toMatch(/2 eligible games over the per-request cap/);
  });

  it('a slow scores step leaves no time: odds are skipped before claiming, so the next tick may try', async () => {
    const store = seededStore();
    const f = fakeFetchers(() => ({ data: [oddsRow()] }));
    let t = NOW.getTime();
    const clock = () => {
      const d = new Date(t);
      t += 16_000;
      return d;
    };
    const r = await runScoreboardCycle({ env: ODDS_ENV, store, fetch: f.fetch, now: NOW, clock });
    expect(r.odds).toMatchObject({ status: 'skipped', reason: 'tick time budget spent by the scores step' });
    expect(oddsCalls(f.calls)).toEqual([]);
    expect(store.oddsState.current).toBeNull();
  });

  it('later pages stop at the page deadline: quotes read so far are kept, nothing is withdrawn, coverage partial', async () => {
    const store = seededStore();
    let t = NOW.getTime();
    const clock = () => new Date(t);
    const f = fakeFetchers(() => {
      t += 16_000;
      return { data: [oddsRow()], next_cursor: 5 };
    });
    const r = await runScoreboardCycle({ env: ODDS_ENV, store, fetch: f.fetch, now: NOW, clock });
    expect(oddsCalls(f.calls)).toHaveLength(1);
    expect(r.odds).toMatchObject({ status: 'success', truncated: true, coverage: 'partial', withdrawn: 0, written: 1 });
    expect(r.odds?.reason).toMatch(/page deadline reached/);
  });

  it('normal scheduler timing never ages a healthy quote out of fresh (3 hours of 1-minute ticks with start jitter)', async () => {
    const store = seededStore([stored({ scheduledTip: at(10 * MIN).toISOString() })]);
    const base = at(-190 * MIN).getTime();
    let nowMs = base;
    const f = fakeFetchers(() => ({ data: [oddsRow({ updated_at: new Date(nowMs - 40_000).toISOString() })] }));
    let requests = 0;
    for (let tick = 0; tick < 180; tick += 1) {
      const jitter = [4_000, 0, 2_500, 900, 3_200, 300, 1_700][tick % 7];
      nowMs = base + tick * MIN + jitter;
      const now = new Date(nowMs);
      const r = await runScoreboardCycle({ env: ODDS_ENV, store, fetch: f.fetch, now, clock: () => now });
      if (r.odds?.status === 'success') requests += 1;
      const served = selectMarket({ game: stored({ scheduledTip: at(10 * MIN).toISOString() }), quotes: await store.loadCurrentOdds(['5001']), now });
      expect(served.status, `tick ${tick}`).toBe('fresh');
    }
    expect(requests).toBe(12);
  });

  it('a concurrent duplicate invocation makes no second odds request', async () => {
    const store = seededStore();
    const f = fakeFetchers(() => ({ data: [oddsRow()] }));
    await Promise.all([
      runScoreboardCycle({ env: ODDS_ENV, store, fetch: f.fetch, now: NOW }),
      runScoreboardCycle({ env: ODDS_ENV, store, fetch: f.fetch, now: NOW }),
    ]);
    expect(oddsCalls(f.calls)).toHaveLength(1);
  });
});

describe('memory store ordering mirrors the Postgres guard', () => {
  it('an older acquisition cannot overwrite a newer one, nor revive a withdrawn row; duplicates are idempotent', async () => {
    const store = createMemoryScoreboardStore();
    const t = (m: number) => new Date(NOW.getTime() + m * MIN).toISOString();
    const newer = quote({ moneylineHome: -150, observedAt: t(15), firstObservedAt: t(15), requestId: 'new' });
    const older = quote({ moneylineHome: -120, observedAt: t(0), firstObservedAt: t(0), requestId: 'old' });
    expect((await store.applyOddsAcquisition({ quotes: [newer], observedAt: t(15), requestId: 'new', withdrawGameIds: ['5001'] })).written).toBe(1);
    expect((await store.applyOddsAcquisition({ quotes: [older], observedAt: t(0), requestId: 'old', withdrawGameIds: ['5001'] })).written).toBe(0);
    expect((await store.applyOddsAcquisition({ quotes: [newer], observedAt: t(15), requestId: 'new', withdrawGameIds: ['5001'] })).written).toBe(1);
    expect((await store.loadCurrentOdds(['5001']))[0]).toMatchObject({ moneylineHome: -150, requestId: 'new' });

    await store.applyOddsAcquisition({ quotes: [], observedAt: t(30), requestId: 'w', withdrawGameIds: ['5001'] });
    expect(await store.loadCurrentOdds(['5001'])).toEqual([]);
    await store.applyOddsAcquisition({ quotes: [newer], observedAt: t(15), requestId: 'new', withdrawGameIds: [] });
    expect(await store.loadCurrentOdds(['5001'])).toEqual([]);
  });
});

describe('serving: optional market, graceful failure', () => {
  const env = { SCOREBOARD_SERVING_ENABLED: '1', SCOREBOARD_MARKETS_SERVING_ENABLED: '1' };
  const params = new URLSearchParams({ date: '2026-10-09' });

  it('markets off (unset or not exactly "1"): games serve unchanged and the odds tables are not read', async () => {
    const base = createMemoryScoreboardStore();
    base.games.set('5001', stored());
    await base.applyOddsAcquisition({ quotes: [quote()], observedAt: quote().observedAt, requestId: 'r', withdrawGameIds: [] });
    let oddsReads = 0;
    const store: ScoreboardStore = {
      ...base,
      loadCurrentOdds: async (ids) => {
        oddsReads += 1;
        return base.loadCurrentOdds(ids);
      },
    };
    for (const flag of [undefined, '', '0', 'false', 'FALSE', 'true', ' yes ', '01', '1.0', 'enabled']) {
      const res = await serveScoreboard({
        env: { SCOREBOARD_SERVING_ENABLED: '1', SCOREBOARD_MARKETS_SERVING_ENABLED: flag },
        params,
        now: NOW,
        store: () => store,
      });
      const body = res.body as { games: Array<Record<string, unknown>> };
      expect(res.status, String(flag)).toBe(200);
      expect(body.games).toHaveLength(1);
      expect('market' in body.games[0], String(flag)).toBe(false);
    }
    expect(oddsReads).toBe(0);
  });

  it('a page visit only reads: no odds claim, write or provider call', async () => {
    const base = createMemoryScoreboardStore();
    base.games.set('5001', stored());
    const writes: string[] = [];
    const store: ScoreboardStore = {
      ...base,
      claimOddsAttempt: async (at) => {
        writes.push('claim');
        return base.claimOddsAttempt(at);
      },
      recordOddsOutcome: async () => {
        writes.push('outcome');
      },
      applyOddsAcquisition: async () => {
        writes.push('apply');
        return { written: 0, withdrawn: 0 };
      },
    };
    const res = await serveScoreboard({ env, params, now: NOW, store: () => store });
    expect(res.status).toBe(200);
    expect(writes).toEqual([]);
  });

  it('attaches one verified market to a scheduled game and nothing to a live game', async () => {
    const store = createMemoryScoreboardStore();
    store.games.set('5001', stored());
    store.games.set('6001', stored({ gameId: '6001', lifecycle: 'live', pollingState: 'active', scheduledTip: at(-200 * MIN).toISOString() }));
    await store.applyOddsAcquisition({ quotes: [quote(), quote({ gameId: '6001' })], observedAt: quote().observedAt, requestId: 'r', withdrawGameIds: [] });
    const res = await serveScoreboard({ env, params, now: NOW, store: () => store });
    const body = res.body as { games: Array<{ game_id: string; market?: unknown; model_eligible: boolean }> };
    expect(res.status).toBe(200);
    const sched = body.games.find((g) => g.game_id === '5001')!;
    expect(sched.market).toMatchObject({ kind: 'current_pregame', vendor: 'draftkings', freshness: 'fresh', moneyline: { home: -135, away: 114 } });
    expect(sched.model_eligible).toBe(false);
    expect(body.games.find((g) => g.game_id === '6001')!.market).toBeUndefined();
    expect(res.headers['Cache-Control']).toBe('public, s-maxage=15, stale-while-revalidate=15');
  });

  it('final and postponed games never carry a stored pregame quote', async () => {
    const store = createMemoryScoreboardStore();
    store.games.set('5001', stored());
    store.games.set('7001', stored({ gameId: '7001', lifecycle: 'final', pollingState: 'complete' }));
    store.games.set('7002', stored({ gameId: '7002', lifecycle: 'postponed', pollingState: 'active' }));
    await store.applyOddsAcquisition({
      quotes: [quote(), quote({ gameId: '7001' }), quote({ gameId: '7002' })],
      observedAt: quote().observedAt,
      requestId: 'r',
      withdrawGameIds: [],
    });
    const res = await serveScoreboard({ env, params, now: NOW, store: () => store });
    const body = res.body as { games: Array<{ game_id: string; market?: unknown }> };
    expect(body.games.find((g) => g.game_id === '5001')!.market).toBeDefined();
    expect('market' in body.games.find((g) => g.game_id === '7001')!).toBe(false);
    expect('market' in body.games.find((g) => g.game_id === '7002')!).toBe(false);
  });

  it('lifecycle freshness gates the quote: a healthy 2 h-old discovery shows it; a missed discovery hides it', async () => {
    const serveWith = async (observedAgoMin: number) => {
      const store = createMemoryScoreboardStore();
      store.games.set('5001', stored({ lastObservedAt: new Date(NOW.getTime() - observedAgoMin * MIN).toISOString() }));
      await store.applyOddsAcquisition({ quotes: [quote()], observedAt: quote().observedAt, requestId: 'r', withdrawGameIds: [] });
      const res = await serveScoreboard({ env, params, now: NOW, store: () => store });
      return (res.body as { games: Array<{ stale: boolean; market?: unknown }> }).games[0];
    };
    expect(await serveWith(120)).toMatchObject({ stale: false, market: { vendor: 'draftkings', freshness: 'fresh' } });
    const missed = await serveWith(3 * 60 + 11);
    expect(missed.stale).toBe(true);
    expect('market' in missed).toBe(false);
  });

  it('an odds read failure (for example an unapplied migration) keeps the games and omits markets', async () => {
    const base = createMemoryScoreboardStore();
    base.games.set('5001', stored());
    const store: ScoreboardStore = {
      ...base,
      loadCurrentOdds: async () => {
        throw new Error('relation "display.scoreboard_game_odds" does not exist');
      },
    };
    const res = await serveScoreboard({ env, params, now: NOW, store: () => store });
    const body = res.body as { games: Array<{ game_id: string; market?: unknown }> };
    expect(res.status).toBe(200);
    expect(body.games).toHaveLength(1);
    expect('market' in body.games[0]).toBe(false);
  });
});

describe('card data and rendering', () => {
  const GENERATED = '2026-10-09T23:41:00.000Z';
  const cardHtml = (game: ReturnType<typeof scoreboardToSlateGame>) =>
    renderToStaticMarkup(createElement(GameCard, { game: game!, presentation: 'scoreboard' }));

  it('maps the audited DraftKings quote onto the existing market tiles with a source caption', () => {
    const card = scoreboardToSlateGame(auditPregameGame(), GENERATED)!;
    expect(card).toMatchObject({
      hasOdds: true,
      homeOdds: { moneyline: 200, spread: 7.5, spreadOdds: -115 },
      awayOdds: { moneyline: -245, spread: -7.5, spreadOdds: -105 },
      overUnder: 223.5,
      overOdds: -115,
      underOdds: -105,
      isFavorite: 'away',
      marketCaption: 'DraftKings · BDL synced 3m ago',
    });
    expect((card.homeImpliedProb ?? 0) + (card.awayImpliedProb ?? 0)).toBe(100);
    const html = cardHtml(card);
    expect(html).toContain('Market ML');
    expect(html).toContain('SAS -245');
    expect(html).toContain('PHX +200');
    expect(html).toContain('O/U 223.5');
    expect(html).toMatch(/data-market-source[^>]*>DraftKings · BDL synced 3m ago</);
    expect(html).not.toMatch(/consensus|opening|projection|expected value|\bEV\b/i);
  });

  it('a scheduled game without a market still renders its card, with empty tiles and no caption', () => {
    const card = scoreboardToSlateGame(auditPregameGame({ market: undefined }), GENERATED)!;
    expect(card.hasOdds).toBe(false);
    const html = cardHtml(card);
    expect(html).toContain('Market spread');
    expect(html).not.toContain('data-market-source');
  });

  it('live and final cards ignore any market in the payload', () => {
    for (const lifecycle of ['live', 'final'] as const) {
      const g = auditPregameGame({ lifecycle, period: 2, home: { score: 50 }, visitor: { score: 48 }, polling_state: lifecycle === 'final' ? 'complete' : 'active' });
      const card = scoreboardToSlateGame(g, GENERATED)!;
      expect(card.hasOdds, lifecycle).toBe(false);
      expect(card.homeOdds.moneyline).toBeNull();
      const html = cardHtml(card);
      expect(html).not.toContain('data-market-source');
      expect(html).not.toContain('Market ML');
    }
  });

  it('a malformed or unlisted market in the payload never reaches the card', () => {
    const bad = [
      auditPregameMarket({ vendor: 'kalshi', vendor_label: 'Kalshi' }),
      auditPregameMarket({ kind: 'opening' as never }),
      auditPregameMarket({ freshness: 'stale' as never }),
      auditPregameMarket({ moneyline: { home: 110, away: 110 }, spread: { home: 7, away: 7, home_odds: null, away_odds: null }, total: null }),
      auditPregameMarket({ moneyline: { home: '-245x' as never, away: 200 }, spread: null, total: { line: 223.25, over_odds: null, under_odds: null } }),
    ];
    for (const market of bad) expect(presentMarket(auditPregameGame({ market }), GENERATED)).toBeNull();
    expect(presentMarket(auditPregameGame({ stale: true, stale_reason: 'no_recent_observation' }), GENERATED)).toBeNull();
  });

  it('merge keeps exact game identity: a market stays on its own game id', () => {
    const cards = mergeTodaysGames(
      scoreboardResponse([auditPregameGame(), scoreboardGame({ game_id: '21826164', lifecycle: 'scheduled', scheduled_tip: '2026-10-10T02:00:00.000Z' })], {
        generated_at: GENERATED,
      })
    );
    expect(cards.map((c) => [c.id, c.hasOdds])).toEqual([
      ['21826163', true],
      ['21826164', false],
    ]);
  });

  it('a page showing a quote re-reads at least every 5 minutes; no quote keeps the old wake-up', () => {
    const now = new Date('2026-10-09T20:00:00.000Z');
    const g = { lifecycle: 'scheduled', polling_state: 'pending', scheduled_tip: '2026-10-10T02:00:00.000Z' };
    expect(scoreboardPollDelayMs([g], now)).toBe(Date.parse(g.scheduled_tip) - 15 * MIN - now.getTime());
    expect(scoreboardPollDelayMs([{ ...g, market: auditPregameMarket() }], now)).toBe(SCOREBOARD_MARKET_REFRESH_MS);
  });
});
