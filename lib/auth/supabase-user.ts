import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export interface AuthUserContext {
  userId: string;
  email: string | null;
  accessToken: string;
}

interface SupabaseUserResponse {
  id: string;
  email?: string | null;
}

function readBearerToken(request: NextRequest): string | null {
  const auth = request.headers.get('authorization');
  if (!auth) return null;
  const parts = auth.split(' ');
  if (parts.length !== 2) return null;
  if (parts[0]?.toLowerCase() !== 'bearer') return null;
  const token = parts[1]?.trim();
  return token || null;
}

function getSupabaseAuthConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new Error('Missing Supabase auth env vars: NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY');
  }
  return { supabaseUrl, anonKey };
}

export type SupabaseAuthResolution =
  | { ok: false }
  | {
      ok: true;
      auth: AuthUserContext;
      /** Apply refreshed session cookies (same pattern as `lib/supabase/middleware.ts`). */
      withAuthCookies: (response: NextResponse) => NextResponse;
    };

/**
 * Resolve the current user for Route Handlers using `@supabase/ssr` (same cookie decoding as middleware).
 * Always wrap JSON responses with `withAuthCookies` when `ok` so token refresh can update the browser.
 */
export async function resolveSupabaseAuth(request: NextRequest): Promise<SupabaseAuthResolution> {
  const { supabaseUrl, anonKey } = getSupabaseAuthConfig();
  const bearer = readBearerToken(request);

  if (bearer) {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${bearer}`,
      },
      cache: 'no-store',
    });
    if (!response.ok) return { ok: false };
    const user = (await response.json()) as SupabaseUserResponse;
    if (!user?.id) return { ok: false };
    return {
      ok: true,
      auth: {
        userId: user.id,
        email: user.email ?? null,
        accessToken: bearer,
      },
      withAuthCookies: (r) => r,
    };
  }

  let relay = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          try {
            request.cookies.set(name, value);
          } catch {
            /* RequestCookies can be read-only in some runtimes */
          }
        });
        relay = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          relay.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.id) {
    return { ok: false };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return {
    ok: true,
    auth: {
      userId: user.id,
      email: user.email ?? null,
      accessToken: session?.access_token ?? '',
    },
    withAuthCookies(response: NextResponse) {
      relay.cookies.getAll().forEach((cookie) => {
        response.cookies.set(cookie.name, cookie.value);
      });
      return response;
    },
  };
}

/** Prefer {@link resolveSupabaseAuth} in Route Handlers so refreshed cookies are not dropped. */
export async function getAuthUserFromRequest(request: NextRequest): Promise<AuthUserContext | null> {
  const r = await resolveSupabaseAuth(request);
  return r.ok ? r.auth : null;
}
