import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_FORBIDDEN_BODY } from '@/lib/auth/require-admin';

const requireBettingAuth = vi.fn();
const openWebsiteCurrentBoardStore = vi.fn();

vi.mock('@/lib/auth/require-betting-auth', () => ({
  requireBettingAuth: (...args: unknown[]) => requireBettingAuth(...args),
}));

vi.mock('@/lib/props/s3-current-board/website-store', () => ({
  openWebsiteCurrentBoardStore: (...args: unknown[]) => openWebsiteCurrentBoardStore(...args),
}));

import { GET } from '@/app/api/admin/current-board-diagnostic/route';

function authed(email: string) {
  return {
    ok: true as const,
    auth: { userId: 'u1', email, accessToken: 't' },
    withAuthCookies: (response: NextResponse) => response,
  };
}

describe('GET /api/admin/current-board-diagnostic', () => {
  beforeEach(() => {
    requireBettingAuth.mockReset();
    openWebsiteCurrentBoardStore.mockReset();
    vi.unstubAllEnvs();
    delete process.env.ADMIN_EMAILS;
    delete process.env.CURRENT_PROPS_SOURCE;
  });

  it('returns 401 and does not open S3 for an unauthenticated request', async () => {
    requireBettingAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await GET(new NextRequest('http://localhost/api/admin/current-board-diagnostic?game_id=21718182'));
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(openWebsiteCurrentBoardStore).not.toHaveBeenCalled();
  });

  it('returns 403 and does not open S3 for a non-admin', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
    requireBettingAuth.mockResolvedValue(authed('other@example.com'));
    const res = await GET(new NextRequest('http://localhost/api/admin/current-board-diagnostic?game_id=21718182'));
    expect(res.status).toBe(403);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(openWebsiteCurrentBoardStore).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual(ADMIN_FORBIDDEN_BODY);
  });

  it('rejects every game except 21718182 before opening S3', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
    requireBettingAuth.mockResolvedValue(authed('owner@example.com'));
    for (const gameId of ['../pointer', '21718181']) {
      const res = await GET(new NextRequest(`http://localhost/api/admin/current-board-diagnostic?game_id=${gameId}`));
      expect(res.status).toBe(400);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(openWebsiteCurrentBoardStore).not.toHaveBeenCalled();
  });

  it('returns only a sanitized failure class when the production store cannot open', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
    requireBettingAuth.mockResolvedValue(authed('owner@example.com'));
    openWebsiteCurrentBoardStore.mockImplementation(() => {
      throw Object.assign(new Error('eyJraw-token raw/source=balldontlie/secret'), { name: 'CredentialsProviderError' });
    });
    const res = await GET(new NextRequest('http://localhost/api/admin/current-board-diagnostic?game_id=21718182'));
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = await res.json();
    expect(body).toEqual({ error: 'unavailable', failure: 'CredentialsProviderError' });
    expect(JSON.stringify(body)).not.toMatch(/eyJ|raw\/source/);
  });
});
