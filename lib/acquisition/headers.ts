/**
 * Response-header allowlist for acq_envelope.v1 (DATA1 §1.3).
 * Anything not listed is dropped. Request headers are never persisted.
 */

export const ALLOWLISTED_EXACT_HEADERS: readonly string[] = [
  // rate limiting
  'retry-after',
  // pagination
  'link',
  // freshness
  'date',
  'last-modified',
  'etag',
  'age',
  'cache-control',
  'expires',
  // debugging
  'content-type',
  'content-length',
  'content-encoding',
  'x-request-id',
  'cf-ray',
  'cf-cache-status',
  'server',
];

export const ALLOWLISTED_HEADER_PREFIXES: readonly string[] = ['x-ratelimit-', 'ratelimit-'];

/** Never persisted, even if a future allowlist edit would match them. */
export const DENYLISTED_HEADERS: readonly string[] = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
];

const EXACT = new Set(ALLOWLISTED_EXACT_HEADERS);
const DENY = new Set(DENYLISTED_HEADERS);

export function isAllowlistedHeader(name: string): boolean {
  const lower = name.trim().toLowerCase();
  if (!lower || DENY.has(lower)) return false;
  if (EXACT.has(lower)) return true;
  return ALLOWLISTED_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix) && lower.length > prefix.length);
}

export type HeaderSource =
  | { forEach(cb: (value: string, key: string) => void): void }
  | Iterable<[string, string]>
  | Record<string, string | string[] | undefined>;

/** Lowercased, allowlisted, key-sorted header map. Repeated values are joined with ", ". */
export function filterResponseHeaders(source: HeaderSource): Record<string, string> {
  const collected = new Map<string, string[]>();
  const add = (key: string, value: string | string[] | undefined) => {
    if (value == null || !isAllowlistedHeader(key)) return;
    const lower = key.trim().toLowerCase();
    const list = collected.get(lower) ?? [];
    for (const v of Array.isArray(value) ? value : [value]) list.push(String(v));
    collected.set(lower, list);
  };

  if (typeof (source as { forEach?: unknown }).forEach === 'function' && !Array.isArray(source)) {
    (source as { forEach(cb: (value: string, key: string) => void): void }).forEach((value, key) => add(key, value));
  } else if (typeof (source as Iterable<[string, string]>)[Symbol.iterator] === 'function') {
    for (const [key, value] of source as Iterable<[string, string]>) add(key, value);
  } else {
    for (const [key, value] of Object.entries(source as Record<string, string | string[] | undefined>)) add(key, value);
  }

  const out: Record<string, string> = {};
  for (const key of [...collected.keys()].sort()) out[key] = collected.get(key)!.join(', ');
  return out;
}
