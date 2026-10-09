import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { fetchPlayerPropsForGame, PLAYER_PROPS_MAX_PAGES } from '../../src/fetch';
import { getGameTargets, isPropsTargetEligible } from '../../src/game-discovery';
import { createMemoryLiveRateLimitStore } from '../../src/bdl-live-rate-limit';

const LIMITER_ENV = {
  DATA_MODE: 'live_api',
  BDL_RATE_LIMIT_BACKEND: 'memory',
  BDL_RATE_LIMIT_ALLOW_FAST: '1',
  BDL_RATE_LIMIT_INTERVAL_MS: '1',
  BDL_RATE_LIMIT_MAX_RETRIES: '0',
};

const limiter = () => ({ env: LIMITER_ENV, store: createMemoryLiveRateLimitStore(), sleepFn: async () => {} });

const prop = (id: number) => ({
  id,
  game_id: 21717855,
  player_id: 77,
  vendor: 'draftkings',
  prop_type: 'points',
  line_value: '27.5',
  market: { type: 'over_under', over_odds: -110, under_odds: -110 },
  updated_at: '2026-10-20T20:00:00.000Z',
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('props target eligibility', () => {
  it('Oct 19 tip is fenced; Oct 20 tips (including late ET) are kept', () => {
    expect(isPropsTargetEligible({ game_id: '1', season: '2026', start_time: '2026-10-19T23:30:00.000Z' })).toBe(false);
    expect(isPropsTargetEligible({ game_id: '2', season: '2026', start_time: '2026-10-20T23:30:00.000Z' })).toBe(true);
    expect(isPropsTargetEligible({ game_id: '3', season: '2026', start_time: '2026-10-21T02:30:00.000Z' })).toBe(true);
  });

  it('unknown season or missing tip fails closed', () => {
    expect(isPropsTargetEligible({ game_id: '1', season: null, start_time: '2026-10-22T23:30:00.000Z' })).toBe(false);
    expect(isPropsTargetEligible({ game_id: '1', season: '2027', start_time: '2027-11-01T23:30:00.000Z' })).toBe(false);
    expect(isPropsTargetEligible({ game_id: '1', season: '2026', start_time: null })).toBe(false);
  });

  it('labelled phase must be a serving phase; absent label falls back to the date fence', () => {
    const base = { game_id: '1', season: '2026', start_time: '2026-10-22T23:30:00.000Z' };
    expect(isPropsTargetEligible({ ...base, season_phase: 'REGULAR' })).toBe(true);
    expect(isPropsTargetEligible({ ...base, season_phase: 'IST' })).toBe(true);
    expect(isPropsTargetEligible({ ...base, season_phase: 'PRESEASON' })).toBe(false);
    expect(isPropsTargetEligible({ ...base, season_phase: 'UNCLASSIFIED' })).toBe(false);
    expect(isPropsTargetEligible({ ...base, season_phase: null })).toBe(true);
  });

  it('getGameTargets drops preseason rows returned by the DB', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          { game_id: '100', season: '2026', start_time: new Date('2026-10-19T23:30:00.000Z'), season_phase: null },
          { game_id: '101', season: '2026', start_time: new Date('2026-10-21T02:30:00.000Z'), season_phase: null },
        ],
      })),
    } as unknown as Pool;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const targets = await getGameTargets({
      pool,
      universe: 'near_tip',
      date: '2026-10-20',
      now: new Date('2026-10-21T01:20:00.000Z'),
    });
    warn.mockRestore();
    expect(targets).toEqual([{ gameId: '101', bdlGameId: 101 }]);
  });
});

