import { describe, expect, it, vi } from 'vitest';
import { createMemoryXrayStore } from '../memory-store';
import { runXrayExtraction } from '../pipeline';
import { XrayProviderError, type XrayVisionProvider } from '../provider';
import { MIN_PNG, boxScoreVision, pngVariant, sampleVision, testConfig } from './fixtures';

function okProvider() {
  return vi.fn(async () => ({
    output: sampleVision(),
    requestId: 'req-1',
    promptTokens: 120,
    completionTokens: 40,
    totalTokens: 160,
  }));
}

describe('xray extraction pre-provider guarantees', () => {
  it('does not call the provider when the kill switch is off', async () => {
    const provider = okProvider();
    const store = createMemoryXrayStore();
    const result = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      { config: testConfig({ enabled: false }), store, provider }
    );
    expect(result.result).toBe('EXTRACTION_DISABLED');
    expect(provider).not.toHaveBeenCalled();
    expect(result.providerAttempted).toBe(false);
    expect((await store.getQuota('u1', '2026-09-15')).userUsed).toBe(0);
  });

  it('does not call the provider when no API key is configured', async () => {
    const provider = okProvider();
    const result = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      { config: testConfig({ openaiApiKey: null }), store: createMemoryXrayStore(), provider }
    );
    expect(result.result).toBe('PROVIDER_UNAVAILABLE');
    expect(provider).not.toHaveBeenCalled();
    expect(result.providerAttempted).toBe(false);
  });

  it('releases reservation and quota when an internal error happens before the provider', async () => {
    const provider = okProvider();
    const store = createMemoryXrayStore();
    const result = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      {
        config: testConfig({ freeDailyLimit: 1 }),
        store,
        provider,
        beforeProvider: () => {
          throw new Error('boom-before-provider');
        },
      }
    );
    expect(result.result).toBe('INTERNAL_ERROR');
    expect(provider).not.toHaveBeenCalled();
    expect(result.providerAttempted).toBe(false);
    expect(result.quota.used).toBe(0);
  });

  it('does not call the provider for invalid MIME / pdf', async () => {
    const provider = okProvider();
    const result = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: Buffer.from('%PDF-1.4 hello'), declaredMime: 'application/pdf' },
      { config: testConfig(), store: createMemoryXrayStore(), provider }
    );
    expect(result.result).toBe('UNREADABLE_IMAGE');
    expect(provider).not.toHaveBeenCalled();
  });

  it('does not call the provider for oversized files', async () => {
    const provider = okProvider();
    const result = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: Buffer.alloc(80), declaredMime: 'image/png' },
      { config: testConfig({ maxUploadBytes: 40 }), store: createMemoryXrayStore(), provider }
    );
    expect(result.result).toBe('UNREADABLE_IMAGE');
    expect(provider).not.toHaveBeenCalled();
  });

  it('does not call the provider for corrupt image bytes', async () => {
    const provider = okProvider();
    const result = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: Buffer.from('not-an-image'), declaredMime: 'image/png' },
      { config: testConfig(), store: createMemoryXrayStore(), provider }
    );
    expect(result.result).toBe('UNREADABLE_IMAGE');
    expect(provider).not.toHaveBeenCalled();
  });

  it('does not call the provider when the user daily quota is exhausted', async () => {
    const provider = okProvider();
    const store = createMemoryXrayStore();
    const config = testConfig({ freeDailyLimit: 1 });
    const first = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: pngVariant('a'), declaredMime: 'image/png' },
      { config, store, provider }
    );
    expect(first.result).toBe('SUCCESS');
    const second = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: pngVariant('b'), declaredMime: 'image/png' },
      { config, store, provider }
    );
    expect(second.result).toBe('USER_QUOTA_EXCEEDED');
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('does not call the provider when the global cap is exhausted', async () => {
    const provider = okProvider();
    const store = createMemoryXrayStore();
    const config = testConfig({ globalDailyLimit: 1 });
    await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: pngVariant('a'), declaredMime: 'image/png' },
      { config, store, provider }
    );
    const second = await runXrayExtraction(
      { userId: 'u2', isPro: true, bytes: pngVariant('b'), declaredMime: 'image/png' },
      { config, store, provider }
    );
    expect(second.result).toBe('GLOBAL_QUOTA_EXCEEDED');
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('rejects a second in-flight extraction for the same user', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider: XrayVisionProvider = vi.fn(async () => {
      await gate;
      return {
        output: sampleVision(),
        requestId: 'req-1',
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
      };
    });
    const store = createMemoryXrayStore();
    const config = testConfig();
    const firstPromise = runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: pngVariant('a'), declaredMime: 'image/png' },
      { config, store, provider }
    );
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
    const second = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: pngVariant('b'), declaredMime: 'image/png' },
      { config, store, provider }
    );
    expect(second.result).toBe('IN_FLIGHT');
    expect(provider).toHaveBeenCalledTimes(1);
    release();
    const first = await firstPromise;
    expect(first.result).toBe('SUCCESS');
  });

  it('applies cooldown to a new image but not to a cache hit', async () => {
    const provider = okProvider();
    const store = createMemoryXrayStore();
    const now = new Date('2026-09-15T12:00:00.000Z');
    const config = testConfig({ cooldownMs: 45_000 });
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
    const cooled = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: pngVariant('b'), declaredMime: 'image/png' },
      { config, store, provider, now: () => now }
    );
    expect(cooled.result).toBe('RATE_LIMITED');
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('returns a cached result without a second provider call or quota increment', async () => {
    const provider = okProvider();
    const store = createMemoryXrayStore();
    const config = testConfig({ freeDailyLimit: 3 });
    const req = { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' as const };
    const first = await runXrayExtraction(req, { config, store, provider });
    const second = await runXrayExtraction(req, { config, store, provider });
    expect(first.providerAttempted).toBe(true);
    expect(second.cacheHit).toBe(true);
    expect(second.providerAttempted).toBe(false);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(first.quota.used).toBe(1);
    expect(second.quota.used).toBe(1);
  });
});

