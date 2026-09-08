/**
 * Parse HTTP Retry-After for BDL 429 handling.
 * Supports delay-seconds and HTTP-date. Returns null when the header is absent
 * or unusable so callers can fall back to exponential backoff.
 */

export function parseRetryAfterMs(
  header: string | null | undefined,
  nowMs: number = Date.now()
): number | null {
  if (header == null) return null;
  const raw = header.trim();
  if (!raw) return null;

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return Math.ceil(seconds * 1000);
  }

  const when = Date.parse(raw);
  if (Number.isNaN(when)) return null;
  return Math.max(0, when - nowMs);
}

export function delayForRateLimit(args: {
  retryAfterHeader?: string | null;
  attempt: number;
  retryBaseDelayMs: number;
}): { delayMs: number; source: 'retry-after' | 'exponential' } {
  const fromHeader = parseRetryAfterMs(args.retryAfterHeader);
  if (fromHeader != null) {
    return { delayMs: fromHeader, source: 'retry-after' };
  }
  const exp = args.retryBaseDelayMs * Math.pow(2, Math.max(0, args.attempt));
  return { delayMs: exp, source: 'exponential' };
}
