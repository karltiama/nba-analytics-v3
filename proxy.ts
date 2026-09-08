import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    '/betting/:path*',
    '/ops',
    '/ops/:path*',
    // Session cookie refresh only — API routes enforce auth in handlers
    // (JSON 401). Do not redirect APIs to /login from updateSession.
    '/api/betting/:path*',
    '/api/ops/:path*',
    '/api/user/:path*',
    '/billing',
    '/billing/:path*',
    // Cookie refresh for authenticated billing APIs only.
    // Webhook authority is Stripe signature — do not session-gate it.
    '/api/billing/checkout',
    '/api/billing/portal',
    '/api/billing/status',
  ],
};
