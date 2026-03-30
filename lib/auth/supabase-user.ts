import type { NextRequest } from 'next/server';

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

function maybeParseSupabaseAuthCookie(rawCookieValue: string): string | null {
  try {
    const decoded = decodeURIComponent(rawCookieValue);
    const parsed = JSON.parse(decoded);
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && parsed[0].length > 0) {
      return parsed[0];
    }
    return null;
  } catch {
    return null;
  }
}

function readTokenFromCookies(request: NextRequest): string | null {
  const direct = request.cookies.get('sb-access-token')?.value;
  if (direct) return direct;

  const all = request.cookies.getAll();
  for (const c of all) {
    if (c.name.endsWith('-auth-token')) {
      const parsed = maybeParseSupabaseAuthCookie(c.value);
      if (parsed) return parsed;
    }
  }
  return null;
}

function getSupabaseAuthConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new Error('Missing Supabase auth env vars: NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY');
  }
  return { supabaseUrl, anonKey };
}

export async function getAuthUserFromRequest(request: NextRequest): Promise<AuthUserContext | null> {
  const accessToken = readBearerToken(request) || readTokenFromCookies(request);
  if (!accessToken) return null;

  const { supabaseUrl, anonKey } = getSupabaseAuthConfig();
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  });
  if (!response.ok) return null;

  const user = (await response.json()) as SupabaseUserResponse;
  if (!user?.id) return null;

  return {
    userId: user.id,
    email: user.email ?? null,
    accessToken,
  };
}
