import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { freeEntitlement } from '@/lib/entitlements/resolve';
import { createMemoryXrayStore } from '@/lib/parlay-xray/extraction/memory-store';
import { resetXrayExtractionRuntimeForTests, setXrayExtractionRuntimeForTests } from '@/lib/parlay-xray/extraction/runtime';
import type { XrayVisionProvider } from '@/lib/parlay-xray/extraction/provider';
import { MIN_PNG, sampleVision, testConfig } from '@/lib/parlay-xray/extraction/__tests__/fixtures';

const requireBettingAuth = vi.fn();
const getUserEntitlements = vi.fn();

vi.mock('@/lib/auth/require-betting-auth', () => ({
  requireBettingAuth: (...args: unknown[]) => requireBettingAuth(...args),
}));

vi.mock('@/lib/entitlements/queries', () => ({
  getUserEntitlements: (...args: unknown[]) => getUserEntitlements(...args),
}));

import { POST } from '@/app/api/parlay-xray/extract/route';
import { GET as quotaGet } from '@/app/api/parlay-xray/quota/route';

const USER_A = '11111111-1111-1111-1111-111111111111';

function authed() {
  return {
    ok: true as const,
    auth: { userId: USER_A, email: 'a@example.com', accessToken: 't' },
    withAuthCookies: (r: NextResponse) => r,
  };
}

function pngRequest(): NextRequest {
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(MIN_PNG)], { type: 'image/png' }), 'slip.png');
  return new NextRequest('http://localhost/api/parlay-xray/extract', { method: 'POST', body: form });
}

describe('POST /api/parlay-xray/extract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetXrayExtractionRuntimeForTests();
    getUserEntitlements.mockResolvedValue(freeEntitlement());
  });

  it('returns AUTH_REQUIRED without calling the provider', async () => {
    const provider: XrayVisionProvider = vi.fn(async () => {
      throw new Error('should not run');
    });
    setXrayExtractionRuntimeForTests({
      config: testConfig(),
      store: createMemoryXrayStore(),
      provider,
    });
    requireBettingAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await POST(pngRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.result).toBe('AUTH_REQUIRED');
    expect(provider).not.toHaveBeenCalled();
  });

  it('returns EXTRACTION_DISABLED when the kill switch is off', async () => {
    const provider: XrayVisionProvider = vi.fn(async () => {
      throw new Error('should not run');
    });
    setXrayExtractionRuntimeForTests({
      config: testConfig({ enabled: false }),
      store: createMemoryXrayStore(),
      provider,
    });
    requireBettingAuth.mockResolvedValue(authed());
    const res = await POST(pngRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.result).toBe('EXTRACTION_DISABLED');
    expect(body.message).toMatch(/temporarily unavailable/i);
    expect(body.providerAttempted).toBe(false);
    expect(provider).not.toHaveBeenCalled();
  });

  it('extracts once when enabled and authorized', async () => {
    const provider: XrayVisionProvider = vi.fn(async () => ({
      output: sampleVision(),
      requestId: 'req-1',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    }));
    setXrayExtractionRuntimeForTests({
      config: testConfig({ enabled: true }),
      store: createMemoryXrayStore(),
      provider,
    });
    requireBettingAuth.mockResolvedValue(authed());
    const res = await POST(pngRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe('SUCCESS');
    expect(body.legs).toHaveLength(1);
    expect(provider).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/parlay-xray/quota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetXrayExtractionRuntimeForTests();
  });

  it('does not call the provider', async () => {
    const provider: XrayVisionProvider = vi.fn(async () => {
      throw new Error('should not run');
    });
    setXrayExtractionRuntimeForTests({
      config: testConfig({ enabled: false }),
      store: createMemoryXrayStore(),
      provider,
    });
    requireBettingAuth.mockResolvedValue(authed());
    getUserEntitlements.mockResolvedValue(freeEntitlement());
    const res = await quotaGet(new NextRequest('http://localhost/api/parlay-xray/quota'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quota.limit).toBe(3);
    expect(body.quota.remaining).toBe(3);
    expect(provider).not.toHaveBeenCalled();
  });
});
