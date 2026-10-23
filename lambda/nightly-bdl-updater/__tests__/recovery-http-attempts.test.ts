import { describe, expect, it } from 'vitest';
import { BdlRateLimitError, createMemoryLiveRateLimitStore, fetchBdlLive } from '../bdl-live-rate-limit';

const env = {
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
  BDL_RATE_LIMIT_BACKEND: 'memory',
  BDL_RATE_LIMIT_ALLOW_FAST: '1',
  BDL_RATE_LIMIT_INTERVAL_MS: '1',
  BDL_RATE_LIMIT_MAX_REQUESTS: '1',
  BDL_RATE_LIMIT_BURST: '5',
  BDL_RATE_LIMIT_MAX_RETRIES: '3',
  BDL_RATE_LIMIT_RETRY_BASE_MS: '1',
  BDL_RATE_LIMIT_MAX_RETRY_WAIT_MS: '10',
  BDL_RATE_LIMIT_WORKER: 'recovery-http-test',
};

describe('recovery HTTP attempt callback', () => {
  it('counts a 429 and the following success as two HTTP attempts', async () => {
    const statuses = [429, 200];
    const seen: Array<number | 'error'> = [];
    const response = await fetchBdlLive('https://example.test/stats', {}, {
      env,
      store: createMemoryLiveRateLimitStore(),
      sleepFn: async () => {},
      fetchImpl: async () => new Response('ok', { status: statuses.shift() ?? 500 }),
      onHttpAttempt: (event) => seen.push(event.status),
    });
    expect(response.status).toBe(200);
    expect(seen).toEqual([429, 200]);
  });

  it('does not keep calling after the limiter 429 allowance', async () => {
    const seen: Array<number | 'error'> = [];
    await expect(
      fetchBdlLive('https://example.test/stats', {}, {
        env: { ...env, BDL_RATE_LIMIT_MAX_RETRIES: '1' },
        store: createMemoryLiveRateLimitStore(),
        sleepFn: async () => {},
        fetchImpl: async () => new Response('no', { status: 429 }),
        onHttpAttempt: (event) => seen.push(event.status),
      })
    ).rejects.toBeInstanceOf(BdlRateLimitError);
    expect(seen).toEqual([429, 429]);
  });

  it('stops the 429 loop when the attempt callback rejects the budget', async () => {
    const seen: Array<number | 'error'> = [];
    let fetches = 0;
    await expect(
      fetchBdlLive('https://example.test/stats', {}, {
        env,
        store: createMemoryLiveRateLimitStore(),
        sleepFn: async () => {},
        fetchImpl: async () => {
          fetches += 1;
          return new Response('no', { status: 429 });
        },
        beforeHttpAttempt: () => {
          if (fetches >= 1) throw new Error('request budget exhausted');
        },
        onHttpAttempt: (event) => seen.push(event.status),
      })
    ).rejects.toThrow(/request budget exhausted/);
    expect(fetches).toBe(1);
    expect(seen).toEqual([429]);
  });
});
