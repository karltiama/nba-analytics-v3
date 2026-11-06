/**
 * Legacy non-archiving /v1/games adapter (not used by the Lambda since DATA2E.1; the
 * Lambda uses status-sync-acquisition.ts). Always goes through fetchBdlLive.
 */

import { BdlRateLimitError, fetchBdlLive } from '@/lib/balldontlie/live-rate-limit';
import type { StatusSyncFetchPage } from './status-sync';

const HTTP_TIMEOUT_MS = 15_000;

export function bdlApiKey(env: Record<string, string | undefined>): string {
  return (env.BALLDONTLIE_API_KEY ?? env.BALDONTLIE_API_KEY ?? '').trim();
}

export function createStatusSyncFetchPage(
  env: Record<string, string | undefined> = process.env
): StatusSyncFetchPage {
  return async (url) => {
    const key = bdlApiKey(env);
    if (!key) {
      return { status: 0, ok: false, error: 'missing BALLDONTLIE_API_KEY' };
    }
    const configuredTimeout = (env.BDL_HTTP_TIMEOUT_MS ?? '').trim();
    const limiterEnv = configuredTimeout
      ? env
      : { ...env, BDL_HTTP_TIMEOUT_MS: String(HTTP_TIMEOUT_MS) };
    try {
      // The limiter starts this timeout after the rate-limit grant. A signal created
      // here would include the shared-bucket wait and abort a request that just got a token.
      const res = await fetchBdlLive(
        url,
        { headers: { Authorization: key } },
        {
          env: limiterEnv,
          worker: env.BDL_RATE_LIMIT_WORKER ?? 'game-status-sync',
        }
      );
      let json: { data?: never[]; meta?: { next_cursor?: number | null } } | undefined;
      try {
        json = (await res.json()) as typeof json;
      } catch {
        json = undefined;
      }
      return {
        status: res.status,
        ok: res.ok,
        json,
      };
    } catch (err) {
      return statusSyncFetchErrorResult(err);
    }
  };
}

/** Limiter / transport failure → page result (no HTTP response reached the caller). */
export function statusSyncFetchErrorResult(err: unknown): {
  status: number;
  ok: false;
  timeout?: boolean;
  error: string;
} {
  if (err instanceof BdlRateLimitError) {
    if (err.code === 'timeout') {
      return { status: 0, ok: false, timeout: true, error: err.message };
    }
    return { status: 0, ok: false, error: err.message };
  }
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : String(err);
  if (name === 'TimeoutError' || name === 'AbortError' || /aborted|timeout/i.test(message)) {
    return { status: 0, ok: false, timeout: true, error: message };
  }
  return { status: 0, ok: false, error: message };
}
