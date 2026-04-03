/**
 * Prevent open redirects: only same-app relative paths.
 * `next` must start with a single `/` and must not start with `//`.
 */
export function safeInternalPath(raw: string | null | undefined, fallback: string): string {
  if (raw == null || raw === '') return fallback;
  const t = raw.trim();
  if (!t.startsWith('/') || t.startsWith('//')) return fallback;
  try {
    // Reject schemes or backslashes smuggled in path
    if (t.includes('\\') || t.includes(':')) return fallback;
  } catch {
    return fallback;
  }
  return t;
}
