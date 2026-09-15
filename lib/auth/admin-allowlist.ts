/**
 * Fail-closed staff allowlist for private admin surfaces (Model Lab).
 * Empty or unset ADMIN_EMAILS admits nobody.
 */

export function parseAdminEmails(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.ADMIN_EMAILS ?? '';
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const email = part.trim().toLowerCase();
    if (!email) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

export function isAdminEmail(
  email: string | null | undefined,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (!email) return false;
  const allow = parseAdminEmails(env);
  if (allow.length === 0) return false;
  return allow.includes(email.trim().toLowerCase());
}
