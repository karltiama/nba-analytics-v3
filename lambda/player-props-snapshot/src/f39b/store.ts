import { createHash } from 'node:crypto';

import {
  isProtectedHistoricalKey,
  type ConditionalPutResult,
  type InMemoryS3Object,
} from '../player-prop-snapshot-archive';
import { IN_MEMORY_S3_DIFFERENCES } from './s3-differences';

export { IN_MEMORY_S3_DIFFERENCES };

export type ObjectCondition =
  | { kind: 'if-none-match'; etag: '*' }
  | { kind: 'if-match'; etag: string };

export type StoredObject = InMemoryS3Object & { etag: string };

export type PutResult =
  | { ok: true; etag: string; created: boolean }
  | { ok: false; status: 409 | 412; etag: string | null };

/**
 * PutObject / GetObject with If-Match and If-None-Match.
 * Archive creation uses If-None-Match *. Pointer publication uses If-Match.
 */
export class InMemoryPrototypeStore {
  readonly objects = new Map<string, StoredObject>();
  gets = 0;
  puts = 0;
  /** When set, the next conflicting put reports this status, then the field clears. */
  nextConflictStatus: 409 | 412 = 412;
  failGets = 0;
  failPuts = 0;
  failPointerPuts = 0;
  holdPointerPuts = 0;
  private pointerWaiters: Array<() => void> = [];

  async get(key: string): Promise<StoredObject | null> {
    this.gets += 1;
    if (this.failGets > 0) {
      this.failGets -= 1;
      throw new Error(`s3 get failed: forced`);
    }
    return this.objects.get(key) ?? null;
  }

  async put(
    key: string,
    body: Buffer,
    metadata: Record<string, string>,
    condition: ObjectCondition
  ): Promise<PutResult> {
    this.puts += 1;
    if (this.failPuts > 0) {
      this.failPuts -= 1;
      throw new Error(`s3 put failed: forced`);
    }
    if (key.endsWith('/pointer.json') && this.failPointerPuts > 0) {
      this.failPointerPuts -= 1;
      throw new Error(`s3 put failed: pointer`);
    }
    if (isProtectedHistoricalKey(key)) {
      throw new Error(`Refusing to write protected historical prefix: ${key}`);
    }
    if (key.endsWith('/pointer.json') && this.holdPointerPuts > 0) {
      this.holdPointerPuts -= 1;
      await new Promise<void>((resolve) => {
        this.pointerWaiters.push(resolve);
      });
    }
    const existing = this.objects.get(key) ?? null;
    if (condition.kind === 'if-none-match') {
      if (existing) return { ok: false, status: this.takeConflict(), etag: existing.etag };
      return this.write(key, body, metadata, true);
    }
    if (!existing || existing.etag !== condition.etag) {
      return { ok: false, status: this.takeConflict(), etag: existing?.etag ?? null };
    }
    return this.write(key, body, metadata, false);
  }

  waitingPointerPuts(): number {
    return this.pointerWaiters.length;
  }

  releasePointerPuts(): void {
    const waiting = this.pointerWaiters.splice(0);
    for (const resolve of waiting) resolve();
  }

  /** ArchivePutStore adapter. An existing key is a conflict, never an overwrite. */
  async putIfAbsent(
    key: string,
    body: Buffer,
    metadata: Record<string, string>
  ): Promise<ConditionalPutResult> {
    const result = await this.put(key, body, metadata, { kind: 'if-none-match', etag: '*' });
    if (result.ok) return 'created';
    return result.status === 409 ? 'conditional_conflict' : 'precondition_failed';
  }

  private takeConflict(): 409 | 412 {
    const status = this.nextConflictStatus;
    this.nextConflictStatus = 412;
    return status;
  }

  private write(key: string, body: Buffer, metadata: Record<string, string>, created: boolean): PutResult {
    const etag = createHash('sha256').update(body).digest('hex');
    this.objects.set(key, { body, metadata, etag });
    return { ok: true, etag, created };
  }
}
