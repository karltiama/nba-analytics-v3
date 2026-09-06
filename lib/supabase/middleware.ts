import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export function isBettingHtmlPath(pathname: string): boolean {
  return (
    (pathname === '/betting' || pathname.startsWith('/betting/')) &&
    !pathname.startsWith('/api/')
  );
}

export function isOpsHtmlPath(pathname: string): boolean {
  return pathname === '/ops' || pathname.startsWith('/ops/');
}

export function isSessionProtectedHtmlPath(pathname: string): boolean {
  return isBettingHtmlPath(pathname) || isOpsHtmlPath(pathname);
}

export function isSupabaseBrowserAuthConfigured(
  env: Record<string, string | undefined> = process.env
): boolean {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return Boolean(url && anonKey);
}

function redirectToLogin(request: NextRequest, extraParams?: Record<string, string>) {
  const pathname = request.nextUrl.pathname;
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      loginUrl.searchParams.set(key, value);
    }
  }
  return NextResponse.redirect(loginUrl);
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const pathname = request.nextUrl.pathname;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  // Protected HTML must not render when auth config is missing (fail-closed).
  // `/api/betting/*` and `/api/ops/*` stay unblocked here so handlers can return JSON 401.
  if (!url || !anonKey) {
    if (isSessionProtectedHtmlPath(pathname)) {
      return redirectToLogin(request, { error: 'auth_config' });
    }
    return supabaseResponse;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isSessionProtectedHtmlPath(pathname) && !user) {
    const redirectResponse = redirectToLogin(request);
    for (const c of supabaseResponse.cookies.getAll()) {
      redirectResponse.cookies.set(c.name, c.value);
    }
    return redirectResponse;
  }

  return supabaseResponse;
}
