import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  isBettingHtmlPath,
  isOpsHtmlPath,
  isSessionProtectedHtmlPath,
  isSupabaseBrowserAuthConfigured,
  updateSession,
} from '@/lib/supabase/middleware';

const getUser = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: (...args: unknown[]) => getUser(...args),
    },
  })),
}));

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

describe('isBettingHtmlPath', () => {
  it('matches betting pages only', () => {
    expect(isBettingHtmlPath('/betting')).toBe(true);
    expect(isBettingHtmlPath('/betting/props-explorer')).toBe(true);
    expect(isBettingHtmlPath('/api/betting/games')).toBe(false);
    expect(isBettingHtmlPath('/login')).toBe(false);
  });
});

describe('ops HTML protection', () => {
  it('matches /ops pages and not the JSON API', () => {
    expect(isOpsHtmlPath('/ops')).toBe(true);
    expect(isOpsHtmlPath('/ops/')).toBe(true);
    expect(isSessionProtectedHtmlPath('/ops')).toBe(true);
    expect(isBettingHtmlPath('/ops')).toBe(false);
    expect(isOpsHtmlPath('/api/ops/health')).toBe(false);
  });
});

describe('isSupabaseBrowserAuthConfigured', () => {
  it('is false when url or anon key is missing', () => {
    expect(isSupabaseBrowserAuthConfigured({})).toBe(false);
    expect(
      isSupabaseBrowserAuthConfigured({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' })
    ).toBe(false);
    expect(
      isSupabaseBrowserAuthConfigured({
        NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      })
    ).toBe(true);
  });
});

describe('updateSession', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    getUser.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('redirects betting HTML to login when public auth config is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const response = await updateSession(makeRequest('/betting/props-explorer'));
    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('/login');
    expect(location).toContain('error=auth_config');
    expect(getUser).not.toHaveBeenCalled();
  });

  it('does not redirect API betting routes when public auth config is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const response = await updateSession(makeRequest('/api/betting/games'));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('redirects unauthenticated betting HTML when auth config is present', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    getUser.mockResolvedValue({ data: { user: null } });

    const response = await updateSession(makeRequest('/betting'));
    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('/login');
    expect(location).not.toContain('error=auth_config');
  });

  it('redirects unauthenticated /ops HTML when auth config is present', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    getUser.mockResolvedValue({ data: { user: null } });

    const response = await updateSession(makeRequest('/ops'));
    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('/login');
    expect(location).toContain('next=%2Fops');
  });

  it('does not redirect /api/ops when public auth config is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const response = await updateSession(makeRequest('/api/ops/health'));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('allows authenticated betting HTML when auth config is present', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    const response = await updateSession(makeRequest('/betting'));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });
});
