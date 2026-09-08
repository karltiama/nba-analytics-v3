import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireBdlAcquisitionLock, BDL_TRIAL_LOCK_BUSY } from '../acquisition-lock';
import { BdlArchiveClient } from '../archive-client';
import { parseRetryAfterMs, delayForRateLimit } from '../retry-after';
import {
  BDL_TRIAL_DEFAULT_DELAY_MS,
  BDL_TRIAL_MIN_DELAY_MS,
  resolveBdlRequestDelayMs,
} from '../trial-limiter';

describe('Retry-After', () => {
  it('parses delay-seconds and HTTP-date', () => {
    expect(parseRetryAfterMs('12')).toBe(12_000);
    const now = Date.parse('Wed, 08 Sep 2026 00:00:00 GMT');
    expect(parseRetryAfterMs('Wed, 08 Sep 2026 00:00:13 GMT', now)).toBe(13_000);
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs('nope')).toBeNull();
  });

  it('prefers Retry-After over exponential fallback', () => {
    const hit = delayForRateLimit({ retryAfterHeader: '15', attempt: 0, retryBaseDelayMs: 60_000 });
    expect(hit).toEqual({ delayMs: 15_000, source: 'retry-after' });
    const miss = delayForRateLimit({ retryAfterHeader: null, attempt: 1, retryBaseDelayMs: 60_000 });
    expect(miss).toEqual({ delayMs: 120_000, source: 'exponential' });
  });
});

describe('BDL trial limiter', () => {
  it('uses 200ms outside trial mode', () => {
    const r = resolveBdlRequestDelayMs({ env: {} });
    expect(r.trialMode).toBe(false);
    expect(r.delayMs).toBe(200);
  });

  it('defaults to ~13s and concurrency 1 in trial mode', () => {
    const r = resolveBdlRequestDelayMs({ env: { BDL_TRIAL_MODE: '1' } });
    expect(r.delayMs).toBe(BDL_TRIAL_DEFAULT_DELAY_MS);
    expect(r.concurrency).toBe(1);
  });

  it('fail-closes on 200ms while trial mode is on', () => {
    expect(() =>
      resolveBdlRequestDelayMs({ env: { BDL_TRIAL_MODE: '1', BALLDONTLIE_REQUEST_DELAY_MS: '200' } })
    ).toThrow(/forbids delay 200ms/);
    expect(() =>
      resolveBdlRequestDelayMs({ env: { BDL_TRIAL_MODE: '1' }, requestedDelayMs: 200 })
    ).toThrow(/12/);
  });

  it('allows an explicit delay at or above 12s', () => {
    const r = resolveBdlRequestDelayMs({
      env: { BDL_TRIAL_MODE: '1' },
      requestedDelayMs: BDL_TRIAL_MIN_DELAY_MS,
    });
    expect(r.delayMs).toBe(12_000);
  });
});

describe('BdlArchiveClient Retry-After + trial logging', () => {
  const prev = process.env.BDL_TRIAL_MODE;
  afterEach(() => {
    if (prev === undefined) delete process.env.BDL_TRIAL_MODE;
    else process.env.BDL_TRIAL_MODE = prev;
  });

  it('honors Retry-After on 429 then succeeds', async () => {
    delete process.env.BDL_TRIAL_MODE;
    const logs: string[] = [];
    let n = 0;
    const fetchImpl = async () => {
      n += 1;
      if (n === 1) {
        return new Response('rate', { status: 429, headers: { 'Retry-After': '0' } });
      }
      return new Response(JSON.stringify({ data: [], meta: {} }), { status: 200 });
    };
    const client = new BdlArchiveClient({
      apiKey: 'test-key-not-secret',
      requestDelayMs: 0,
      maxRetries: 2,
      retryBaseDelayMs: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: (m) => logs.push(m),
    });
    const res = await client.fetchWithRetry('https://api.balldontlie.io/v1/games');
    expect(res.status).toBe(200);
    expect(logs.some((l) => l.includes('retry-after'))).toBe(true);
    expect(logs.join('\n')).not.toMatch(/test-key-not-secret/);
  });
});

describe('acquisition lock', () => {
  it('refuses a second lock while the first is held', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdl-lock-'));
    const lockPath = path.join(dir, 'bdl.lock');
    const a = acquireBdlAcquisitionLock(lockPath);
    expect(() => acquireBdlAcquisitionLock(lockPath)).toThrow(BDL_TRIAL_LOCK_BUSY);
    a.release();
    const b = acquireBdlAcquisitionLock(lockPath);
    b.release();
  });
});
