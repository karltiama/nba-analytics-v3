/**
 * Session-memory map: share fingerprint → created public share.
 * Survives client navigations; clears on hard reload.
 * Does not persist to localStorage/URL.
 */

export type CachedSharedSlip = {
  fingerprint: string;
  shareId: string;
  path: string;
  title: string | null;
  createdAt: string;
};

let cache: CachedSharedSlip | null = null;

export function getCachedSharedSlip(fingerprint: string): CachedSharedSlip | null {
  if (!cache || cache.fingerprint !== fingerprint) return null;
  return cache;
}

export function setCachedSharedSlip(entry: CachedSharedSlip): void {
  cache = entry;
}

export function clearCachedSharedSlip(): void {
  cache = null;
}

/** Test helper */
export function peekCachedSharedSlip(): CachedSharedSlip | null {
  return cache;
}