describe('xray paid-call boundary', () => {
  it('invokes the provider exactly once for a valid uncached authorized request', async () => {
    const provider = okProvider();
    const result = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      { config: testConfig(), store: createMemoryXrayStore(), provider }
    );
    expect(result.result).toBe('SUCCESS');
    expect(result.legs).toHaveLength(1);
    expect(result.legs[0]?.playerId.status).toBe('unknown');
    expect(provider).toHaveBeenCalledTimes(1);
    const callArg = provider.mock.calls.at(0)?.at(0) as { detail?: string; model?: string } | undefined;
    expect(callArg?.detail).toBe('low');
    expect(callArg?.model).toBe('gpt-4o-mini');
  });
});

describe('xray provider failure accounting', () => {
  it('does not retry, keeps quota after an attempted call, releases inflight, and returns no fake legs', async () => {
    const provider: XrayVisionProvider = vi.fn(async () => {
      throw new XrayProviderError('timeout', 'timeout');
    });
    const store = createMemoryXrayStore();
    const config = testConfig({ freeDailyLimit: 3, cooldownMs: 0 });
    const failed = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: pngVariant('a'), declaredMime: 'image/png' },
      { config, store, provider }
    );
    expect(failed.result).toBe('PROVIDER_UNAVAILABLE');
    expect(failed.legs).toEqual([]);
    expect(failed.providerAttempted).toBe(true);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(failed.quota.used).toBe(1);
    expect(store.usage[0]?.errorCategory).toBe('timeout');

    const recovered = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: pngVariant('b'), declaredMime: 'image/png' },
      {
        config,
        store,
        provider: okProvider(),
      }
    );
    expect(recovered.result).toBe('SUCCESS');
    expect(recovered.quota.used).toBe(2);
  });

  it('treats malformed structured output as a failed paid attempt with no invented legs', async () => {
    const provider: XrayVisionProvider = vi.fn(async () => {
      throw new XrayProviderError('malformed_output', 'schema_mismatch');
    });
    const result = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      { config: testConfig(), store: createMemoryXrayStore(), provider }
    );
    expect(result.result).toBe('PROVIDER_UNAVAILABLE');
    expect(result.legs).toEqual([]);
    expect(provider).toHaveBeenCalledTimes(1);
  });
});

