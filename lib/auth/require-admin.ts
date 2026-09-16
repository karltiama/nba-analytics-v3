/**
 * Admin gate for `/admin/model-lab`, `/admin/product-preview`, and `/api/admin/model-lab/*`.
 * Session required, then ADMIN_EMAILS allowlist (fail-closed if empty).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail, parseAdminEmails } from '@/lib/auth/admin-allowlist';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';

export const ADMIN_UNAUTHORIZED_BODY = { error: 'Unauthorized' } as const;
export const ADMIN_FORBIDDEN_BODY = { error: 'Forbidden' } as const;

export type AdminAuthOk = {
  ok: true;
  auth: { userId: string; email: string | null; accessToken: string };
  withAuthCookies: (response: NextResponse) => NextResponse;
};

export type AdminAuthDenied = {
  ok: false;
  response: NextResponse;
};

export type AdminPageDenied = {
  ok: false;
  reason: 'unauthenticated' | 'forbidden' | 'allowlist_empty';
  email: string | null;
};

export type AdminPageOk = {
  ok: true;
  userId: string;
  email: string;
};

export async function requireAdminAuth(request: NextRequest): Promise<AdminAuthOk | AdminAuthDenied> {
  const session = await requireBettingAuth(request);
  if (!session.ok) {
    return { ok: false, response: session.response };
  }

  const allow = parseAdminEmails();
  if (allow.length === 0 || !isAdminEmail(session.auth.email)) {
    return {
      ok: false,
      response: NextResponse.json(ADMIN_FORBIDDEN_BODY, { status: 403 }),
    };
  }

  return {
    ok: true,
    auth: session.auth,
    withAuthCookies: session.withAuthCookies,
  };
}

export async function requireAdminPage(): Promise<AdminPageOk | AdminPageDenied> {
  const allow = parseAdminEmails();
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) return { ok: false, reason: 'unauthenticated', email: null };
    const email = user.email ?? null;
    if (allow.length === 0) {
      return { ok: false, reason: 'allowlist_empty', email };
    }
    if (!isAdminEmail(email)) {
      return { ok: false, reason: 'forbidden', email };
    }
    return { ok: true, userId: user.id, email: email as string };
  } catch {
    return { ok: false, reason: 'unauthenticated', email: null };
  }
}
