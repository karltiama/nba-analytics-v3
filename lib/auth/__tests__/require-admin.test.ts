import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_FORBIDDEN_BODY, requireAdminAuth, requireAdminPage } from '@/lib/auth/require-admin';
import { BETTING_UNAUTHORIZED_BODY } from '@/lib/auth/require-betting-auth';

const { getUser, clientState } = vi.hoisted(() => ({
  getUser: vi.fn(),
  clientState: { throwOnCreate: false },
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    if (clientState.throwOnCreate) {
      throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
    }
    return { auth: { getUser } };
  },
}));

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
    getUser.mockReset();
    clientState.throwOnCreate = false;
    vi.unstubAllEnvs();
    delete process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_EMAIL;
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

describe('requireAdminPage', () => {
  beforeEach(() => {
    getUser.mockReset();
    clientState.throwOnCreate = false;
    vi.unstubAllEnvs();
    delete process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_EMAIL;
  });

  it('treats a missing session as signed out', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(requireAdminPage()).resolves.toEqual({
      ok: false,
      reason: 'unauthenticated',
      email: null,
    });
  });

  it('fails closed when the session client cannot be created', async () => {
    clientState.throwOnCreate = true;
    await expect(requireAdminPage()).resolves.toEqual({
      ok: false,
      reason: 'unauthenticated',
      email: null,
    });
  });

  it('fails closed when the allowlist is empty', async () => {
    vi.stubEnv('ADMIN_EMAILS', '');
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'owner@example.com' } } });
    await expect(requireAdminPage()).resolves.toEqual({
      ok: false,
      reason: 'allowlist_empty',
      email: 'owner@example.com',
    });
  });

  it('rejects a signed-in email that is not allowlisted', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'other@example.com' } } });
    await expect(requireAdminPage()).resolves.toEqual({
      ok: false,
      reason: 'forbidden',
      email: 'other@example.com',
    });
  });

  it('admits an allowlisted email', async () => {
    vi.stubEnv('ADMIN_EMAIL', 'owner@example.com');
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'Owner@example.com' } } });
    await expect(requireAdminPage()).resolves.toEqual({
      ok: true,
      userId: 'u1',
      email: 'Owner@example.com',
    });
  });
});
