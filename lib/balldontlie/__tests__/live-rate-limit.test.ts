import { describe, expect, it, vi } from 'vitest';
import {
  BdlRateLimitError,
  acquireLiveBdlPermit,
  createMemoryLiveRateLimitStore,
  fetchBdlLive,
  readLiveRateLimitConfig,
  refillBucket,
  shouldSkipLiveBdlHttp,
  type LiveRateLimitConfig,
  type LiveRateLimitStore,
} from '@/lib/balldontlie/live-rate-limit';

const LIVE_ENV = {
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
  BDL_RATE_LIMIT_BACKEND: 'memory',
  BDL_RATE_LIMIT_ALLOW_FAST: '1',
  BDL_RATE_LIMIT_INTERVAL_MS: '10',
  BDL_RATE_LIMIT_MAX_REQUESTS: '1',
  BDL_RATE_LIMIT_BURST: '1',
  BDL_RATE_LIMIT_ACQUIRE_TIMEOUT_MS: '5000',
  MAX_RETRIES: '2',
  BDL_RATE_LIMIT_RETRY_BASE_MS: '50',
  BDL_RATE_LIMIT_WORKER: 'test-worker',
};

function liveConfig(overrides: Partial<LiveRateLimitConfig> = {}): LiveRateLimitConfig {
  return {
    ...readLiveRateLimitConfig({ ...LIVE_ENV }),
    ...overrides,
  };
}

