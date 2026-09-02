/**
 * Shared authorization for `/api/cron/*` (Vercel Cron / manual curl).
 *
 * Production: CRON_SECRET (or route-specific override) must be set; missing
 * secret → 503. Request must present Bearer token or `?secret=` matching.
 *
 * Local/dev: if no secret is configured, requests are allowed so scripts work
 * without env boilerplate. Prefer setting CRON_SECRET locally when testing auth.
 *
 * AWS EventBridge → Lambda does not use this module.
 */

import { type NextRequest } from 'next/server';

export type CronAuthOptions = {
  /**
   * Env var names to read, in priority order.
   * Default: CRON_SECRET only.
   */
  secretEnvKeys?: readonly string[];
};

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

function readCronSecret(keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function extractPresentedSecret(request: NextRequest): string | null {
  const auth = request.headers.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (bearer) return bearer;
  const q = request.nextUrl.searchParams.get('secret');
  return q?.trim() || null;
}

/**
 * Authorize a cron HTTP request against configured secrets.
 */
export function authorizeCronRequest(
  request: NextRequest,
  options?: CronAuthOptions
): CronAuthResult {
  const keys = options?.secretEnvKeys ?? (['CRON_SECRET'] as const);
  const secret = readCronSecret(keys);
  const isProduction = process.env.NODE_ENV === 'production';

  if (!secret) {
    if (isProduction) {
      return {
        ok: false,
        status: 503,
        error: `${keys.join(' or ')} must be set in production`,
      };
    }
    // Dev convenience: no secret configured → allow.
    return { ok: true };
  }

  const presented = extractPresentedSecret(request);
  if (presented !== secret) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  return { ok: true };
}
