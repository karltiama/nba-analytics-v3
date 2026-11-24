import type { PlayerPropArchiveEnvelope } from '@/lambda/player-props-snapshot/src/player-prop-snapshot-archive';
import { CURRENT_BOARD_CACHE_MAX_DECODED_BYTES } from './bounds';

export type VerifiedSnapshot = {
  archiveKey: string;
  envelopeChecksum: string;
  envelope: PlayerPropArchiveEnvelope;
  decodedBytes: number;
};

export type SnapshotLoad = {
  snapshot: VerifiedSnapshot | null;
  outcome: 'hit' | 'miss' | 'shared';
};

export function snapshotCacheKey(archiveKey: string, envelopeChecksum: string): string {
  return `${archiveKey.length}:${archiveKey}\n${envelopeChecksum.length}:${envelopeChecksum}`;
}

function freezeDeep(value: unknown): void {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
}

/**
 * Process-local LRU of fully verified envelopes.
 * The budget is the sum of decompressed JSON bytes, not cache age.
 * Insertion order is the eviction order. A read moves the entry to the end.
 */
export class VerifiedSnapshotCache {
  private readonly entries = new Map<string, VerifiedSnapshot>();
  private readonly pending = new Map<string, Promise<VerifiedSnapshot | null>>();
  private retainedBytes = 0;

  constructor(private readonly maxDecodedBytes: number) {}

  get retained(): number {
    return this.retainedBytes;
  }

  get size(): number {
    return this.entries.size;
  }

  peek(archiveKey: string, envelopeChecksum: string): VerifiedSnapshot | null {
    const key = snapshotCacheKey(archiveKey, envelopeChecksum);
    const found = this.entries.get(key);
    if (!found) return null;
    this.entries.delete(key);
    this.entries.set(key, found);
    const copy = structuredClone(found);
    freezeDeep(copy);
    return copy;
  }

  remember(snapshot: VerifiedSnapshot): boolean {
    if (!Number.isFinite(snapshot.decodedBytes) || snapshot.decodedBytes < 0) return false;
    if (snapshot.decodedBytes > this.maxDecodedBytes) return false;
    const key = snapshotCacheKey(snapshot.archiveKey, snapshot.envelopeChecksum);
    const existing = this.entries.get(key);
    if (existing) {
      this.retainedBytes -= existing.decodedBytes;
      this.entries.delete(key);
    }
    while (this.entries.size > 0 && this.retainedBytes + snapshot.decodedBytes > this.maxDecodedBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      const removed = this.entries.get(oldest);
      this.entries.delete(oldest);
      if (removed) this.retainedBytes -= removed.decodedBytes;
    }
    const stored = structuredClone(snapshot);
    freezeDeep(stored);
    this.entries.set(key, stored);
    this.retainedBytes += snapshot.decodedBytes;
    return true;
  }

  async load(
    archiveKey: string,
    envelopeChecksum: string,
    loader: () => Promise<VerifiedSnapshot | null>,
  ): Promise<SnapshotLoad> {
    const hit = this.peek(archiveKey, envelopeChecksum);
    if (hit) return { snapshot: hit, outcome: 'hit' };
    const key = snapshotCacheKey(archiveKey, envelopeChecksum);
    const inflight = this.pending.get(key);
    if (inflight) return { snapshot: await inflight, outcome: 'shared' };
    let resolveFlight: (value: VerifiedSnapshot | null) => void = () => undefined;
    let rejectFlight: (error: unknown) => void = () => undefined;
    const flight = new Promise<VerifiedSnapshot | null>((resolve, reject) => {
      resolveFlight = resolve;
      rejectFlight = reject;
    });
    this.pending.set(key, flight);
    void this.fetch(loader).then(
      (value) => {
        this.pending.delete(key);
        resolveFlight(value);
      },
      (error: unknown) => {
        this.pending.delete(key);
        rejectFlight(error);
      },
    );
    return { snapshot: await flight, outcome: 'miss' };
  }

  private async fetch(loader: () => Promise<VerifiedSnapshot | null>): Promise<VerifiedSnapshot | null> {
    const loaded = await loader();
    if (!loaded) return null;
    if (!this.remember(loaded)) {
      const copy = structuredClone(loaded);
      freezeDeep(copy);
      return copy;
    }
    return this.peek(loaded.archiveKey, loaded.envelopeChecksum);
  }
}

let shared: VerifiedSnapshotCache | null = null;

export function sharedVerifiedSnapshotCache(): VerifiedSnapshotCache {
  shared ??= new VerifiedSnapshotCache(CURRENT_BOARD_CACHE_MAX_DECODED_BYTES);
  return shared;
}

export function resetVerifiedSnapshotCacheForTests(): void {
  shared = null;
}
