/**
 * Optional Umami pageview script. No-op unless both env values are set.
 * Does not add a second analytics provider.
 */

export function umamiScriptConfig(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): { websiteId: string; src: string } | null {
  const websiteId = (env.NEXT_PUBLIC_UMAMI_WEBSITE_ID ?? '').trim();
  const src = (env.NEXT_PUBLIC_UMAMI_SRC ?? '').trim();
  if (!websiteId || !src) return null;
  return { websiteId, src };
}
