import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { dailyLimitForPlan, utcDayKey } from '../config';
import { createPostgresXrayStore } from '../postgres-store';
import { runXrayExtraction } from '../pipeline';
import { XrayProviderError, type XrayVisionProvider } from '../provider';
import { MIN_PNG, pngVariant, sampleVision, testConfig } from './fixtures';
import { listXrayTableColumns, resetXrayGuardrailTables, startXrayTestPostgres } from './pg-harness';

function okProvider(requestId = 'mock-req'): XrayVisionProvider {
  return vi.fn(async () => ({
    output: sampleVision(),
    requestId,
    promptTokens: 80,
    completionTokens: 20,
    totalTokens: 100,
  }));
}

describe('postgres xray guardrail persistence', () => {
  let pool: Pool;
  let target = 'uninitialized';
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    const started = await startXrayTestPostgres();
    pool = started.pool;
    target = started.target;
  }, 90_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await resetXrayGuardrailTables(pool);
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    if (!fetchSpy) return;
    const urls = fetchSpy.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes('api.openai.com'))).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('applies additive XRay tables with expected names and no image-byte columns', async () => {
    const sql = readFileSync(join(process.cwd(), 'sql/proposed/parlay-xray-extraction-guardrails.sql'), 'utf8');
    expect(sql).not.toMatch(/^\s*DROP\s+/im);
    expect(sql).not.toMatch(/\bbytea\b/i);
    const cols = await listXrayTableColumns(pool);
    const tables = [...new Set(cols.map((c) => c.table_name))];
    expect(tables.sort()).toEqual(
      [
        'parlay_xray_cooldowns',
        'parlay_xray_daily_counters',
        'parlay_xray_dedupe',
        'parlay_xray_extraction_usage',
        'parlay_xray_inflight',
      ].sort()
    );
    expect(cols.some((c) => c.column_name === 'schema_version')).toBe(true);
    expect(cols.some((c) => /image_bytes|screenshot|png|jpeg|data_url/i.test(c.column_name))).toBe(false);
    expect(target.length).toBeGreaterThan(0);
  });

  it('persists free vs pro vs unresolved-plan limits on UTC day buckets', async () => {
    const store = createPostgresXrayStore(pool);
    const day = '2026-09-15';
    const configFree = testConfig({ freeDailyLimit: 3, proDailyLimit: 10, store: 'postgres' });
    expect(dailyLimitForPlan(configFree, false)).toBe(3);
    expect(dailyLimitForPlan(configFree, true)).toBe(10);
    expect(utcDayKey(new Date('2026-09-15T23:59:59.000Z'))).toBe(day);
    expect(utcDayKey(new Date('2026-09-16T00:00:00.000Z'))).toBe('2026-09-16');

    const provider = okProvider();
    const first = await runXrayExtraction(
      { userId: 'free-user', isPro: false, bytes: pngVariant('a'), declaredMime: 'image/png' },
      { config: testConfig({ freeDailyLimit: 1, store: 'postgres' }), store, provider, now: () => new Date(`${day}T12:00:00.000Z`) }
    );
    expect(first.result).toBe('SUCCESS');
    expect(first.quota.used).toBe(1);
    const blocked = await runXrayExtraction(
      { userId: 'free-user', isPro: false, bytes: pngVariant('b'), declaredMime: 'image/png' },
      { config: testConfig({ freeDailyLimit: 1, store: 'postgres' }), store, provider, now: () => new Date(`${day}T18:00:00.000Z`) }
    );
    expect(blocked.result).toBe('USER_QUOTA_EXCEEDED');

    const nextDay = await runXrayExtraction(
      { userId: 'free-user', isPro: false, bytes: pngVariant('c'), declaredMime: 'image/png' },
      { config: testConfig({ freeDailyLimit: 1, store: 'postgres' }), store, provider, now: () => new Date('2026-09-16T00:05:00.000Z') }
    );
    expect(nextDay.result).toBe('SUCCESS');

    const other = await runXrayExtraction(
      { userId: 'other-user', isPro: false, bytes: pngVariant('d'), declaredMime: 'image/png' },
      { config: testConfig({ freeDailyLimit: 1, store: 'postgres' }), store, provider, now: () => new Date(`${day}T12:00:00.000Z`) }
    );
    expect(other.result).toBe('SUCCESS');

    const pro = await runXrayExtraction(
      { userId: 'pro-user', isPro: true, bytes: pngVariant('e'), declaredMime: 'image/png' },
      { config: testConfig({ freeDailyLimit: 1, proDailyLimit: 2, store: 'postgres' }), store, provider, now: () => new Date(`${day}T12:00:00.000Z`) }
    );
    expect(pro.result).toBe('SUCCESS');
    const pro2 = await runXrayExtraction(
      { userId: 'pro-user', isPro: true, bytes: pngVariant('f'), declaredMime: 'image/png' },
      { config: testConfig({ freeDailyLimit: 1, proDailyLimit: 2, store: 'postgres' }), store, provider, now: () => new Date(`${day}T12:01:00.000Z`) }
    );
    expect(pro2.result).toBe('SUCCESS');
    const proBlocked = await runXrayExtraction(
      { userId: 'pro-user', isPro: true, bytes: pngVariant('g'), declaredMime: 'image/png' },
      { config: testConfig({ freeDailyLimit: 1, proDailyLimit: 2, store: 'postgres' }), store, provider, now: () => new Date(`${day}T12:02:00.000Z`) }
    );
    expect(proBlocked.result).toBe('USER_QUOTA_EXCEEDED');
    expect(provider).toHaveBeenCalledTimes(5);

    const { rows } = await pool.query<{ count: number }>(
      `SELECT count FROM parlay_xray_daily_counters WHERE bucket_date = $1::date AND scope = $2`,
      [day, 'user:free-user']
    );
    expect(rows[0]?.count).toBe(1);
    expect(rows[0]?.count).toBeGreaterThanOrEqual(0);
  });

  it('does not let one user consume another user quota', async () => {
    const store = createPostgresXrayStore(pool);
    const provider = okProvider();
    const config = testConfig({ freeDailyLimit: 1, store: 'postgres' });
    const now = () => new Date('2026-09-15T12:00:00.000Z');
    await runXrayExtraction(
      { userId: 'a', isPro: false, bytes: pngVariant('a'), declaredMime: 'image/png' },
      { config, store, provider, now }
    );
    const b = await runXrayExtraction(
      { userId: 'b', isPro: false, bytes: pngVariant('b'), declaredMime: 'image/png' },
      { config, store, provider, now }
    );
    expect(b.result).toBe('SUCCESS');
    expect(b.quota.used).toBe(1);
  });

  it('enforces a persisted global cap atomically across users', async () => {
    const store = createPostgresXrayStore(pool);
    const provider = okProvider();
    const config = testConfig({ globalDailyLimit: 1, store: 'postgres' });
    const now = () => new Date('2026-09-15T12:00:00.000Z');
    const [a, b] = await Promise.all([
      runXrayExtraction(
        { userId: 'g1', isPro: false, bytes: pngVariant('a'), declaredMime: 'image/png' },
        { config, store, provider, now }
      ),
      runXrayExtraction(
        { userId: 'g2', isPro: true, bytes: pngVariant('b'), declaredMime: 'image/png' },
        { config, store, provider, now }
      ),
    ]);
    const spent = [a, b].filter((r) => r.providerAttempted);
    const blocked = [a, b].filter((r) => r.result === 'GLOBAL_QUOTA_EXCEEDED' || r.result === 'IN_FLIGHT');
    expect(spent).toHaveLength(1);
    expect(blocked).toHaveLength(1);
    expect(provider).toHaveBeenCalledTimes(1);
    const { rows } = await pool.query<{ count: number }>(
      `SELECT count FROM parlay_xray_daily_counters WHERE bucket_date = '2026-09-15'::date AND scope = 'global'`
    );
    expect(rows[0]?.count).toBe(1);
  });

  it('releases quota and inflight on pre-provider internal failure', async () => {
    const store = createPostgresXrayStore(pool);
    const provider = okProvider();
    const result = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      {
        config: testConfig({ freeDailyLimit: 1, store: 'postgres' }),
        store,
        provider,
        now: () => new Date('2026-09-15T12:00:00.000Z'),
        beforeProvider: () => {
          throw new Error('cert-before-provider');
        },
      }
    );
    expect(result.result).toBe('INTERNAL_ERROR');
    expect(provider).not.toHaveBeenCalled();
    const quota = await store.getQuota('u1', '2026-09-15');
    expect(quota.userUsed).toBe(0);
    const { rows } = await pool.query(`SELECT 1 FROM parlay_xray_inflight WHERE user_id = 'u1'`);
    expect(rows).toHaveLength(0);
  });

  it('keeps quota after mocked provider failure and releases inflight', async () => {
    const store = createPostgresXrayStore(pool);
    const provider: XrayVisionProvider = vi.fn(async () => {
      throw new XrayProviderError('timeout', 'timeout');
    });
    const failed = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: pngVariant('a'), declaredMime: 'image/png' },
      {
        config: testConfig({ freeDailyLimit: 3, cooldownMs: 0, store: 'postgres' }),
        store,
        provider,
        now: () => new Date('2026-09-15T12:00:00.000Z'),
      }
    );
    expect(failed.result).toBe('PROVIDER_UNAVAILABLE');
    expect(failed.providerAttempted).toBe(true);
    expect(failed.quota.used).toBe(1);
    const inflight = await pool.query(`SELECT 1 FROM parlay_xray_inflight WHERE user_id = 'u1'`);
    expect(inflight.rows).toHaveLength(0);
    const usage = await pool.query<{ error_category: string; provider_attempted: boolean }>(
      `SELECT error_category, provider_attempted FROM parlay_xray_extraction_usage WHERE user_id = 'u1'`
    );
    expect(usage.rows[0]?.error_category).toBe('timeout');
    expect(usage.rows[0]?.provider_attempted).toBe(true);
  });

  it('does not retry 429 / 5xx / malformed mocks and stores no fake legs', async () => {
    const store = createPostgresXrayStore(pool);
    for (const category of ['rate_limited', 'provider_5xx', 'malformed_output'] as const) {
      await resetXrayGuardrailTables(pool);
      const provider: XrayVisionProvider = vi.fn(async () => {
        throw new XrayProviderError(category, category);
      });
      const result = await runXrayExtraction(
        { userId: 'u1', isPro: false, bytes: pngVariant(category), declaredMime: 'image/png' },
        {
          config: testConfig({ cooldownMs: 0, store: 'postgres' }),
          store,
          provider,
          now: () => new Date('2026-09-15T12:00:00.000Z'),
        }
      );
      expect(result.legs).toEqual([]);
      expect(provider).toHaveBeenCalledTimes(1);
      expect(result.providerAttempted).toBe(true);
    }
  });

  it('persists per-user inflight lock and allows a different user through', async () => {
    const store = createPostgresXrayStore(pool);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider: XrayVisionProvider = vi.fn(async () => {
      await gate;
      return {
        output: sampleVision(),
        requestId: 'held',
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
      };
    });
    const config = testConfig({ store: 'postgres' });
    const now = () => new Date('2026-09-15T12:00:00.000Z');
    const firstPromise = runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: pngVariant('a'), declaredMime: 'image/png' },
      { config, store, provider, now }
    );
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    const second = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: pngVariant('b'), declaredMime: 'image/png' },
      { config, store, provider, now }
    );
    expect(second.result).toBe('IN_FLIGHT');
    const other = await runXrayExtraction(
      { userId: 'u2', isPro: false, bytes: pngVariant('c'), declaredMime: 'image/png' },
      { config, store, provider: okProvider('other'), now }
    );
    expect(other.result).toBe('SUCCESS');
    release();
    expect((await firstPromise).result).toBe('SUCCESS');
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('recovers from an expired inflight lock', async () => {
    const store = createPostgresXrayStore(pool);
    await pool.query(
      `INSERT INTO parlay_xray_inflight (user_id, reservation_id, acquired_at, expires_at)
       VALUES ('u1', $1, now() - interval '10 minutes', now() - interval '1 minute')`,
      ['00000000-0000-0000-0000-000000000001']
    );
    const result = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      {
        config: testConfig({ store: 'postgres' }),
        store,
        provider: okProvider(),
        now: () => new Date(),
      }
    );
    expect(result.result).toBe('SUCCESS');
  });

  it('persists cooldown without blocking cache hits or other users', async () => {
    const store = createPostgresXrayStore(pool);
    const provider = okProvider();
    const now = new Date('2026-09-15T12:00:00.000Z');
    const config = testConfig({ cooldownMs: 45_000, store: 'postgres' });
    const first = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: pngVariant('a'), declaredMime: 'image/png' },
      { config, store, provider, now: () => now }
    );
    expect(first.result).toBe('SUCCESS');
    const cached = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: pngVariant('a'), declaredMime: 'image/png' },
      { config, store, provider, now: () => now }
    );
    expect(cached.cacheHit).toBe(true);
    expect(cached.providerAttempted).toBe(false);
    const cooled = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: pngVariant('b'), declaredMime: 'image/png' },
      { config, store, provider, now: () => now }
    );
    expect(cooled.result).toBe('RATE_LIMITED');
    const other = await runXrayExtraction(
      { userId: 'u2', isPro: false, bytes: pngVariant('b'), declaredMime: 'image/png' },
      { config, store, provider, now: () => now }
    );
    expect(other.result).toBe('SUCCESS');
    const later = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: pngVariant('b'), declaredMime: 'image/png' },
      { config, store, provider, now: () => new Date(now.getTime() + 46_000) }
    );
    expect(later.result).toBe('SUCCESS');
    expect(provider).toHaveBeenCalledTimes(3);
  });

  it('dedupes per user and does not share cache across users or versions', async () => {
    const store = createPostgresXrayStore(pool);
    const provider = okProvider();
    const now = () => new Date('2026-09-15T12:00:00.000Z');
    const v1 = testConfig({ store: 'postgres', extractionVersion: 'xray-extract-v1' });
    const first = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      { config: v1, store, provider, now }
    );
    const cached = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      { config: v1, store, provider, now }
    );
    expect(first.providerAttempted).toBe(true);
    expect(cached.cacheHit).toBe(true);
    const otherUser = await runXrayExtraction(
      { userId: 'u2', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      { config: v1, store, provider, now }
    );
    expect(otherUser.cacheHit).toBe(false);
    expect(otherUser.providerAttempted).toBe(true);
    const v2 = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      { config: testConfig({ store: 'postgres', extractionVersion: 'xray-extract-v2' }), store, provider, now }
    );
    expect(v2.cacheHit).toBe(false);
    expect(provider).toHaveBeenCalledTimes(3);

    const bytesCol = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'parlay_xray_dedupe' AND data_type = 'bytea'`
    );
    expect(bytesCol.rows).toHaveLength(0);
    const cachedRow = await pool.query<{ result_json: unknown }>(`SELECT result_json FROM parlay_xray_dedupe`);
    expect(JSON.stringify(cachedRow.rows)).not.toMatch(/iVBORw0KGgo/);
  });

  it('ignores expired dedupe rows and permits a new mocked extraction', async () => {
    const store = createPostgresXrayStore(pool);
    const provider = okProvider();
    const t0 = new Date('2026-09-15T12:00:00.000Z');
    const config = testConfig({ store: 'postgres', dedupeTtlMs: 1_000 });
    await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      { config, store, provider, now: () => t0 }
    );
    const expired = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      { config, store, provider, now: () => new Date(t0.getTime() + 2_000) }
    );
    expect(expired.cacheHit).toBe(false);
    expect(expired.providerAttempted).toBe(true);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('does not reserve on kill switch, missing key, or invalid files', async () => {
    const store = createPostgresXrayStore(pool);
    const provider = okProvider();
    const now = () => new Date('2026-09-15T12:00:00.000Z');
    await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      { config: testConfig({ enabled: false, store: 'postgres' }), store, provider, now }
    );
    await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      { config: testConfig({ openaiApiKey: null, store: 'postgres' }), store, provider, now }
    );
    await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: Buffer.from('%PDF-1.4'), declaredMime: 'application/pdf' },
      { config: testConfig({ store: 'postgres' }), store, provider, now }
    );
    expect(provider).not.toHaveBeenCalled();
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM parlay_xray_daily_counters`);
    expect(rows[0]?.n).toBe(0);
  });

  it('race A: one remaining user slot yields exactly one reservation', async () => {
    const store = createPostgresXrayStore(pool);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider: XrayVisionProvider = vi.fn(async () => {
      await gate;
      return {
        output: sampleVision(),
        requestId: 'race-a',
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
      };
    });
    const config = testConfig({ freeDailyLimit: 1, store: 'postgres' });
    const now = () => new Date('2026-09-15T12:00:00.000Z');
    const firstPromise = runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: pngVariant('a'), declaredMime: 'image/png' },
      { config, store, provider, now }
    );
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    const second = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: pngVariant('b'), declaredMime: 'image/png' },
      { config, store, provider, now }
    );
    expect(['IN_FLIGHT', 'USER_QUOTA_EXCEEDED']).toContain(second.result);
    release();
    expect((await firstPromise).result).toBe('SUCCESS');
    expect(provider).toHaveBeenCalledTimes(1);
    const { rows } = await pool.query<{ count: number }>(
      `SELECT count FROM parlay_xray_daily_counters WHERE scope = 'user:u1'`
    );
    expect(rows[0]?.count).toBe(1);
  });

  it('race C/D: duplicate image and two different images do not double-call the mocked provider', async () => {
    const store = createPostgresXrayStore(pool);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider: XrayVisionProvider = vi.fn(async () => {
      await gate;
      return {
        output: sampleVision(),
        requestId: 'race-cd',
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
      };
    });
    const config = testConfig({ store: 'postgres' });
    const now = () => new Date('2026-09-15T12:00:00.000Z');
    const dup = Promise.all([
      runXrayExtraction(
        { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
        { config, store, provider, now }
      ),
      runXrayExtraction(
        { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
        { config, store, provider, now }
      ),
    ]);
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    release();
    const [x, y] = await dup;
    const providerCalls = [x, y].filter((r) => r.providerAttempted);
    expect(providerCalls).toHaveLength(1);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('persists usage metadata without screenshot bytes or full slip dumps', async () => {
    const store = createPostgresXrayStore(pool);
    await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      {
        config: testConfig({ store: 'postgres' }),
        store,
        provider: okProvider('usage-1'),
        now: () => new Date('2026-09-15T12:00:00.000Z'),
      }
    );
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT user_id, created_at, extraction_version, schema_version, model, image_hash,
              original_width, original_height, original_bytes,
              normalized_width, normalized_height, normalized_bytes,
              cache_hit, provider_attempted, success, latency_ms, provider_request_id,
              prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, error_category
       FROM parlay_xray_extraction_usage`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe('u1');
    expect(rows[0]?.extraction_version).toBe('xray-extract-v2.1');
    expect(rows[0]?.schema_version).toBe('xray-legs-v2');
    expect(rows[0]?.model).toBe('gpt-4o-mini');
    expect(String(rows[0]?.image_hash)).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[0]?.provider_attempted).toBe(true);
    expect(rows[0]?.provider_request_id).toBe('usage-1');
    expect(rows[0]?.prompt_tokens).toBe(80);
    expect(rows[0]?.estimated_cost_usd).not.toBeNull();
    const payload = JSON.stringify(rows);
    expect(payload).not.toMatch(/iVBORw0KGgo/);
    expect(payload).not.toMatch(/Luka Doncic/);
    expect(Object.keys(rows[0] ?? {})).not.toContain('result_json');
  });
});
