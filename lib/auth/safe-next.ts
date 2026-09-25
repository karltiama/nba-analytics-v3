/**
 * Prevent open redirects: only same-app relative paths.
 * Query values may contain ":" (dates). Schemes in the path may not.
 */
export const AUTHENTICATED_HOME = '/dashboard';

export function safeInternalPath(raw: string | null | undefined, fallback: string): string {
  if (raw == null || raw === '') return fallback;
  const t = raw.trim();
  if (!t.startsWith('/') || t.startsWith('//')) return fallback;
  if (t.includes('\\') || /[\u0000-\u001F\u007F]/.test(t)) return fallback;

  const pathOnly = t.split('#')[0]?.split('?')[0] ?? '';
  if (pathOnly.includes(':')) return fallback;

  const lower = t.toLowerCase();
  if (lower.includes('javascript:') || lower.includes('data:')) return fallback;

  return t;
}
