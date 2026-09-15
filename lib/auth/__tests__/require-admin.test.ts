import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_FORBIDDEN_BODY, requireAdminAuth } from '@/lib/auth/require-admin';
import { BETTING_UNAUTHORIZED_BODY } from '@/lib/auth/require-betting-auth';

const requireBettingAuth = vi.fn();

vi.mock('@/lib/auth/require-betting-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/require-betting-auth')>(
    '@/lib/auth/require-betting-auth'
  );
  return {
    ...actual,
    requireBettingAuth: (...args: unknown[]) => requireBettingAuth(...args),
  };
});

function makeRequest(url = 'http://localhost/api/admin/model-lab/experiments'): NextRequest {
  return new NextRequest(url);
}

describe('requireAdminAuth', () => {
  beforeEach(() => {
    requireBettingAuth.mockReset();
    vi.unstubAllEnvs();
    delete process.env.ADMIN_EMAILS;
  });

  it('rejects unauthenticated requests with 401', async () => {
    requireBettingAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json(BETTING_UNAUTHORIZED_BODY, { status: 401 }),
    });

    const result = await requireAdminAuth(makeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
  });

  it('rejects authenticated non-admins with 403 when allowlist is set', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
    requireBettingAuth.mockResolvedValue({
      ok: true,
      auth: { userId: 'u1', email: 'other@example.com', accessToken: 't' },
      withAuthCookies: (r: NextResponse) => r,
    });

    const result = await requireAdminAuth(makeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    await expect(result.response.json()).resolves.toEqual(ADMIN_FORBIDDEN_BODY);
  });

  it('fails closed when ADMIN_EMAILS is empty', async () => {
    vi.stubEnv('ADMIN_EMAILS', '');
    requireBettingAuth.mockResolvedValue({
      ok: true,
      auth: { userId: 'u1', email: 'owner@example.com', accessToken: 't' },
      withAuthCookies: (r: NextResponse) => r,
    });

    const result = await requireAdminAuth(makeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
  });

  it('admits an allowlisted email', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
    const withAuthCookies = (r: NextResponse) => r;
    requireBettingAuth.mockResolvedValue({
      ok: true,
      auth: { userId: 'u1', email: 'Owner@example.com', accessToken: 't' },
      withAuthCookies,
    });

    const result = await requireAdminAuth(makeRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.auth.userId).toBe('u1');
    expect(result.withAuthCookies).toBe(withAuthCookies);
  });
});
