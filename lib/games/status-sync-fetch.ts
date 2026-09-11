/**
 * Production /v1/games adapter for frequent status sync.
 * Always goes through fetchBdlLive (shared nba-bdl-rate-limit). No independent limiter.
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
    try {
      const res = await fetchBdlLive(
        url,
        {
          headers: { Authorization: key },
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        },
        {
          env,
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
      if (err instanceof BdlRateLimitError) {
        if (err.code === 'timeout') {
          return { status: 0, ok: false, timeout: true, error: err.message };
        }
        if (err.code === 'replay' || err.code === 'skip') {
          return { status: 0, ok: false, error: err.message };
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
  };
}
