import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Refresh session cookies on public marketing/auth pages too.
    // Do not session-gate `/` — logged-in users may still visit home.
    '/',
    '/login',
    '/signup',
    '/forgot-password',
    '/update-password',
    '/dashboard',
    '/dashboard/:path*',
    '/betting/:path*',
    '/ops',
    '/ops/:path*',
    '/admin',
    '/admin/:path*',
    // Session cookie refresh only — API routes enforce auth in handlers
    // (JSON 401/403). Do not redirect APIs to /login from updateSession.
    '/api/betting/:path*',
    '/api/ops/:path*',
    '/api/admin/:path*',
    '/api/user/:path*',
    '/billing',
    '/billing/:path*',
    // Cookie refresh for authenticated billing APIs only.
    // Webhook authority is Stripe signature — do not session-gate it.
    '/api/billing/checkout',
    '/api/billing/portal',
    '/api/billing/status',
    '/parlay-xray',
    '/api/parlay-xray/:path*',
  ],
};
