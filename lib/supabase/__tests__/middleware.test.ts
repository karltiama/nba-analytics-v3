import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  isBettingHtmlPath,
  isOpsHtmlPath,
  isBillingHtmlPath,
  isAdminHtmlPath,
  isSessionProtectedHtmlPath,
  isSupabaseBrowserAuthConfigured,
  updateSession,
} from '@/lib/supabase/middleware';

const ROOT = join(__dirname, '../../..');

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

describe('proxy matcher', () => {
  it('refreshes cookies on /, /login, and /signup without treating them as auth-gated', () => {
    const src = readFileSync(join(ROOT, 'proxy.ts'), 'utf8');
    expect(src).toContain("'/'");
    expect(src).toContain("'/login'");
    expect(src).toContain("'/signup'");
    expect(src).toContain("'/admin'");
    expect(src).toContain("'/api/admin/:path*'");
    expect(isSessionProtectedHtmlPath('/')).toBe(false);
    expect(isSessionProtectedHtmlPath('/login')).toBe(false);
    expect(isSessionProtectedHtmlPath('/signup')).toBe(false);
  });
});

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

describe('admin HTML protection', () => {
  it('matches /admin pages and not the JSON API', () => {
    expect(isAdminHtmlPath('/admin')).toBe(true);
    expect(isAdminHtmlPath('/admin/model-lab')).toBe(true);
    expect(isAdminHtmlPath('/admin/product-preview')).toBe(true);
    expect(isSessionProtectedHtmlPath('/admin/model-lab')).toBe(true);
    expect(isSessionProtectedHtmlPath('/admin/product-preview')).toBe(true);
    expect(isAdminHtmlPath('/api/admin/model-lab/experiments')).toBe(false);
  });
});

describe('billing HTML protection', () => {
  it('matches /billing pages and not the JSON API', () => {
    expect(isBillingHtmlPath('/billing')).toBe(true);
    expect(isBillingHtmlPath('/billing/success')).toBe(true);
    expect(isSessionProtectedHtmlPath('/billing')).toBe(true);
    expect(isBillingHtmlPath('/api/billing/checkout')).toBe(false);
    expect(isBillingHtmlPath('/api/billing/webhook')).toBe(false);
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

  it('does not redirect /api/billing when public auth config is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const webhook = await updateSession(makeRequest('/api/billing/webhook'));
    const checkout = await updateSession(makeRequest('/api/billing/checkout'));
    expect(webhook.status).toBe(200);
    expect(checkout.status).toBe(200);
    expect(webhook.headers.get('location')).toBeNull();
  });

  it('redirects unauthenticated /admin HTML when auth config is present', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    getUser.mockResolvedValue({ data: { user: null } });

    const response = await updateSession(makeRequest('/admin/model-lab'));
    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('/login');
    expect(location).toContain('next=%2Fadmin%2Fmodel-lab');
  });

  it('does not redirect /api/admin when public auth config is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const response = await updateSession(makeRequest('/api/admin/model-lab/experiments'));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('redirects unauthenticated /billing HTML when auth config is present', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    getUser.mockResolvedValue({ data: { user: null } });

    const response = await updateSession(makeRequest('/billing'));
    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('/login');
    expect(location).toContain('next=%2Fbilling');
  });

  it('allows authenticated betting HTML when auth config is present', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    const response = await updateSession(makeRequest('/betting'));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('refreshes session on / without requiring login or redirecting', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    getUser.mockResolvedValue({ data: { user: null } });

    const guest = await updateSession(makeRequest('/'));
    expect(guest.status).toBe(200);
    expect(guest.headers.get('location')).toBeNull();
    expect(getUser).toHaveBeenCalled();

    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const signedIn = await updateSession(makeRequest('/'));
    expect(signedIn.status).toBe(200);
    expect(signedIn.headers.get('location')).toBeNull();
  });
});
