/**
 * Brief in-memory cache for on-demand resolve (cost-safe spike pattern).
 * Not shared across processes; not a production cache.
 */

type CacheEntry<T> = { value: T; expiresAt: number };

export class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}

/** Default ~60s — enough to cover a single handoff sheet open without re-billing. */
export const DEFAULT_SPIKE_CACHE_TTL_MS = 60_000;