describe('props pagination', () => {
  it('single page without meta behaves as before', async () => {
    const baseFetch = vi.fn(async () => json({ data: [prop(1)] }));
    const res = await fetchPlayerPropsForGame('k', 21717855, { limiter: limiter(), baseFetch });
    expect(res.rows.map((r) => r.id)).toEqual([1]);
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it('follows next_cursor across pages through the limiter and concatenates rows', async () => {
    const urls: string[] = [];
    const baseFetch = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      urls.push(url);
      const cursor = new URL(url).searchParams.get('cursor');
      if (cursor == null) return json({ data: [prop(1)], meta: { next_cursor: 11 } });
      if (cursor === '11') return json({ data: [prop(2)], meta: { next_cursor: 12 } });
      return json({ data: [prop(3)], meta: { next_cursor: null } });
    });
    const times = [0, 1, 2, 3, 4, 5].map((s) => new Date(Date.UTC(2026, 9, 20, 20, 0, s)));
    let i = 0;
    const res = await fetchPlayerPropsForGame('k', 21717855, {
      limiter: limiter(),
      baseFetch,
      now: () => times[Math.min(i++, times.length - 1)],
    });
    expect(res.rows.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(urls.map((u) => new URL(u).searchParams.get('cursor'))).toEqual([null, '11', '12']);
    expect(urls.every((u) => new URL(u).searchParams.get('game_id') === '21717855')).toBe(true);
    expect(res.observation.requestStartedAt).toEqual(times[0]);
    expect(res.observation.responseReceivedAt).toEqual(times[5]);
    expect(res.observation.attempts).toHaveLength(3);
  });

  it('exceeding the page cap throws instead of returning a partial snapshot', async () => {
    let n = 0;
    const baseFetch = vi.fn(async () => json({ data: [prop(++n)], meta: { next_cursor: n + 1000 } }));
    await expect(fetchPlayerPropsForGame('k', 21717855, { limiter: limiter(), baseFetch })).rejects.toThrow(
      /exceeded 10 pages/
    );
    expect(baseFetch).toHaveBeenCalledTimes(PLAYER_PROPS_MAX_PAGES);
  });

  it('a malformed later page fails the whole fetch', async () => {
    const baseFetch = vi.fn(async (input: Parameters<typeof fetch>[0]) =>
      new URL(String(input)).searchParams.get('cursor') == null
        ? json({ data: [prop(1)], meta: { next_cursor: 5 } })
        : json({ data: [{ id: 'bad' }] })
    );
    await expect(fetchPlayerPropsForGame('k', 21717855, { limiter: limiter(), baseFetch })).rejects.toThrow(
      /malformed page 2/
    );
  });

  it('a non-OK later page fails the whole fetch', async () => {
    const baseFetch = vi.fn(async (input: Parameters<typeof fetch>[0]) =>
      new URL(String(input)).searchParams.get('cursor') == null
        ? json({ data: [prop(1)], meta: { next_cursor: 5 } })
        : json({ error: 'boom' }, 500)
    );
    await expect(fetchPlayerPropsForGame('k', 21717855, { limiter: limiter(), baseFetch })).rejects.toThrow(
      /500 \(page 2\)/
    );
  });

  it('a repeated cursor fails instead of looping', async () => {
    const baseFetch = vi.fn(async () => json({ data: [prop(1)], meta: { next_cursor: 7 } }));
    await expect(fetchPlayerPropsForGame('k', 21717855, { limiter: limiter(), baseFetch })).rejects.toThrow(
      /repeated cursor 7/
    );
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it('a row for a different game on any page fails the whole fetch', async () => {
    const baseFetch = vi.fn(async (input: string | URL | Request) =>
      new URL(String(input)).searchParams.get('cursor') == null
        ? json({ data: [prop(1)], meta: { next_cursor: 5 } })
        : json({ data: [prop(2), { ...prop(3), game_id: 21717856 }], meta: { next_cursor: null } })
    );
    await expect(fetchPlayerPropsForGame('k', 21717855, { limiter: limiter(), baseFetch })).rejects.toThrow(
      /page 2 returned row for game 21717856/
    );
  });

  it('a truncated JSON body fails the whole fetch', async () => {
    const baseFetch = vi.fn(
      async () => new Response('{"data":[{"id":1', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    await expect(fetchPlayerPropsForGame('k', 21717855, { limiter: limiter(), baseFetch })).rejects.toThrow();
  });
});
