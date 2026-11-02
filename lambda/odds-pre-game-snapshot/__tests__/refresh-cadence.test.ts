import { UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { describe, expect, it } from 'vitest';
import { acquireOdds, type AcquireDeps, type OddsProviderRow } from '../acquire';
import { compareDueDates, planDate, type PlannedGame } from '../collection-planner';
import {
  DAILY_ODDS_REQUEST_CEILING,
  NORMAL_MAX_PAGES_PER_DATE,
  SCHEDULED_INVOCATION_MAX_PAGES,
  addCalendarDays,
  etCalendarDate,
} from '../normal-path';
import { createMemoryOddsClaim } from '../overlap-claim';
import { createDynamoOddsBudget, createMemoryOddsBudget } from '../request-budget';
import { SIX_HOUR_REFRESH_MS, T15_REFRESH_MS, oddsClaimSortKey, oddsRefreshSlot } from '../refresh-slot';

const TICK_MS = 15 * 60 * 1000;
const limiter = {
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
  BDL_RATE_LIMIT_INTERVAL_MS: '13000',
  BDL_RATE_LIMIT_MAX_REQUESTS: '1',
  BDL_RATE_LIMIT_BURST: '1',
  BDL_RATE_LIMIT_MAX_RETRIES: '0',
  BDL_RATE_LIMIT_BACKEND: 'memory',
};

function row(gameId: number): OddsProviderRow {
  return {
    id: gameId,
    game_id: gameId,
    vendor: 'draftkings',
    updated_at: '2026-10-21T15:00:00.000Z',
    total_value: '220.5',
  };
}

function game(gameId: string, startTime: string, latestSnapshotAt: string | null = null): PlannedGame {
  return { gameId, season: '2026', seasonPhase: 'REGULAR', startTime, latestSnapshotAt };
}

function deps(fetchPage: AcquireDeps['fetchPage'], extra: Partial<AcquireDeps> = {}): AcquireDeps {
  return {
    env: limiter,
    now: () => new Date('2026-10-21T10:00:00.000Z'),
    preferredVendor: 'draftkings',
    fetchPage,
    createPullRun: async () => 1,
    completePullRun: async () => undefined,
    insertRaw: async () => undefined,
    loadGames: async (ids) => ids.map((id) => ({
      gameId: id,
      season: '2026',
      seasonPhase: 'REGULAR',
      startTime: '2026-10-21T23:00:00.000Z',
    })),
    transformComplete: async () => ({ current: 1, history: 1, movement: 1 }),
    ...extra,
  };
}

type WalkFetch = { at: string; date: string; windowId: string; key: string; pages: number; outcome: string };

async function walkDay(input: {
  start?: string;
  end?: string;
  dates: string[];
  slate: (date: string) => PlannedGame[];
  pages: number;
  ceiling?: number;
  onFetch?: (atMs: number, date: string) => 'ok' | 'incomplete' | 'empty' | '429';
  ticks?: number[];
}) {
  const claim = createMemoryOddsClaim();
  const budget = createMemoryOddsBudget({ ceiling: input.ceiling ?? DAILY_ODDS_REQUEST_CEILING });
  const fetches: WalkFetch[] = [];
  const byDay = new Map<string, number>();
  const ticks = input.ticks ?? [];
  if (input.ticks == null) {
    for (let atMs = Date.parse(input.start); atMs <= Date.parse(input.end); atMs += TICK_MS) ticks.push(atMs);
  }
  for (const atMs of ticks) {
    const now = new Date(atMs);
    const day = etCalendarDate(now);
    const due = input.dates.flatMap((date) => {
      const plan = planDate({ etDate: date, now, games: input.slate(date) });
      return plan.due && plan.windowId ? [{ date, windowId: plan.windowId }] : [];
    }).sort(compareDueDates);
    for (const item of due) {
      const request = { day, date: item.date, windowId: item.windowId, nowMs: atMs, owner: 'sim' };
      const decision = await claim.claim(request);
      if (!decision.ok) continue;
      const outcome = input.onFetch?.(atMs, item.date) ?? 'ok';
      let pages = 0;
      for (let page = 0; page < input.pages; page += 1) {
        const reserved = await budget.reserve({
          day,
          date: item.date,
          dateCeiling: DAILY_ODDS_REQUEST_CEILING,
        });
        if (!reserved.ok) break;
        pages += 1;
      }
      if (pages === 0) continue;
      byDay.set(day, (byDay.get(day) ?? 0) + pages);
      if (outcome === 'ok') {
        for (const entry of input.slate(item.date)) entry.latestSnapshotAt = now.toISOString();
        await claim.complete(request);
      } else if (outcome === 'empty' || outcome === 'incomplete') {
        await claim.complete(request);
      }
      fetches.push({
        at: now.toISOString(),
        date: item.date,
        windowId: item.windowId,
        key: oddsClaimSortKey(request),
        pages,
        outcome,
      });
    }
  }
  return {
    fetches,
    attempts: fetches.reduce((sum, fetch) => sum + fetch.pages, 0),
    byDay: Object.fromEntries(byDay),
    keys: [...claim.held().keys()],
    reserved: budget.ledger().reserved,
  };
}

function slate(date: string, tip: string, count: number, snapshot: string | null = null): PlannedGame[] {
  return Array.from({ length: count }, (_, index) => game(`${date}-${index}`, tip, snapshot));
}

describe('refresh slots', () => {
  it('keeps a completed slot closed and opens the next bucket', async () => {
    const claim = createMemoryOddsClaim();
    const nowMs = Date.parse('2026-10-21T10:00:00.000Z');
    const request = { day: '2026-10-21', date: '2026-10-21', windowId: 'six_hour', nowMs, owner: 'first' };
    expect((await claim.claim(request)).ok).toBe(true);
    await claim.complete(request);
    const same = await claim.claim({ ...request, nowMs: nowMs + TICK_MS, owner: 'second' });
    const next = await claim.claim({ ...request, nowMs: nowMs + SIX_HOUR_REFRESH_MS, owner: 'third' });
    expect(same).toEqual({ ok: false, reason: 'skipped' });
    expect(next.ok).toBe(true);
    expect([...claim.held().keys()]).toHaveLength(2);
  });

  it('lets one of two deliveries own a slot', async () => {
    const claim = createMemoryOddsClaim();
    const request = {
      day: '2026-10-21',
      date: '2026-10-21',
      windowId: 'two_hour',
      nowMs: Date.parse('2026-10-21T19:00:00.000Z'),
      owner: 'a',
    };
    const results = await Promise.all([
      claim.claim(request),
      claim.claim({ ...request, owner: 'b' }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.reason === 'skipped')).toHaveLength(1);
  });
});

describe('stored daily budget', () => {
  function sharedCounter(start = 0) {
    let reserved = start;
    return {
      stored: () => reserved,
      async send(command: UpdateItemCommand) {
        const update = command.input.UpdateExpression ?? '';
        if (update.includes('refused')) return { Attributes: {} };
        const ceiling = Number(command.input.ExpressionAttributeValues?.[':ceiling']?.N ?? '0');
        if (reserved >= ceiling) {
          const error = new Error('full');
          error.name = 'ConditionalCheckFailedException';
          throw error;
        }
        reserved += 1;
        return { Attributes: { reserved: { N: String(reserved) } } };
      },
    };
  }

  it('reports the stored Eastern-day counter across invocations', async () => {
    const table = sharedCounter(1);
    const earlier = createDynamoOddsBudget({ tableName: 'nba-bdl-rate-limit', ceiling: 60, client: table });
    const later = createDynamoOddsBudget({ tableName: 'nba-bdl-rate-limit', ceiling: 60, client: table });
    const first = await earlier.reserve({ day: '2026-10-20', date: '2026-10-20', dateCeiling: 60 });
    const second = await later.reserve({ day: '2026-10-20', date: '2026-10-20', dateCeiling: 60 });
    const third = await later.reserve({ day: '2026-10-20', date: '2026-10-20', dateCeiling: 60 });
    expect(first).toMatchObject({ ok: true, remaining: 58 });
    expect(second).toMatchObject({ ok: true, remaining: 57 });
    expect(third).toMatchObject({ ok: true, remaining: 56 });
    expect(table.stored()).toBe(4);
  });

  it('does not invent a local remaining count when the stored counter is missing', async () => {
    const budget = createDynamoOddsBudget({
      tableName: 'nba-bdl-rate-limit',
      ceiling: 60,
      client: { send: async () => ({}) },
    });
    const decision = await budget.reserve({ day: '2026-10-20', date: '2026-10-20', dateCeiling: 60 });
    expect(decision).toMatchObject({ ok: true, remaining: null });
  });

  it('stops at 60 stored attempts for the whole Eastern day', async () => {
    const memory = createMemoryOddsBudget({ ceiling: 60 });
    const grants = [];
    for (let n = 0; n < 40; n += 1) {
      grants.push(await memory.reserve({ day: '2026-10-21', date: '2026-10-21', dateCeiling: 60 }));
      grants.push(await memory.reserve({ day: '2026-10-21', date: '2026-10-22', dateCeiling: 60 }));
    }
    expect(grants.filter((result) => result.ok)).toHaveLength(60);
    expect(memory.dateUsed('2026-10-21')).toBe(30);
    expect(memory.dateUsed('2026-10-22')).toBe(30);

    const table = sharedCounter(0);
    const today = createDynamoOddsBudget({ tableName: 'nba-bdl-rate-limit', ceiling: 60, client: table });
    const tomorrow = createDynamoOddsBudget({ tableName: 'nba-bdl-rate-limit', ceiling: 60, client: table });
    let lastRemaining: number | null = null;
    for (let n = 0; n < 30; n += 1) {
      const first = await today.reserve({ day: '2026-10-21', date: '2026-10-21', dateCeiling: 60 });
      const second = await tomorrow.reserve({ day: '2026-10-21', date: '2026-10-22', dateCeiling: 60 });
      expect(first.ok && second.ok).toBe(true);
      if (second.ok) lastRemaining = second.remaining;
    }
    const fresh = createDynamoOddsBudget({ tableName: 'nba-bdl-rate-limit', ceiling: 60, client: table });
    const overflow = await fresh.reserve({ day: '2026-10-21', date: '2026-10-22', dateCeiling: 60 });
    expect(lastRemaining).toBe(0);
    expect(overflow).toMatchObject({ ok: false, reason: 'exhausted' });
    expect(table.stored()).toBe(60);
  });
});

describe('scheduled refresh', () => {
  const today = '2026-10-21';
  const tomorrow = '2026-10-22';
  const todayTip = '2026-10-21T23:00:00.000Z';
  const tomorrowTip = '2026-10-22T23:00:00.000Z';
  const todayFetches = [
    '2026-10-21T10:00:00.000Z',
    '2026-10-21T13:00:00.000Z',
    '2026-10-21T16:00:00.000Z',
    '2026-10-21T17:00:00.000Z',
    '2026-10-21T18:00:00.000Z',
    '2026-10-21T19:00:00.000Z',
    '2026-10-21T20:00:00.000Z',
    '2026-10-21T21:00:00.000Z',
    '2026-10-21T21:45:00.000Z',
    '2026-10-21T22:15:00.000Z',
    '2026-10-21T22:45:00.000Z',
  ];

  it('keeps the page caps and the daily ceiling', () => {
    expect(DAILY_ODDS_REQUEST_CEILING).toBe(60);
    expect(NORMAL_MAX_PAGES_PER_DATE).toBe(3);
    expect(SCHEDULED_INVOCATION_MAX_PAGES).toBe(6);
  });

  it('fetches a three-game slate on the slot cadence', async () => {
    const games = slate(today, todayTip, 3);
    const summary = await walkDay({
      start: '2026-10-21T10:00:00.000Z',
      end: '2026-10-21T23:00:00.000Z',
      dates: [today],
      slate: () => games,
      pages: 1,
    });
    expect(summary.fetches.map((fetch) => fetch.at)).toEqual(todayFetches);
    expect(summary.attempts).toBe(11);
    expect(summary.byDay).toEqual({ '2026-10-21': 11 });
    expect(summary.fetches.filter((fetch) => fetch.windowId === 't15')).toHaveLength(1);
    expect(summary.fetches.some((fetch) => fetch.at > todayTip)).toBe(false);
  });

  it('scales attempts by observed pages and stays inside the daily ceiling', async () => {
    const threeToday = slate(today, todayTip, 3);
    const threeTomorrow = slate(tomorrow, tomorrowTip, 3);
    const elevenToday = slate(today, todayTip, 11);
    const elevenTomorrow = slate(tomorrow, tomorrowTip, 11);
    const fifteenToday = slate(today, todayTip, 15);
    const fifteenTomorrow = slate(tomorrow, tomorrowTip, 15);
    const three = await walkDay({
      start: '2026-10-21T10:00:00.000Z',
      end: '2026-10-21T23:00:00.000Z',
      dates: [today, tomorrow],
      slate: (date) => (date === today ? threeToday : threeTomorrow),
      pages: 1,
    });
    const elevenDay = await walkDay({
      start: '2026-10-21T10:00:00.000Z',
      end: '2026-10-21T23:00:00.000Z',
      dates: [today, tomorrow],
      slate: (date) => (date === today ? elevenToday : elevenTomorrow),
      pages: 2,
    });
    const fifteenDay = await walkDay({
      start: '2026-10-21T10:00:00.000Z',
      end: '2026-10-21T23:00:00.000Z',
      dates: [today, tomorrow],
      slate: (date) => (date === today ? fifteenToday : fifteenTomorrow),
      pages: 3,
    });
    expect(three.attempts).toBe(13);
    expect(elevenDay.attempts).toBe(26);
    expect(fifteenDay.attempts).toBe(39);
    expect(fifteenDay.reserved).toBeLessThanOrEqual(60);
    expect(elevenDay.fetches.filter((fetch) => fetch.date === tomorrow).map((fetch) => fetch.at)).toEqual([
      '2026-10-21T10:00:00.000Z',
      '2026-10-21T23:00:00.000Z',
    ]);
  });

  it('does not multiply fetches by the number of tip times', async () => {
    const spread = [
      '2026-10-21T23:00:00.000Z',
      '2026-10-22T00:00:00.000Z',
      '2026-10-22T01:30:00.000Z',
    ];
    const games = spread.map((tip, index) => game(`g${index}`, tip));
    const summary = await walkDay({
      start: '2026-10-21T10:00:00.000Z',
      end: '2026-10-21T23:00:00.000Z',
      dates: [today],
      slate: () => games,
      pages: 1,
    });
    expect(summary.fetches).toHaveLength(todayFetches.length);
    expect(summary.attempts).toBe(11);
  });

  it('does not spend the daily budget on an empty slate', async () => {
    const summary = await walkDay({
      start: '2026-10-21T10:00:00.000Z',
      end: '2026-10-21T23:00:00.000Z',
      dates: [today],
      slate: () => [],
      pages: 3,
    });
    expect(summary.attempts).toBe(0);
    expect(summary.fetches).toHaveLength(0);
  });

  it('takes one near-tip fetch and then stops', async () => {
    const games = slate(today, todayTip, 3);
    const summary = await walkDay({
      start: '2026-10-21T22:40:00.000Z',
      end: '2026-10-21T23:15:00.000Z',
      dates: [today],
      slate: () => games,
      pages: 1,
    });
    expect(summary.fetches.map((fetch) => [fetch.at, fetch.windowId])).toEqual([
      ['2026-10-21T22:40:00.000Z', 't15'],
    ]);
  });

  it('spends a capped incomplete slot once, then waits for the next bucket', async () => {
    const games = slate(today, todayTip, 11);
    const summary = await walkDay({
      start: '2026-10-21T10:00:00.000Z',
      end: '2026-10-21T13:15:00.000Z',
      dates: [today],
      slate: () => games,
      pages: 3,
      onFetch: () => 'incomplete',
    });
    expect(summary.fetches.map((fetch) => fetch.at)).toEqual([
      '2026-10-21T10:00:00.000Z',
      '2026-10-21T12:00:00.000Z',
    ]);
    expect(summary.attempts).toBe(6);
  });

  it('retries a 429 on a later tick and stops when the ceiling is gone', async () => {
    const games = slate(today, todayTip, 3);
    const retried = await walkDay({
      start: '2026-10-21T10:00:00.000Z',
      end: '2026-10-21T10:45:00.000Z',
      dates: [today],
      slate: () => games,
      pages: 1,
      onFetch: (atMs) => (atMs === Date.parse('2026-10-21T10:00:00.000Z') ? '429' : 'ok'),
    });
    expect(retried.fetches.map((fetch) => [fetch.at, fetch.outcome])).toEqual([
      ['2026-10-21T10:00:00.000Z', '429'],
      ['2026-10-21T10:15:00.000Z', 'ok'],
    ]);
    const cappedGames = slate(today, todayTip, 3);
    const capped = await walkDay({
      start: '2026-10-21T10:00:00.000Z',
      end: '2026-10-21T11:00:00.000Z',
      dates: [today],
      slate: () => cappedGames,
      pages: 1,
      ceiling: 2,
      onFetch: () => '429',
    });
    expect(capped.attempts).toBe(2);
  });

  it('does not refetch a fresh snapshot at Eastern midnight', async () => {
    const games = slate(tomorrow, tomorrowTip, 3, '2026-10-21T03:30:00.000Z');
    const summary = await walkDay({
      start: '2026-10-21T03:30:00.000Z',
      end: '2026-10-21T04:15:00.000Z',
      dates: [tomorrow],
      slate: () => games,
      pages: 1,
    });
    expect(summary.attempts).toBe(0);
  });

  it('allows one incomplete retry when the Eastern day rolls', async () => {
    const games = slate(tomorrow, tomorrowTip, 3);
    const summary = await walkDay({
      start: '2026-10-21T03:30:00.000Z',
      end: '2026-10-21T04:15:00.000Z',
      dates: [tomorrow],
      slate: () => games,
      pages: 1,
      onFetch: () => 'incomplete',
    });
    expect(summary.fetches.map((fetch) => fetch.at)).toEqual([
      '2026-10-21T03:30:00.000Z',
      '2026-10-21T04:00:00.000Z',
    ]);
    expect(summary.keys.some((key) => key.startsWith('2026-10-20#'))).toBe(true);
    expect(summary.keys.some((key) => key.startsWith('2026-10-21#'))).toBe(true);
    expect(summary.byDay).toEqual({ '2026-10-20': 1, '2026-10-21': 1 });
  });

  it('follows a moved tip into the near-tip slot', async () => {
    const games = [game('moved', '2026-10-21T23:00:00.000Z', '2026-10-21T16:00:00.000Z')];
    const before = planDate({
      etDate: today,
      now: new Date('2026-10-21T16:15:00.000Z'),
      games,
    });
    games[0] = game('moved', '2026-10-21T16:30:00.000Z', '2026-10-21T16:00:00.000Z');
    const after = planDate({
      etDate: today,
      now: new Date('2026-10-21T16:15:00.000Z'),
      games,
    });
    expect(before.due).toBe(false);
    expect(after).toMatchObject({ due: true, windowId: 't15' });
  });
});

describe('acquire refresh behavior', () => {
  it('fetches the nearer date before tomorrow discovery', async () => {
    const order: string[] = [];
    const now = new Date('2026-10-20T18:40:00.000Z');
    const result = await acquireOdds({ dates: ['2026-10-21', '2026-10-20'] }, deps(async (date) => {
      order.push(date);
      return { ok: true, rows: [row(date === '2026-10-20' ? 21717855 : 21717922)], nextCursor: null };
    }, {
      now: () => now,
      slateForDate: async (date) => (date === '2026-10-20'
        ? [game('21717855', '2026-10-20T19:00:00.000Z')]
        : [game('21717922', '2026-10-22T02:00:00.000Z')]),
      loadGames: async (ids) => ids.map((id) => ({
        gameId: id,
        season: '2026',
        seasonPhase: 'REGULAR',
        startTime: id === '21717855' ? '2026-10-20T19:00:00.000Z' : '2026-10-22T02:00:00.000Z',
      })),
    }));
    expect(order).toEqual(['2026-10-20', '2026-10-21']);
    expect(result.results.map((item) => item.classification)).toEqual(['COMPLETE', 'COMPLETE']);
  });

  it('does not repeat a capped date on the next quarter-hour', async () => {
    const claim = createMemoryOddsClaim();
    const budget = createMemoryOddsBudget();
    let nowMs = Date.parse('2026-10-21T10:00:00.000Z');
    let calls = 0;
    const slate = [game('21717855', '2026-10-21T23:00:00.000Z')];
    const fetchPage: AcquireDeps['fetchPage'] = async () => {
      calls += 1;
      return calls % 3 === 1
        ? { ok: true, rows: [row(21717855)], nextCursor: 2 }
        : { ok: true, rows: [], nextCursor: 2 };
    };
    const extra: Partial<AcquireDeps> = {
      now: () => new Date(nowMs),
      slateForDate: async () => slate,
      claimDate: (input) => claim.claim(input),
      completeClaim: (input) => claim.complete(input),
      reserveAttempt: (input) => budget.reserve(input),
      recordAttempt: (input) => budget.record(input),
    };
    const first = await acquireOdds({ date: '2026-10-21' }, deps(fetchPage, extra));
    const afterFirst = calls;
    nowMs += TICK_MS;
    const second = await acquireOdds({ date: '2026-10-21' }, deps(fetchPage, extra));
    expect(first.results[0]?.classification).toBe('INCOMPLETE');
    expect(afterFirst).toBe(3);
    expect(second.status).toBe('SKIPPED');
    expect(calls).toBe(3);
    nowMs += SIX_HOUR_REFRESH_MS - TICK_MS;
    const third = await acquireOdds({ date: '2026-10-21' }, deps(fetchPage, extra));
    expect(third.results[0]?.classification).toBe('INCOMPLETE');
    expect(calls).toBe(6);
    expect(budget.ledger().reserved).toBe(6);
  });

  it('drops a stale delivery and still accepts a late one inside the slot', async () => {
    const now = new Date('2026-10-21T10:00:00.000Z');
    let calls = 0;
    const fetchPage: AcquireDeps['fetchPage'] = async () => {
      calls += 1;
      return { ok: true, rows: [row(21717855)], nextCursor: null };
    };
    const extra: Partial<AcquireDeps> = {
      now: () => now,
      slateForDate: async () => [game('21717855', '2026-10-21T23:00:00.000Z')],
    };
    const stale = await acquireOdds({
      date: '2026-10-21',
      time: '2026-10-21T09:40:00.000Z',
    }, deps(fetchPage, extra));
    const late = await acquireOdds({
      date: '2026-10-21',
      time: '2026-10-21T09:50:00.000Z',
    }, deps(fetchPage, extra));
    expect(stale.status).toBe('STALE');
    expect(late.status).toBe('COMPLETE');
    expect(calls).toBe(1);
  });

  it('does not call the provider when the claim store fails', async () => {
    let calls = 0;
    const result = await acquireOdds({ date: '2026-10-21' }, deps(async () => {
      calls += 1;
      return { ok: true, rows: [row(21717855)], nextCursor: null };
    }, {
      slateForDate: async () => [game('21717855', '2026-10-21T23:00:00.000Z')],
      claimDate: async () => ({ ok: false, reason: 'unavailable' }),
    }));
    expect(result.results[0]?.classification).toBe('CLAIM_UNAVAILABLE');
    expect(calls).toBe(0);
  });

  it('gives the only remaining attempt to the nearer slate', async () => {
    const budget = createMemoryOddsBudget({ ceiling: 1 });
    const calls: string[] = [];
    const now = new Date('2026-10-20T18:40:00.000Z');
    await acquireOdds({ dates: ['2026-10-21', '2026-10-20'] }, deps(async (date) => {
      calls.push(date);
      return { ok: true, rows: [row(date === '2026-10-20' ? 21717855 : 21717922)], nextCursor: null };
    }, {
      now: () => now,
      slateForDate: async (date) => (date === '2026-10-20'
        ? [game('21717855', '2026-10-20T19:00:00.000Z')]
        : [game('21717922', '2026-10-22T02:00:00.000Z')]),
      loadGames: async (ids) => ids.map((id) => ({
        gameId: id,
        season: '2026',
        seasonPhase: 'REGULAR',
        startTime: id === '21717855' ? '2026-10-20T19:00:00.000Z' : '2026-10-22T02:00:00.000Z',
      })),
      reserveAttempt: (input) => budget.reserve(input),
      recordAttempt: (input) => budget.record(input),
    }));
    expect(calls).toEqual(['2026-10-20']);
    expect(budget.ledger().reserved).toBe(1);
  });
});

function etClock(instant: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const hour = Number(value('hour')) % 24;
  return {
    ymd: `${value('year')}-${value('month')}-${value('day')}`,
    hour,
    minute: Number(value('minute')),
  };
}

function schedulerTicks(etDate: string): number[] {
  const start = Date.parse(`${etDate}T12:00:00.000Z`);
  const next = addCalendarDays(etDate, 1);
  const ticks: number[] = [];
  for (let at = start; at <= start + 36 * 60 * 60 * 1000; at += TICK_MS) {
    const clock = etClock(new Date(at));
    const openingDay = clock.ymd === etDate && clock.hour >= 9;
    const afterMidnight = clock.ymd === next && clock.hour === 0 && clock.minute <= 45;
    if (openingDay || afterMidnight) ticks.push(at);
  }
  return ticks;
}

describe('scheduler window', () => {
  const today = '2026-10-21';
  const tomorrow = '2026-10-22';
  const sevenPm = '2026-10-21T23:00:00.000Z';
  const nineThirtyPm = '2026-10-22T01:30:00.000Z';

  it('fires every 15 minutes from 9:00 AM through 12:45 AM Eastern', () => {
    const summer = schedulerTicks('2026-10-21');
    const winter = schedulerTicks('2026-11-01');
    expect(summer).toHaveLength(64);
    expect(winter).toHaveLength(64);
    expect(etClock(new Date(summer[0] ?? 0))).toMatchObject({ ymd: '2026-10-21', hour: 9, minute: 0 });
    expect(etClock(new Date(summer[summer.length - 1] ?? 0))).toMatchObject({ ymd: '2026-10-22', hour: 0, minute: 45 });
    expect(new Date(summer[0] ?? 0).toISOString()).toBe('2026-10-21T13:00:00.000Z');
    expect(new Date(winter[0] ?? 0).toISOString()).toBe('2026-11-01T14:00:00.000Z');
    expect(winter.filter((at) => {
      const clock = etClock(new Date(at));
      return clock.hour >= 1 && clock.hour < 9;
    })).toHaveLength(0);
    expect(etCalendarDate(new Date('2026-11-01T05:30:00.000Z'))).toBe('2026-11-01');
    expect(etCalendarDate(new Date('2026-11-01T06:30:00.000Z'))).toBe('2026-11-01');
  });

  it('counts provider attempts on the real scheduler for 3, 11, and 15 game slates', async () => {
    const ticks = schedulerTicks(today);
    const run = (count: number, pages: number) => {
      const todayGames = slate(today, sevenPm, count);
      const tomorrowGames = slate(tomorrow, '2026-10-22T23:00:00.000Z', count);
      return walkDay({
        ticks,
        dates: [today, tomorrow],
        slate: (date) => (date === today ? todayGames : tomorrowGames),
        pages,
      });
    };
    const three = await run(3, 1);
    const eleven = await run(11, 2);
    const fifteen = await run(15, 3);
    expect(three.fetches.filter((fetch) => fetch.date === today).map((fetch) => fetch.at)).toEqual([
      '2026-10-21T13:00:00.000Z',
      '2026-10-21T16:00:00.000Z',
      '2026-10-21T17:00:00.000Z',
      '2026-10-21T18:00:00.000Z',
      '2026-10-21T19:00:00.000Z',
      '2026-10-21T20:00:00.000Z',
      '2026-10-21T21:00:00.000Z',
      '2026-10-21T21:45:00.000Z',
      '2026-10-21T22:15:00.000Z',
      '2026-10-21T22:45:00.000Z',
    ]);
    expect(three.fetches.filter((fetch) => fetch.date === tomorrow).map((fetch) => fetch.at)).toEqual([
      '2026-10-21T13:00:00.000Z',
      '2026-10-21T23:00:00.000Z',
      '2026-10-22T02:00:00.000Z',
    ]);
    expect(three.attempts).toBe(13);
    expect(eleven.attempts).toBe(26);
    expect(fifteen.attempts).toBe(39);
    expect(fifteen.attempts).toBeLessThanOrEqual(60);
  });

  it('gives the later tip its own near-tip fetch after the early tip completes', async () => {
    const games = [game('early', sevenPm), game('late', nineThirtyPm)];
    const summary = await walkDay({
      ticks: schedulerTicks(today),
      dates: [today],
      slate: () => games,
      pages: 1,
    });
    const nearTip = summary.fetches.filter((fetch) => fetch.windowId === 't15');
    expect(nearTip.map((fetch) => fetch.at)).toEqual([
      '2026-10-21T22:45:00.000Z',
      '2026-10-22T01:15:00.000Z',
    ]);
    expect(nearTip[0]?.key).not.toBe(nearTip[1]?.key);
    expect(summary.fetches.some((fetch) => fetch.at > sevenPm && fetch.at < nineThirtyPm)).toBe(true);
    expect(summary.fetches.filter((fetch) => fetch.at === nearTip[1]?.at)).toHaveLength(1);
    expect(summary.fetches.map((fetch) => `${fetch.at} ${fetch.windowId}`)).toEqual([
      '2026-10-21T13:00:00.000Z six_hour',
      '2026-10-21T16:00:00.000Z six_hour',
      '2026-10-21T17:00:00.000Z two_hour',
      '2026-10-21T18:00:00.000Z two_hour',
      '2026-10-21T19:00:00.000Z two_hour',
      '2026-10-21T20:00:00.000Z two_hour',
      '2026-10-21T21:00:00.000Z two_hour',
      '2026-10-21T21:45:00.000Z t60',
      '2026-10-21T22:15:00.000Z t60',
      '2026-10-21T22:45:00.000Z t15',
      '2026-10-21T23:45:00.000Z two_hour',
      '2026-10-22T00:15:00.000Z t60',
      '2026-10-22T00:45:00.000Z t60',
      '2026-10-22T01:15:00.000Z t15',
    ]);
    expect(summary.attempts).toBe(14);
  });

  it('refreshes once at 9:00 AM after the overnight gap', async () => {
    const games = slate(tomorrow, '2026-10-22T23:00:00.000Z', 3);
    const evening = await walkDay({
      ticks: schedulerTicks(today),
      dates: [tomorrow],
      slate: () => games,
      pages: 1,
    });
    const nextMorning = schedulerTicks(tomorrow)[0] ?? 0;
    const morning = await walkDay({
      ticks: [nextMorning],
      dates: [tomorrow],
      slate: () => games,
      pages: 1,
    });
    expect(evening.fetches.map((fetch) => fetch.at)).toEqual([
      '2026-10-21T13:00:00.000Z',
      '2026-10-21T23:00:00.000Z',
      '2026-10-22T02:00:00.000Z',
    ]);
    expect(morning.fetches).toHaveLength(1);
    expect(morning.fetches[0]?.at).toBe('2026-10-22T13:00:00.000Z');
    expect(nextMorning - Date.parse('2026-10-22T02:00:00.000Z')).toBe(11 * 60 * 60 * 1000);
  });

  it('keeps one Eastern day across the November fallback hour', () => {
    expect(etCalendarDate(new Date('2026-11-01T04:45:00.000Z'))).toBe('2026-11-01');
    expect(etCalendarDate(new Date('2026-11-01T06:30:00.000Z'))).toBe('2026-11-01');
    const ticks = schedulerTicks('2026-11-01');
    expect(new Set(ticks).size).toBe(ticks.length);
  });
});

const NEAR_TIP_SLATE = [
  ['7:00', '2026-10-21T23:00:00.000Z'],
  ['7:05', '2026-10-21T23:05:00.000Z'],
  ['7:10', '2026-10-21T23:10:00.000Z'],
  ['7:30', '2026-10-21T23:30:00.000Z'],
  ['9:30', '2026-10-22T01:30:00.000Z'],
] as const;

function nearTipHits(fetches: WalkFetch[], tip: string, gameId: string) {
  const tipMs = Date.parse(tip);
  return fetches.filter((fetch) => {
    const minutes = (tipMs - Date.parse(fetch.at)) / 60_000;
    return fetch.windowId === 't15' && minutes > 0 && minutes <= 20;
  }).map((fetch) => ({ at: fetch.at, key: fetch.key, gameId }));
}

describe('near-tip claim alignment', () => {
  const today = '2026-10-21';
  const tomorrow = '2026-10-22';

  function slateGames() {
    return NEAR_TIP_SLATE.map(([id, tip]) => game(id, tip));
  }

  it('uses a 15-minute t15 claim bucket and still plans the final 20 minutes', () => {
    expect(T15_REFRESH_MS).toBe(15 * 60 * 1000);
    const games = [game('7:05', '2026-10-21T23:05:00.000Z', '2026-10-21T22:45:00.000Z')];
    const secondTick = planDate({
      etDate: today,
      now: new Date('2026-10-21T23:00:00.000Z'),
      games,
    });
    expect(secondTick.due).toBe(false);
    expect(oddsRefreshSlot('t15', Date.parse('2026-10-21T22:45:00.000Z')))
      .not.toBe(oddsRefreshSlot('t15', Date.parse('2026-10-21T23:00:00.000Z')));
  });

  it('gives one near-tip acquisition to a 7:00 PM tip', async () => {
    const games = [game('7:00', '2026-10-21T23:00:00.000Z')];
    const summary = await walkDay({
      ticks: schedulerTicks(today),
      dates: [today],
      slate: () => games,
      pages: 1,
    });
    expect(summary.fetches.filter((fetch) => fetch.windowId === 't15').map((fetch) => fetch.at)).toEqual([
      '2026-10-21T22:45:00.000Z',
    ]);
  });

  it('does not duplicate a successful 7:05 PM near-tip acquisition', async () => {
    const games = [game('7:05', '2026-10-21T23:05:00.000Z')];
    const summary = await walkDay({
      ticks: schedulerTicks(today),
      dates: [today],
      slate: () => games,
      pages: 1,
    });
    const nearTip = summary.fetches.filter((fetch) => fetch.windowId === 't15');
    expect(nearTip.map((fetch) => fetch.at)).toEqual(['2026-10-21T22:45:00.000Z']);
    expect(summary.fetches.some((fetch) => fetch.at === '2026-10-21T23:00:00.000Z')).toBe(false);
    expect(planDate({
      etDate: today,
      now: new Date('2026-10-21T23:00:00.000Z'),
      games,
    }).due).toBe(false);
  });

  it('acquires the 7:10 PM near-tip fetch at 7:00 PM', async () => {
    const games = [game('7:10', '2026-10-21T23:10:00.000Z')];
    const summary = await walkDay({
      ticks: schedulerTicks(today),
      dates: [today],
      slate: () => games,
      pages: 1,
    });
    expect(summary.fetches.filter((fetch) => fetch.windowId === 't15').map((fetch) => fetch.at)).toEqual([
      '2026-10-21T23:00:00.000Z',
    ]);
  });

  it('acquires the 7:30 PM near-tip fetch after the 7:00 PM claim is complete', async () => {
    const games = [game('7:10', '2026-10-21T23:10:00.000Z'), game('7:30', '2026-10-21T23:30:00.000Z')];
    const summary = await walkDay({
      ticks: schedulerTicks(today),
      dates: [today],
      slate: () => games,
      pages: 1,
    });
    const nearTip = summary.fetches.filter((fetch) => fetch.windowId === 't15');
    expect(nearTip.map((fetch) => fetch.at)).toEqual([
      '2026-10-21T23:00:00.000Z',
      '2026-10-21T23:15:00.000Z',
    ]);
    expect(nearTip[0]?.key).not.toBe(nearTip[1]?.key);
    expect(nearTipHits(nearTip, '2026-10-21T23:30:00.000Z', '7:30').map((hit) => hit.at)).toEqual([
      '2026-10-21T23:15:00.000Z',
    ]);
  });

  it('acquires the 9:30 PM near-tip fetch at 9:15 PM', async () => {
    const games = [game('9:30', '2026-10-22T01:30:00.000Z')];
    const summary = await walkDay({
      ticks: schedulerTicks(today),
      dates: [today],
      slate: () => games,
      pages: 1,
    });
    expect(summary.fetches.filter((fetch) => fetch.windowId === 't15').map((fetch) => fetch.at)).toEqual([
      '2026-10-22T01:15:00.000Z',
    ]);
  });

  it('covers every staggered tip with one date acquisition per due tick', async () => {
    const games = slateGames();
    const summary = await walkDay({
      ticks: schedulerTicks(today),
      dates: [today],
      slate: () => games,
      pages: 1,
    });
    expect(summary.fetches.map((fetch) => `${fetch.at} ${fetch.windowId}`)).toEqual([
      '2026-10-21T13:00:00.000Z six_hour',
      '2026-10-21T16:00:00.000Z six_hour',
      '2026-10-21T17:00:00.000Z two_hour',
      '2026-10-21T18:00:00.000Z two_hour',
      '2026-10-21T19:00:00.000Z two_hour',
      '2026-10-21T20:00:00.000Z two_hour',
      '2026-10-21T21:00:00.000Z two_hour',
      '2026-10-21T21:45:00.000Z t60',
      '2026-10-21T22:15:00.000Z t60',
      '2026-10-21T22:45:00.000Z t15',
      '2026-10-21T23:00:00.000Z t15',
      '2026-10-21T23:15:00.000Z t15',
      '2026-10-22T00:15:00.000Z t60',
      '2026-10-22T00:45:00.000Z t60',
      '2026-10-22T01:15:00.000Z t15',
    ]);
    expect(new Set(summary.fetches.map((fetch) => fetch.at)).size).toBe(summary.fetches.length);
    const afterFirstNearTip = slateGames();
    for (const entry of afterFirstNearTip) entry.latestSnapshotAt = '2026-10-21T22:45:00.000Z';
    const atSeven = planDate({ etDate: today, now: new Date('2026-10-21T23:00:00.000Z'), games: afterFirstNearTip });
    expect(atSeven.dueGameIds).toEqual(['7:10']);
    expect(summary.attempts).toBe(15);
    expect(summary.attempts).toBeLessThanOrEqual(DAILY_ODDS_REQUEST_CEILING);
    expect(nearTipHits(summary.fetches, '2026-10-21T23:30:00.000Z', '7:30').map((hit) => hit.at)).toEqual([
      '2026-10-21T23:15:00.000Z',
    ]);
    expect(nearTipHits(summary.fetches, '2026-10-22T01:30:00.000Z', '9:30').map((hit) => hit.at)).toEqual([
      '2026-10-22T01:15:00.000Z',
    ]);
  });

  it('stores one date snapshot for games with different tip times', async () => {
    const now = new Date('2026-10-21T22:45:00.000Z');
    let transformed = 0;
    const result = await acquireOdds({ date: today }, deps(async () => ({
      ok: true,
      rows: [row(700), row(705)],
      nextCursor: null,
    }), {
      now: () => now,
      slateForDate: async () => [
        game('700', '2026-10-21T23:00:00.000Z'),
        game('705', '2026-10-21T23:05:00.000Z'),
      ],
      loadGames: async (ids) => ids.map((id) => ({
        gameId: id,
        season: '2026',
        seasonPhase: 'REGULAR',
        startTime: id === '700' ? '2026-10-21T23:00:00.000Z' : '2026-10-21T23:05:00.000Z',
      })),
      transformComplete: async () => {
        transformed += 1;
        return { current: 2, history: 2, movement: 2 };
      },
    }));
    expect(result.results.map((item) => item.classification)).toEqual(['COMPLETE']);
    expect(result.providerRequests).toBe(1);
    expect(transformed).toBe(1);
  });

  it('lets one delivery own a t15 slot', async () => {
    const claim = createMemoryOddsClaim();
    const now = new Date('2026-10-21T23:15:00.000Z');
    let calls = 0;
    const extra: Partial<AcquireDeps> = {
      now: () => now,
      slateForDate: async () => [game('730', '2026-10-21T23:30:00.000Z')],
      loadGames: async () => [game('730', '2026-10-21T23:30:00.000Z')],
      claimDate: (input) => claim.claim(input),
      completeClaim: (input) => claim.complete(input),
    };
    const first = await acquireOdds({ date: today }, deps(async () => {
      calls += 1;
      return { ok: true, rows: [row(730)], nextCursor: null };
    }, extra));
    const second = await acquireOdds({ date: today }, deps(async () => {
      calls += 1;
      return { ok: true, rows: [row(730)], nextCursor: null };
    }, extra));
    expect(first.results[0]?.classification).toBe('COMPLETE');
    expect(second.results[0]?.classification).toBe('SKIPPED');
    expect(calls).toBe(1);
    expect([...claim.held().keys()]).toHaveLength(1);
  });

  it('rejects a stale delivery without taking the next t15 slot', async () => {
    const claim = createMemoryOddsClaim();
    let calls = 0;
    const fetchPage: AcquireDeps['fetchPage'] = async () => {
      calls += 1;
      return { ok: true, rows: [row(730)], nextCursor: null };
    };
    const extra: Partial<AcquireDeps> = {
      slateForDate: async () => [game('730', '2026-10-21T23:30:00.000Z')],
      loadGames: async () => [game('730', '2026-10-21T23:30:00.000Z')],
      claimDate: (input) => claim.claim(input),
      completeClaim: (input) => claim.complete(input),
    };
    const delayed = await acquireOdds({
      date: today,
      time: '2026-10-21T23:00:00.000Z',
    }, deps(fetchPage, { ...extra, now: () => new Date('2026-10-21T23:14:00.000Z') }));
    const next = await acquireOdds({
      date: today,
      time: '2026-10-21T23:15:00.000Z',
    }, deps(fetchPage, { ...extra, now: () => new Date('2026-10-21T23:15:00.000Z') }));
    const stale = await acquireOdds({
      date: today,
      time: '2026-10-21T23:00:00.000Z',
    }, deps(fetchPage, { ...extra, now: () => new Date('2026-10-21T23:16:00.000Z') }));
    const originalSlot = oddsClaimSortKey({
      day: today,
      date: today,
      windowId: 't15',
      nowMs: Date.parse('2026-10-21T23:00:00.000Z'),
    });
    const nextSlot = oddsClaimSortKey({
      day: today,
      date: today,
      windowId: 't15',
      nowMs: Date.parse('2026-10-21T23:15:00.000Z'),
    });
    expect(delayed.results[0]?.classification).toBe('COMPLETE');
    expect(next.results[0]?.classification).toBe('COMPLETE');
    expect(stale.status).toBe('STALE');
    expect(calls).toBe(2);
    expect(originalSlot).not.toBe(nextSlot);
    expect([...claim.held().keys()].sort()).toEqual([originalSlot, nextSlot].sort());
  });

  it('keeps an incomplete t15 from replacing current odds and retries on the next slot', async () => {
    const claim = createMemoryOddsClaim();
    const budget = createMemoryOddsBudget();
    let nowMs = Date.parse('2026-10-21T22:45:00.000Z');
    let calls = 0;
    let transformed = 0;
    const slate = [game('705', '2026-10-21T23:05:00.000Z')];
    const extra: Partial<AcquireDeps> = {
      now: () => new Date(nowMs),
      slateForDate: async () => slate,
      loadGames: async () => slate,
      claimDate: (input) => claim.claim(input),
      completeClaim: (input) => claim.complete(input),
      reserveAttempt: (input) => budget.reserve(input),
      recordAttempt: (input) => budget.record(input),
      transformComplete: async () => {
        transformed += 1;
        return { current: 1, history: 1, movement: 1 };
      },
    };
    const fetchPage: AcquireDeps['fetchPage'] = async () => {
      calls += 1;
      return { ok: true, rows: [row(705)], nextCursor: 2 };
    };
    const first = await acquireOdds({ date: today }, deps(fetchPage, extra));
    nowMs += 14 * 60 * 1000;
    const sameSlot = await acquireOdds({ date: today }, deps(fetchPage, extra));
    nowMs = Date.parse('2026-10-21T23:00:00.000Z');
    const nextSlot = await acquireOdds({ date: today }, deps(fetchPage, extra));
    expect(first.results[0]?.classification).toBe('INCOMPLETE');
    expect(sameSlot.results[0]?.classification).toBe('SKIPPED');
    expect(nextSlot.results[0]?.classification).toBe('INCOMPLETE');
    expect(transformed).toBe(0);
    expect(calls).toBe(6);
    expect(budget.ledger().reserved).toBe(6);
    expect(slate[0]?.latestSnapshotAt).toBeNull();
  });

  it('keeps t15 slots deterministic across Eastern midnight and the fallback hour', () => {
    const beforeMidnight = Date.parse('2026-10-22T03:59:00.000Z');
    const midnight = Date.parse('2026-10-22T04:00:00.000Z');
    const beforeKey = oddsClaimSortKey({ day: '2026-10-21', date: today, windowId: 't15', nowMs: beforeMidnight });
    const afterKey = oddsClaimSortKey({ day: '2026-10-22', date: today, windowId: 't15', nowMs: midnight });
    expect(beforeKey).toBe(oddsClaimSortKey({ day: '2026-10-21', date: today, windowId: 't15', nowMs: beforeMidnight }));
    expect(afterKey.startsWith('2026-10-22#')).toBe(true);
    expect(beforeKey).not.toBe(afterKey);
    expect(oddsRefreshSlot('t15', midnight)).toBe((oddsRefreshSlot('t15', beforeMidnight) ?? 0) + 1);
    const firstFallback = Date.parse('2026-11-01T05:30:00.000Z');
    const secondFallback = Date.parse('2026-11-01T06:30:00.000Z');
    expect(oddsRefreshSlot('t15', secondFallback)).toBe((oddsRefreshSlot('t15', firstFallback) ?? 0) + 4);
    expect(etCalendarDate(new Date(firstFallback))).toBe('2026-11-01');
    expect(etCalendarDate(new Date(secondFallback))).toBe('2026-11-01');
    const spring = Date.parse('2026-03-08T06:30:00.000Z');
    const afterSpring = Date.parse('2026-03-08T07:30:00.000Z');
    expect(oddsRefreshSlot('t15', afterSpring)).toBe((oddsRefreshSlot('t15', spring) ?? 0) + 4);
  });

  it('keeps the staggered slate inside the shared daily ceiling', async () => {
    const cappedGames = slateGames();
    const capped = await walkDay({
      ticks: schedulerTicks(today),
      dates: [today],
      slate: () => cappedGames,
      pages: 3,
    });
    const bothToday = slateGames();
    const bothTomorrow = slate(tomorrow, '2026-10-22T23:00:00.000Z', 3);
    const bothDates = await walkDay({
      ticks: schedulerTicks(today),
      dates: [today, tomorrow],
      slate: (date) => (date === today ? bothToday : bothTomorrow),
      pages: 3,
    });
    expect(capped.attempts).toBe(45);
    expect(capped.reserved).toBe(45);
    expect(bothDates.attempts).toBe(54);
    expect(bothDates.attempts).toBeLessThanOrEqual(DAILY_ODDS_REQUEST_CEILING);
    expect(bothDates.byDay['2026-10-21'] + (bothDates.byDay['2026-10-22'] ?? 0)).toBe(bothDates.attempts);
  });
});