function fakeClock(startMs = 1_000_000) {
  let now = startMs;
  const sleeps: number[] = [];
  return {
    nowMs: () => now,
    sleeps,
    sleepFn: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function okResponse(): Response {
  return new Response('ok', { status: 200 });
}

describe('shouldSkipLiveBdlHttp / replay guard', () => {
  it('skips replay, offseason, dry-run, and missing DATA_MODE', () => {
    expect(shouldSkipLiveBdlHttp({ DATA_MODE: 'replay' })).toBe(true);
    expect(shouldSkipLiveBdlHttp({ DATA_MODE: 'live_api', OFFSEASON_MODE: '1' })).toBe(true);
    expect(shouldSkipLiveBdlHttp({ DATA_MODE: 'live_api', CRON_DRY_RUN: '1' })).toBe(true);
    expect(shouldSkipLiveBdlHttp({})).toBe(true);
  });

  it('allows only exact live_api without freeze flags', () => {
    expect(shouldSkipLiveBdlHttp(LIVE_ENV)).toBe(false);
  });

  it('does not call fetch in replay mode', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    await expect(
      fetchBdlLive('https://api.balldontlie.io/v1/games', undefined, {
        env: { DATA_MODE: 'replay', CRON_DRY_RUN: '1', OFFSEASON_MODE: '1' },
        fetchImpl,
      })
    ).rejects.toMatchObject({ code: 'replay' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('config', () => {
  it('defaults to the activation-canary safety interval of 13000ms', () => {
    const cfg = readLiveRateLimitConfig({
      BDL_RATE_LIMIT_BACKEND: 'memory',
    });
    expect(cfg.intervalMs).toBe(13_000);
    expect(cfg.acquireTimeoutMs).toBe(90_000);
    expect(cfg.burst).toBe(1);
    expect(cfg.maxRequests).toBe(1);
  });

  it('floors interval at 200ms unless BDL_RATE_LIMIT_ALLOW_FAST=1', () => {
    const slow = readLiveRateLimitConfig({ BDL_RATE_LIMIT_INTERVAL_MS: '1' });
    expect(slow.intervalMs).toBe(200);
    const fast = readLiveRateLimitConfig({
      BDL_RATE_LIMIT_INTERVAL_MS: '1',
      BDL_RATE_LIMIT_ALLOW_FAST: '1',
    });
    expect(fast.intervalMs).toBe(1);
  });

  it('defaults backend to dynamodb outside tests and requires a table', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    await expect(
      fetchBdlLive('https://api.balldontlie.io/v1/games', undefined, {
        env: {
          ...LIVE_ENV,
          BDL_RATE_LIMIT_BACKEND: 'dynamodb',
          BDL_RATE_LIMIT_TABLE: '',
          VITEST: undefined,
          NODE_ENV: 'production',
        },
        fetchImpl,
      })
    ).rejects.toMatchObject({ code: 'config' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('refill / clock jitter', () => {
  it('does not mint extra tokens when the clock moves backwards', () => {
    const config = liveConfig({ burst: 1, maxRequests: 1, intervalMs: 1000 });
    const later = refillBucket({ tokens: 0, lastRefillMs: 5000, version: 1 }, 4000, config);
    expect(later.tokens).toBe(0);
  });
});

describe('acquireLiveBdlPermit concurrency', () => {
  it('does not oversubscribe burst=1 across simultaneous workers', async () => {
    const store = createMemoryLiveRateLimitStore();
    const clock = fakeClock();
    const config = liveConfig({
      intervalMs: 10,
      maxRequests: 1,
      burst: 1,
      acquireTimeoutMs: 10_000,
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        acquireLiveBdlPermit({
          store,
          config,
          nowMs: clock.nowMs,
          sleepFn: clock.sleepFn,
        })
      )
    );
    expect(results).toHaveLength(8);
    expect(results.every((r) => r.granted)).toBe(true);
    const bucket = await store.loadBucket();
    expect(bucket).not.toBeNull();
    expect(bucket!.tokens).toBeLessThan(1);
    expect(bucket!.version).toBe(8);
  });

  it('recovers after a consumed permit (crashed holder does not deadlock)', async () => {
    const store = createMemoryLiveRateLimitStore();
    const clock = fakeClock();
    const config = liveConfig({ intervalMs: 25, maxRequests: 1, burst: 1, acquireTimeoutMs: 1000 });
    await acquireLiveBdlPermit({ store, config, nowMs: clock.nowMs, sleepFn: clock.sleepFn });
    const second = acquireLiveBdlPermit({
      store,
      config,
      nowMs: clock.nowMs,
      sleepFn: clock.sleepFn,
    });
    await expect(second).resolves.toMatchObject({ granted: true });
    expect(clock.sleeps.some((ms) => ms >= 1)).toBe(true);
  });

  it('times out instead of waiting forever', async () => {
    let now = 1000;
    const store: LiveRateLimitStore = {
      loadBucket: async () => ({ tokens: 0, lastRefillMs: 0, version: 1 }),
      saveBucket: async () => 'ok',
      getCooldownUntilMs: async () => now + 60_000,
      setCooldownUntilMs: async () => undefined,
    };
    await expect(
      acquireLiveBdlPermit({
        store,
        config: liveConfig({ acquireTimeoutMs: 5, intervalMs: 1000 }),
        nowMs: () => now,
        sleepFn: async (ms) => {
          now += Math.max(ms, 1);
        },
      })
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('fails closed when coordination returns unavailable', async () => {
    const store: LiveRateLimitStore = {
      loadBucket: async () => ({ tokens: 1, lastRefillMs: 0, version: 1 }),
      saveBucket: async () => 'unavailable',
      getCooldownUntilMs: async () => null,
      setCooldownUntilMs: async () => undefined,
    };
    const fetchImpl = vi.fn(async () => okResponse());
    await expect(
      fetchBdlLive('https://api.balldontlie.io/v1/games', undefined, {
        env: LIVE_ENV,
        store,
        fetchImpl,
        nowMs: () => 1_000,
        sleepFn: async () => undefined,
      })
    ).rejects.toMatchObject({ code: 'coordination' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when the store throws', async () => {
    const store: LiveRateLimitStore = {
      loadBucket: async () => {
        throw new Error('dynamo down');
      },
      saveBucket: async () => 'ok',
      getCooldownUntilMs: async () => null,
      setCooldownUntilMs: async () => undefined,
    };
    const fetchImpl = vi.fn(async () => okResponse());
    await expect(
      fetchBdlLive('https://api.balldontlie.io/v1/games', undefined, {
        env: LIVE_ENV,
        store,
        fetchImpl,
      })
    ).rejects.toMatchObject({ code: 'coordination' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('429 / Retry-After', () => {
  it('honors Retry-After and does not immediately retry', async () => {
    const store = createMemoryLiveRateLimitStore();
    const clock = fakeClock();
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('slow down', { status: 429, headers: { 'Retry-After': '2' } });
      }
      return okResponse();
    });
    const res = await fetchBdlLive('https://api.balldontlie.io/v1/games', undefined, {
      env: { ...LIVE_ENV, MAX_RETRIES: '3' },
      store,
      fetchImpl,
      nowMs: clock.nowMs,
      sleepFn: clock.sleepFn,
      worker: 'odds-pre-game-snapshot',
    });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(clock.sleeps).toContain(2000);
    expect(clock.nowMs() - 1_000_000).toBeGreaterThanOrEqual(2000);
  });

  it('bounds 429 retries and then fails closed', async () => {
    const store = createMemoryLiveRateLimitStore();
    const clock = fakeClock();
    const fetchImpl = vi.fn(
      async () => new Response('no', { status: 429, headers: { 'Retry-After': '1' } })
    );
    await expect(
      fetchBdlLive('https://api.balldontlie.io/v1/games', undefined, {
        env: { ...LIVE_ENV, MAX_RETRIES: '1' },
        store,
        fetchImpl,
        nowMs: clock.nowMs,
        sleepFn: clock.sleepFn,
      })
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('writes a global cooldown so a sibling worker waits', async () => {
    const store = createMemoryLiveRateLimitStore();
    const clock = fakeClock();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('no', { status: 429, headers: { 'Retry-After': '3' } }))
      .mockResolvedValueOnce(okResponse());

    await expect(
      fetchBdlLive('https://api.balldontlie.io/v1/odds', undefined, {
        env: { ...LIVE_ENV, MAX_RETRIES: '0' },
        store,
        fetchImpl,
        nowMs: clock.nowMs,
        sleepFn: clock.sleepFn,
        worker: 'injuries-snapshot',
      })
    ).rejects.toMatchObject({ code: 'timeout' });

    await fetchBdlLive('https://api.balldontlie.io/v2/odds/player_props', undefined, {
      env: LIVE_ENV,
      store,
      fetchImpl,
      nowMs: clock.nowMs,
      sleepFn: clock.sleepFn,
      worker: 'player-props-worker',
    });

    expect(clock.sleeps).toContain(3000);
  });
});

describe('account-level overlap simulation (no HTTP to BDL)', () => {
  it('nightly + injuries concurrent share one bucket', async () => {
    const store = createMemoryLiveRateLimitStore();
    const clock = fakeClock();
    const fetchImpl = vi.fn(async () => okResponse());
    await Promise.all([
      fetchBdlLive('https://example.invalid/nightly', undefined, {
        env: LIVE_ENV,
        store,
        fetchImpl,
        nowMs: clock.nowMs,
        sleepFn: clock.sleepFn,
        worker: 'nightly-bdl-updater',
      }),
      fetchBdlLive('https://example.invalid/injuries', undefined, {
        env: LIVE_ENV,
        store,
        fetchImpl,
        nowMs: clock.nowMs,
        sleepFn: clock.sleepFn,
        worker: 'injuries-snapshot',
      }),
    ]);
    const bucket = await store.loadBucket();
    expect(bucket?.version).toBe(2);
  });

  it('odds + multiple props workers do not exceed 1 rps policy', async () => {
    const store = createMemoryLiveRateLimitStore();
    const clock = fakeClock();
    const grantTimes: number[] = [];
    const wrappingStore: LiveRateLimitStore = {
      loadBucket: () => store.loadBucket(),
      saveBucket: async (next, expected) => {
        const result = await store.saveBucket(next, expected);
        if (result === 'ok') grantTimes.push(clock.nowMs());
        return result;
      },
      getCooldownUntilMs: () => store.getCooldownUntilMs(),
      setCooldownUntilMs: (until, ttl) => store.setCooldownUntilMs(until, ttl),
    };
    const fetchImpl = vi.fn(async () => okResponse());
    const configEnv = {
      ...LIVE_ENV,
      BDL_RATE_LIMIT_INTERVAL_MS: '1000',
      BDL_RATE_LIMIT_BURST: '1',
    };
    await Promise.all([
      fetchBdlLive('https://example.invalid/odds', undefined, {
        env: configEnv,
        store: wrappingStore,
        fetchImpl,
        nowMs: clock.nowMs,
        sleepFn: clock.sleepFn,
        worker: 'odds-pre-game-snapshot',
      }),
      ...Array.from({ length: 4 }, (_, i) =>
        fetchBdlLive(`https://example.invalid/props/${i}`, undefined, {
          env: configEnv,
          store: wrappingStore,
          fetchImpl,
          nowMs: clock.nowMs,
          sleepFn: clock.sleepFn,
          worker: 'player-props-worker',
        })
      ),
    ]);
    expect(grantTimes).toHaveLength(5);
    const gaps = grantTimes.slice(1).map((t, i) => t - grantTimes[i]);
    expect(gaps.every((g) => g >= 1000)).toBe(true);
  });

  it('models ~400 req/day game-day traffic under 1 rps without bursting above policy', async () => {
    const store = createMemoryLiveRateLimitStore();
    const clock = fakeClock();
    const grantTimes: number[] = [];
    const wrappingStore: LiveRateLimitStore = {
      loadBucket: () => store.loadBucket(),
      saveBucket: async (next, expected) => {
        const result = await store.saveBucket(next, expected);
        if (result === 'ok') grantTimes.push(clock.nowMs());
        return result;
      },
      getCooldownUntilMs: () => store.getCooldownUntilMs(),
      setCooldownUntilMs: (until, ttl) => store.setCooldownUntilMs(until, ttl),
    };
    const config = liveConfig({
      intervalMs: 1000,
      maxRequests: 1,
      burst: 1,
      acquireTimeoutMs: 500_000,
    });
    const n = 400;
    for (let i = 0; i < n; i += 1) {
      await acquireLiveBdlPermit({
        store: wrappingStore,
        config,
        nowMs: clock.nowMs,
        sleepFn: clock.sleepFn,
      });
    }
    expect(grantTimes).toHaveLength(400);
    const elapsed = grantTimes[grantTimes.length - 1] - grantTimes[0];
    expect(elapsed).toBeGreaterThanOrEqual(399_000);
    const gaps = grantTimes.slice(1).map((t, i) => t - grantTimes[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1000);
  });

  it('worker retry after failure still consumes a new permit (no bypass)', async () => {
    const store = createMemoryLiveRateLimitStore();
    const clock = fakeClock();
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(okResponse());
    await expect(
      fetchBdlLive('https://example.invalid/retry', undefined, {
        env: LIVE_ENV,
        store,
        fetchImpl,
        nowMs: clock.nowMs,
        sleepFn: clock.sleepFn,
      })
    ).rejects.toThrow('network');
    await fetchBdlLive('https://example.invalid/retry', undefined, {
      env: LIVE_ENV,
      store,
      fetchImpl,
      nowMs: clock.nowMs,
      sleepFn: clock.sleepFn,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((await store.loadBucket())?.version).toBe(2);
  });
});