describe('xray dedupe privacy and races', () => {
  it('does not share cached legs across users with the same image hash', async () => {
    const provider = okProvider();
    const store = createMemoryXrayStore();
    const config = testConfig();
    await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      { config, store, provider }
    );
    await runXrayExtraction(
      { userId: 'u2', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      { config, store, provider }
    );
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('allows only one of two parallel requests to call the provider when one quota slot remains', async () => {
    const provider = okProvider();
    const store = createMemoryXrayStore();
    const config = testConfig({ freeDailyLimit: 1, globalDailyLimit: 100 });
    const [a, b] = await Promise.all([
      runXrayExtraction(
        { userId: 'u1', isPro: false, bytes: pngVariant('a'), declaredMime: 'image/png' },
        { config, store, provider }
      ),
      runXrayExtraction(
        { userId: 'u1', isPro: false, bytes: pngVariant('b'), declaredMime: 'image/png' },
        { config, store, provider }
      ),
    ]);
    const results = [a.result, b.result];
    expect(results).toContain('SUCCESS');
    expect(results.some((r) => r === 'IN_FLIGHT' || r === 'USER_QUOTA_EXCEEDED')).toBe(true);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('allows only one of two parallel users to consume the last global slot', async () => {
    const provider = okProvider();
    const store = createMemoryXrayStore();
    const config = testConfig({ globalDailyLimit: 1 });
    const [a, b] = await Promise.all([
      runXrayExtraction(
        { userId: 'u1', isPro: false, bytes: pngVariant('a'), declaredMime: 'image/png' },
        { config, store, provider }
      ),
      runXrayExtraction(
        { userId: 'u2', isPro: false, bytes: pngVariant('b'), declaredMime: 'image/png' },
        { config, store, provider }
      ),
    ]);
    const spent = [a, b].filter((r) => r.providerAttempted);
    const blocked = [a, b].filter((r) => r.result === 'GLOBAL_QUOTA_EXCEEDED' || r.result === 'IN_FLIGHT');
    expect(spent).toHaveLength(1);
    expect(blocked).toHaveLength(1);
    expect(provider).toHaveBeenCalledTimes(1);
  });
});

describe('xray extraction v2 refusal and version isolation', () => {
  it('maps a box-score provider payload to NO_LEGS_FOUND with zero legs after one attempt', async () => {
    const provider = vi.fn(async () => ({
      output: boxScoreVision(),
      requestId: 'box-1',
      promptTokens: 10,
      completionTokens: 10,
      totalTokens: 20,
    }));
    const result = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      { config: testConfig(), store: createMemoryXrayStore(), provider }
    );
    expect(result.result).toBe('NO_LEGS_FOUND');
    expect(result.legs).toEqual([]);
    expect(result.message).toMatch(/betting slip/i);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.providerAttempted).toBe(true);
  });

  it('does not reuse xray-extract-v1 cache after the v2 version bump', async () => {
    const store = createMemoryXrayStore();
    const v1Provider = okProvider();
    const first = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      { config: testConfig({ extractionVersion: 'xray-extract-v1', schemaVersion: 'xray-legs-v1' }), store, provider: v1Provider }
    );
    expect(first.result).toBe('SUCCESS');
    const v2Provider = vi.fn(async () => ({
      output: boxScoreVision(),
      requestId: 'v2',
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
    }));
    const second = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      { config: testConfig({ extractionVersion: 'xray-extract-v2', schemaVersion: 'xray-legs-v2' }), store, provider: v2Provider }
    );
    expect(second.cacheHit).toBe(false);
    expect(v1Provider).toHaveBeenCalledTimes(1);
    expect(v2Provider).toHaveBeenCalledTimes(1);
    expect(second.result).toBe('NO_LEGS_FOUND');
    expect(second.legs).toEqual([]);
  });

  it('does not reuse xray-extract-v2 cache after the v2.1 market-identity bump', async () => {
    const store = createMemoryXrayStore();
    const v2Provider = okProvider();
    await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      { config: testConfig({ extractionVersion: 'xray-extract-v2', schemaVersion: 'xray-legs-v2' }), store, provider: v2Provider }
    );
    const v21Provider = okProvider();
    const second = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      { config: testConfig({ extractionVersion: 'xray-extract-v2.1', schemaVersion: 'xray-legs-v2' }), store, provider: v21Provider }
    );
    expect(second.cacheHit).toBe(false);
    expect(v2Provider).toHaveBeenCalledTimes(1);
    expect(v21Provider).toHaveBeenCalledTimes(1);
  });

  it('treats unsupported document_type as a failed attempt with no invented legs', async () => {
    const provider: XrayVisionProvider = vi.fn(async () => ({
      output: { ...sampleVision(), document_type: 'BOX_SCORE' },
      requestId: 'bad',
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
    } as Awaited<ReturnType<XrayVisionProvider>>));
    const result = await runXrayExtraction(
      { userId: 'u1', isPro: false, bytes: MIN_PNG, declaredMime: 'image/png' },
      { config: testConfig(), store: createMemoryXrayStore(), provider }
    );
    expect(result.result).toBe('PROVIDER_UNAVAILABLE');
    expect(result.legs).toEqual([]);
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
