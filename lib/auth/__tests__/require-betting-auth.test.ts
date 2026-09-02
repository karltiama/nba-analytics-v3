import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  BETTING_UNAUTHORIZED_BODY,
  requireBettingAuth,
} from '@/lib/auth/require-betting-auth';

const resolveSupabaseAuth = vi.fn();

vi.mock('@/lib/auth/supabase-user', () => ({
  resolveSupabaseAuth: (...args: unknown[]) => resolveSupabaseAuth(...args),
}));

function makeRequest(url = 'http://localhost/api/betting/insights'): NextRequest {
  return new NextRequest(url);
}

describe('requireBettingAuth', () => {
  beforeEach(() => {
    resolveSupabaseAuth.mockReset();
  });

  it('rejects unauthenticated requests with 401 JSON', async () => {
    resolveSupabaseAuth.mockResolvedValue({ ok: false });

    const result = await requireBettingAuth(makeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.response.status).toBe(401);
    await expect(result.response.json()).resolves.toEqual(BETTING_UNAUTHORIZED_BODY);
  });

  it('accepts authenticated requests and exposes auth context', async () => {
    const withAuthCookies = (r: NextResponse) => r;
    resolveSupabaseAuth.mockResolvedValue({
      ok: true,
      auth: {
        userId: 'user-123',
        email: 'user@example.com',
        accessToken: 'token',
      },
      withAuthCookies,
    });

    const result = await requireBettingAuth(makeRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.auth.userId).toBe('user-123');
    expect(result.auth.email).toBe('user@example.com');
    expect(result.withAuthCookies).toBe(withAuthCookies);
  });

  it('fails closed when the auth helper throws', async () => {
    resolveSupabaseAuth.mockRejectedValue(new Error('missing supabase env'));

    const result = await requireBettingAuth(makeRequest());
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.response.status).toBe(401);
    await expect(result.response.json()).resolves.toEqual(BETTING_UNAUTHORIZED_BODY);
  });
});
