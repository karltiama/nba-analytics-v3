/**
 * Shared auth gate for private `/api/betting/*` route handlers.
 *
 * Prefer this over page middleware alone — API routes are not redirected by
 * `lib/supabase/middleware.ts` and must return JSON 401 themselves.
 *
 * Intentionally public betting endpoints (if any) must be documented in the
 * route file and must NOT call this helper.
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  resolveSupabaseAuth,
  type AuthUserContext,
  type SupabaseAuthResolution,
} from '@/lib/auth/supabase-user';

export const BETTING_UNAUTHORIZED_BODY = { error: 'Unauthorized' } as const;

export type BettingAuthOk = {
  ok: true;
  auth: AuthUserContext;
  withAuthCookies: (response: NextResponse) => NextResponse;
};

export type BettingAuthDenied = {
  ok: false;
  response: NextResponse;
};

export type BettingAuthResult = BettingAuthOk | BettingAuthDenied;

/**
 * Resolve the current Supabase session (cookie or Bearer).
 * On failure, returns a ready-to-send 401 JSON response.
 * On success, wrap outgoing responses with `withAuthCookies` so refreshed
 * session cookies are not dropped (same pattern as `/api/user/*`).
 */
export async function requireBettingAuth(request: NextRequest): Promise<BettingAuthResult> {
  let resolution: SupabaseAuthResolution;
  try {
    resolution = await resolveSupabaseAuth(request);
  } catch (error: unknown) {
    // Misconfigured auth env or unexpected resolver failure — fail closed.
    console.error('[requireBettingAuth] auth resolution failed:', error);
    return {
      ok: false,
      response: NextResponse.json(BETTING_UNAUTHORIZED_BODY, { status: 401 }),
    };
  }

  if (!resolution.ok) {
    return {
      ok: false,
      response: NextResponse.json(BETTING_UNAUTHORIZED_BODY, { status: 401 }),
    };
  }

  return {
    ok: true,
    auth: resolution.auth,
    withAuthCookies: resolution.withAuthCookies,
  };
}
