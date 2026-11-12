import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_FORBIDDEN_BODY } from '@/lib/auth/require-admin';

const requireBettingAuth = vi.fn();
const getCachedPlatformHealth = vi.fn();

vi.mock('@/lib/auth/require-betting-auth', () => ({
  requireBettingAuth: (...args: unknown[]) => requireBettingAuth(...args),
}));

vi.mock('@/lib/ops/platform-health', () => ({
  getCachedPlatformHealth: (...args: unknown[]) => getCachedPlatformHealth(...args),
}));

import { GET } from '@/app/api/ops/health/route';

function authed(email: string) {
  return {
    ok: true as const,
    auth: { userId: 'u1', email, accessToken: 't' },
    withAuthCookies: (response: NextResponse) => response,
  };
}

describe('GET /api/ops/health', () => {
  beforeEach(() => {
    requireBettingAuth.mockReset();
    getCachedPlatformHealth.mockReset();
    vi.unstubAllEnvs();
    delete process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_EMAIL;
  });

  it('returns 401 for unauthenticated requests and does not query health', async () => {
    requireBettingAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await GET(new NextRequest('http://localhost/api/ops/health'));
    expect(res.status).toBe(401);
    expect(getCachedPlatformHealth).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('returns 403 for a signed-in non-admin and does not query health', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
    requireBettingAuth.mockResolvedValue(authed('other@example.com'));
    const res = await GET(new NextRequest('http://localhost/api/ops/health'));
    expect(res.status).toBe(403);
    expect(getCachedPlatformHealth).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual(ADMIN_FORBIDDEN_BODY);
  });

  it('fails closed when the allowlist is empty or invalid', async () => {
    vi.stubEnv('ADMIN_EMAILS', ' , , ');
    requireBettingAuth.mockResolvedValue(authed('owner@example.com'));
    const res = await GET(new NextRequest('http://localhost/api/ops/health'));
    expect(res.status).toBe(403);
    expect(getCachedPlatformHealth).not.toHaveBeenCalled();
  });

  it('returns the report for an allowlisted admin', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
    requireBettingAuth.mockResolvedValue(authed('Owner@example.com'));
    getCachedPlatformHealth.mockResolvedValue({ overall: 'UNKNOWN' });
    const res = await GET(new NextRequest('http://localhost/api/ops/health'));
    expect(res.status).toBe(200);
    expect(getCachedPlatformHealth).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toEqual({ overall: 'UNKNOWN' });
  });
});
