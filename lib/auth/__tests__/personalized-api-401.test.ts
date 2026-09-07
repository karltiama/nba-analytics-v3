import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const resolveSupabaseAuth = vi.fn();

vi.mock('@/lib/auth/supabase-user', () => ({
  resolveSupabaseAuth: (...args: unknown[]) => resolveSupabaseAuth(...args),
}));

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { DELETE, GET, POST } from '@/app/api/user/saved-props/route';
import { GET as GET_PROFILE } from '@/app/api/user/profile/route';
import { GET as GET_SETTINGS } from '@/app/api/user/settings/route';

describe('personalized APIs unauthenticated → 401 JSON', () => {
  beforeEach(() => {
    resolveSupabaseAuth.mockReset();
    resolveSupabaseAuth.mockResolvedValue({ ok: false });
  });

  it('saved-props GET/POST/DELETE', async () => {
    const getRes = await GET(new NextRequest('http://localhost/api/user/saved-props'));
    const postRes = await POST(
      new NextRequest('http://localhost/api/user/saved-props', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    );
    const delRes = await DELETE(
      new NextRequest('http://localhost/api/user/saved-props?id=x', { method: 'DELETE' })
    );
    expect(getRes.status).toBe(401);
    expect(postRes.status).toBe(401);
    expect(delRes.status).toBe(401);
    await expect(getRes.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('profile and settings GET', async () => {
    const profile = await GET_PROFILE(new NextRequest('http://localhost/api/user/profile'));
    const settings = await GET_SETTINGS(new NextRequest('http://localhost/api/user/settings'));
    expect(profile.status).toBe(401);
    expect(settings.status).toBe(401);
  });
});
