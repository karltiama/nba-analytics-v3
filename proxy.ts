import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    '/betting/:path*',
    // Session cookie refresh only — API routes enforce auth in handlers
    // (JSON 401). Do not redirect APIs to /login from updateSession.
    '/api/betting/:path*',
    '/api/user/:path*',
  ],
};
