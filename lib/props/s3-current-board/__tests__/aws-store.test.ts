import { createHash } from 'node:crypto';

import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';

import { gunzipEnvelope } from '@/lambda/player-props-snapshot/src/player-prop-snapshot-archive';
import { pointerKey, publishCurrentSnapshot, type PublishRequest } from '@/lambda/player-props-snapshot/src/f39b/publish';
import type { ProviderPage } from '@/lambda/player-props-snapshot/src/f39b/pages';
import type { BdlPlayerPropRow } from '@/lambda/player-props-snapshot/src/types';
import { readCurrentBoard } from '@/lib/props/s3-current-board/read';
import { currentPropsSource } from '@/lib/props/s3-current-board/source';
import {
  AwsCurrentBoardStore,
  createAwsCurrentBoardStore,
  S3ObjectError,
} from '@/lib/props/s3-current-board/aws-store';

/**
 * This client is a local stand-in. It is not AWS S3 and it does not open a socket.
 * It copies the conditional-write statuses the adapter classifies.
 */
export const EMULATED_S3_BEHAVIORS = [
  'one process-local map, with no AWS account, bucket, or network',
  'a quoted MD5 ETag, which is not the archive SHA-256 checksum',
  'pointer puts queued in call order instead of overlapping at AWS',
  'absent GetObject is a ListBucket 403 without ListBucket and 404 with it',
  'only that ListBucket 403 is absence; a GetObject or PutObject 403 is not',
  'no ListObjects, versioning, replication delay, or object ACL',
] as const;

const GAME = '501';
const TIP = '2026-11-24T00:00:00.000Z';
const OBSERVED = '2026-11-23T22:00:00.000Z';
const ENQUEUED = '2026-11-23T21:59:00.000Z';

class EmulatedS3 {
  readonly objects = new Map<string, { body: Buffer; metadata: Record<string, string>; etag: string }>();
  readonly commands: string[] = [];
  holdPointerPuts = 0;
  /** Least-privilege default. An absent key is 403 until this is turned on. */
  listBucket = false;
  /** Real denial: 403 even when the object exists. This is not the absent-key 403. */
  denyGets = false;
  denyPointerGets = false;
  denyPuts = false;
  denyPointerPuts = false;
  /** Fail this many conditional puts that would otherwise succeed. */
  forcedConflicts = 0;
  nextConflict: 409 | 412 = 412;
  nextGetStatus: number | null = null;
  nextPutStatus: number | null = null;
  private waiting: Array<() => void> = [];

  waitingPointerPuts(): number {
    return this.waiting.length;
  }

  releasePointerPuts(): void {
    const waiting = this.waiting.splice(0);
    for (const resolve of waiting) resolve();
  }

  async send(command: GetObjectCommand | PutObjectCommand) {
    const key = command.input.Key ?? '';
    if (command instanceof GetObjectCommand) {
      this.commands.push(`GET ${key}`);
      if (this.nextGetStatus != null) {
        const status = this.nextGetStatus;
        this.nextGetStatus = null;
        throw httpError(status);
      }
      if (this.denyGets || (this.denyPointerGets && key.endsWith('/pointer.json'))) {
        throw httpError(403, 'AccessDenied', 'not authorized to perform: s3:GetObject');
      }
      const found = this.objects.get(key);
      if (!found) {
        throw this.listBucket
          ? httpError(404, 'NoSuchKey')
          : httpError(403, 'AccessDenied', 'not authorized to perform: s3:ListBucket on resource: "arn:aws:s3:::isolated-bucket"');
      }
      return {
        Body: { transformToByteArray: async () => Uint8Array.from(found.body) },
        ETag: found.etag,
        Metadata: lower(found.metadata),
      };
    }
    this.commands.push(`PUT ${key}`);
    if (this.denyPuts || (this.denyPointerPuts && key.endsWith('/pointer.json'))) {
      throw httpError(403, 'AccessDenied', 'not authorized to perform: s3:PutObject');
    }
    if (this.nextPutStatus != null) {
      const status = this.nextPutStatus;
      this.nextPutStatus = null;
      throw httpError(status);
    }
    if (key.endsWith('/pointer.json') && this.holdPointerPuts > 0) {
      this.holdPointerPuts -= 1;
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    const body = Buffer.from(command.input.Body as Buffer);
    const existing = this.objects.get(key) ?? null;
    const creating = command.input.IfNoneMatch === '*';
    if (creating ? existing != null : !existing || existing.etag !== command.input.IfMatch) {
      throw httpError(this.takeConflict());
    }
    if (this.forcedConflicts > 0 && key.endsWith('/pointer.json')) {
      this.forcedConflicts -= 1;
      throw httpError(this.takeConflict());
    }
    const etag = `"${createHash('md5').update(body).digest('hex')}"`;
    this.objects.set(key, { body, metadata: { ...(command.input.Metadata ?? {}) }, etag });
    return { ETag: etag };
  }

  private takeConflict(): 409 | 412 {
    const status = this.nextConflict;
    this.nextConflict = 412;
    return status;
  }
}

function httpError(status: number, name?: string, message?: string): Error {
  const err = new Error(message ?? `emulated http ${status}`) as Error & { $metadata: { httpStatusCode: number } };
  err.name = name ?? (status === 412 ? 'PreconditionFailed' : status === 409 ? 'ConditionalRequestConflict' : status === 403 ? 'AccessDenied' : 'InternalError');
  err.$metadata = { httpStatusCode: status };
  return err;
}

function lower(meta: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(meta).map(([key, value]) => [key.toLowerCase(), value]));
}

function row(playerId: number, line: string): BdlPlayerPropRow {
  return {
    id: playerId,
    game_id: 501,
    player_id: playerId,
    vendor: 'DraftKings',
    prop_type: 'points',
    line_value: line,
    market: { type: 'over_under', over_odds: -115, under_odds: -105 },
    updated_at: '2026-11-23T21:50:00.000Z',
  };
}

function page(rows: BdlPlayerPropRow[]): ProviderPage {
  return { httpStatus: 200, payload: { data: rows, meta: { next_cursor: null } } };
}

function harness(): { s3: EmulatedS3; store: AwsCurrentBoardStore } {
  const s3 = new EmulatedS3();
  const store = createAwsCurrentBoardStore({ bucket: 'isolated-bucket', client: s3 as unknown as S3Client });
  return { s3, store };
}

function request(store: AwsCurrentBoardStore, partial: Partial<PublishRequest> = {}): PublishRequest {
  return {
    store,
    gameId: GAME,
    bdlGameId: 501,
    gameDate: '2026-11-23',
    gameStartTime: TIP,
    pullRunId: 2,
    pages: [page([row(10, '22.5'), row(11, '18.5')])],
    observedAt: OBSERVED,
    controllerEnqueuedAt: ENQUEUED,
    ...partial,
  };
}

async function until(ready: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('publishers did not reach the pointer write');
}

describe('F42 AWS current-board store', () => {
  it('names the behaviors this suite emulates', () => {
    expect(EMULATED_S3_BEHAVIORS).toContain('one process-local map, with no AWS account, bucket, or network');
    expect(currentPropsSource({})).toBe('postgres');
  });

  it('creates an immutable object and keeps the S3 ETag off the checksum', async () => {
    const { store } = harness();
    const published = await publishCurrentSnapshot(request(store));
    expect(published.published).toBe(true);
    const object = await store.get(published.archiveKey!);
    const envelope = gunzipEnvelope(object!.body);
    expect(object!.etag.startsWith('"')).toBe(true);
    expect(object!.etag.replaceAll('"', '')).not.toBe(envelope.checksum);
    const again = await store.putIfAbsent(published.archiveKey!, Buffer.from('different'), {});
    expect(again).toBe('precondition_failed');
    expect((await store.get(published.archiveKey!))!.body.equals(object!.body)).toBe(true);
  });

  it('treats the same archive bytes as a retry', async () => {
    const { store } = harness();
    const first = await publishCurrentSnapshot(request(store));
    const etag = (await store.get(pointerKey(GAME)))!.etag;
    const second = await publishCurrentSnapshot(request(store));
    expect(second.idempotent).toBe(true);
    expect(second.archiveKey).toBe(first.archiveKey);
    expect((await store.get(pointerKey(GAME)))!.etag).toBe(etag);
  });

  it('rejects a conflicting object and a failed conditional pointer', async () => {
    const { s3, store } = harness();
    const first = await publishCurrentSnapshot(request(store));
    s3.nextConflict = 409;
    const conflict = await store.putIfAbsent(first.archiveKey!, Buffer.from('other-bytes'), {});
    expect(conflict).toBe('conditional_conflict');
    const second = await publishCurrentSnapshot(request(store, {
      pullRunId: 3,
      observedAt: '2026-11-23T22:10:00.000Z',
      controllerEnqueuedAt: '2026-11-23T22:09:00.000Z',
      pages: [page([row(11, '18.5')])],
    }));
    expect(second.published).toBe(true);
    const pointer = JSON.parse((await store.get(pointerKey(GAME)))!.body.toString('utf8'));
    expect(pointer.previousArchiveKey).toBe(first.archiveKey);
    expect(pointer.pullRunId).toBe(3);
  });

  it('lets the newer of two writers become current without changing either archive', async () => {
    const { s3, store } = harness();
    s3.holdPointerPuts = 2;
    const older = publishCurrentSnapshot(request(store, { pullRunId: 5, observedAt: '2026-11-23T22:10:00.000Z' }));
    const newer = publishCurrentSnapshot(request(store, {
      pullRunId: 6,
      observedAt: '2026-11-23T22:20:00.000Z',
      controllerEnqueuedAt: '2026-11-23T22:19:00.000Z',
      pages: [page([row(11, '19.5')])],
    }));
    await until(() => s3.waitingPointerPuts() === 2);
    const archives = [...s3.objects.entries()].filter(([key]) => key.endsWith('.json.gz'));
    s3.releasePointerPuts();
    const [olderResult, newerResult] = await Promise.all([older, newer]);
    expect(olderResult.published).toBe(true);
    expect(newerResult.published).toBe(true);
    const pointer = JSON.parse((await store.get(pointerKey(GAME)))!.body.toString('utf8'));
    expect(pointer.previousArchiveKey).toBe(olderResult.archiveKey);
    expect(pointer.archiveKey).toBe(newerResult.archiveKey);
    for (const [key, object] of archives) expect(s3.objects.get(key)!.body.equals(object.body)).toBe(true);
  });

  it('rejects a missing object, a corrupted archive, and a mismatched manifest', async () => {
    const missing = await readCurrentBoard({ store: harness().store, gameId: GAME, now: OBSERVED });
    expect(missing.available).toBe(false);
    const { s3, store } = harness();
    const published = await publishCurrentSnapshot(request(store));
    const archive = s3.objects.get(published.archiveKey!)!;
    archive.body[archive.body.length - 1] ^= 0xff;
    const corrupted = await readCurrentBoard({ store, gameId: GAME, now: OBSERVED });
    expect(corrupted.available).toBe(false);
    archive.body[archive.body.length - 1] ^= 0xff;
    const manifest = s3.objects.get(published.manifestKey!)!;
    manifest.body = Buffer.from(manifest.body.toString('utf8').replace(published.archiveKey!, 'raw/other.json.gz'));
    const mismatched = await readCurrentBoard({ store, gameId: GAME, now: OBSERVED });
    expect(mismatched.available).toBe(false);
  });

  it('classifies a failed read or write and does not publish it', async () => {
    const { s3, store } = harness();
    s3.nextPutStatus = 403;
    const denied = await publishCurrentSnapshot(request(store));
    expect(denied.published).toBe(false);
    s3.nextPutStatus = 503;
    await expect(store.put(pointerKey(GAME), Buffer.from('{}'), {}, { kind: 'if-none-match', etag: '*' })).rejects.toMatchObject({
      name: 'S3ObjectError',
      retryable: true,
    });
    await publishCurrentSnapshot(request(store));
    s3.nextGetStatus = 500;
    const failedRead = await readCurrentBoard({ store, gameId: GAME, now: OBSERVED });
    expect(failedRead.available).toBe(false);
    s3.nextGetStatus = 403;
    await expect(store.get(pointerKey(GAME))).rejects.toMatchObject({ retryable: false });
  });

  it('rejects an expired board and keeps website access read only', async () => {
    const { s3, store } = harness();
    await publishCurrentSnapshot(request(store));
    const expired = await readCurrentBoard({ store, gameId: GAME, now: TIP });
    expect(expired.available).toBe(false);
    const puts = s3.commands.filter((command) => command.startsWith('PUT')).length;
    const reader = createAwsCurrentBoardStore({
      bucket: 'isolated-bucket',
      readOnly: true,
      client: s3 as unknown as S3Client,
    });
    const board = await readCurrentBoard({ store: reader, gameId: GAME, now: OBSERVED });
    expect(board.available).toBe(true);
    await expect(reader.put(pointerKey(GAME), Buffer.from('{}'), {}, { kind: 'if-match', etag: '"x"' })).rejects.toBeInstanceOf(S3ObjectError);
    expect(s3.commands.filter((command) => command.startsWith('PUT'))).toHaveLength(puts);
  });

  it('fails closed without a bucket and rejects an arbitrary key', async () => {
    const s3 = new EmulatedS3();
    expect(() => createAwsCurrentBoardStore({ bucket: '', client: s3 as unknown as S3Client })).toThrow(/not configured/);
    const store = createAwsCurrentBoardStore({ bucket: 'isolated-bucket', client: s3 as unknown as S3Client });
    await expect(store.get('raw/source=balldontlie/league=nba/season=2026/entity=player_props_raw_v2/secret.json.gz')).rejects.toThrow(/protected/);
    await expect(store.get('../pointer.json')).rejects.toThrow(/not a current-board object/);
    expect(s3.commands).toEqual([]);
  });

  it('publishes the first pointer without ListBucket when GetObject would return 403', async () => {
    const { s3, store } = harness();
    expect(s3.listBucket).toBe(false);
    await expect(store.get(pointerKey(GAME))).resolves.toBeNull();
    const before = s3.commands.length;
    const published = await publishCurrentSnapshot(request(store));
    expect(published.published).toBe(true);
    const during = s3.commands.slice(before);
    const pointerGetsBeforeCreate = during.slice(0, during.indexOf(`PUT ${pointerKey(GAME)}`));
    expect(pointerGetsBeforeCreate.some((command) => command === `GET ${pointerKey(GAME)}`)).toBe(false);
    const pointer = JSON.parse((await store.get(pointerKey(GAME)))!.body.toString('utf8'));
    expect(pointer.previousArchiveKey).toBeNull();
    const overwrite = await store.put(
      pointerKey(GAME),
      Buffer.from('{"schemaVersion":1}'),
      {},
      { kind: 'if-none-match', etag: '*' }
    );
    expect(overwrite).toEqual({ ok: false, status: 412, etag: null });
    expect((await store.get(pointerKey(GAME)))!.body.toString('utf8')).toContain(published.archiveKey!);
  });

  it('advances a newer pointer and keeps an older one after a conditional conflict', async () => {
    const { s3, store } = harness();
    const first = await publishCurrentSnapshot(request(store));
    const older = await publishCurrentSnapshot(request(store, {
      pullRunId: 1,
      observedAt: '2026-11-23T21:00:00.000Z',
      controllerEnqueuedAt: '2026-11-23T20:59:00.000Z',
    }));
    expect(older.reason).toBe('older_snapshot');
    expect(JSON.parse((await store.get(pointerKey(GAME)))!.body.toString('utf8')).pullRunId).toBe(2);
    s3.nextConflict = 409;
    const newer = await publishCurrentSnapshot(request(store, {
      pullRunId: 4,
      observedAt: '2026-11-23T22:20:00.000Z',
      controllerEnqueuedAt: '2026-11-23T22:19:00.000Z',
      pages: [page([row(11, '19.5')])],
    }));
    expect(newer.published).toBe(true);
    const pointer = JSON.parse((await store.get(pointerKey(GAME)))!.body.toString('utf8'));
    expect(pointer.previousArchiveKey).toBe(first.archiveKey);
    expect(pointer.pullRunId).toBe(4);
    s3.forcedConflicts = 1;
    const blocked = await publishCurrentSnapshot(request(store, {
      pullRunId: 5,
      observedAt: '2026-11-23T22:30:00.000Z',
      controllerEnqueuedAt: '2026-11-23T22:29:00.000Z',
    }));
    expect(blocked.reason).toBe('pointer_conflict');
    expect(JSON.parse((await store.get(pointerKey(GAME)))!.body.toString('utf8')).pullRunId).toBe(4);
  });

  it('resolves two initial publishers when the absent pointer reads as 403', async () => {
    const { s3, store } = harness();
    s3.holdPointerPuts = 2;
    const older = publishCurrentSnapshot(request(store, { pullRunId: 5, observedAt: '2026-11-23T22:10:00.000Z' }));
    const newer = publishCurrentSnapshot(request(store, {
      pullRunId: 6,
      observedAt: '2026-11-23T22:20:00.000Z',
      controllerEnqueuedAt: '2026-11-23T22:19:00.000Z',
      pages: [page([row(11, '19.5')])],
    }));
    await until(() => s3.waitingPointerPuts() === 2);
    const before = s3.objects.get(pointerKey(GAME));
    s3.releasePointerPuts();
    const [olderResult, newerResult] = await Promise.all([older, newer]);
    expect(before).toBeUndefined();
    expect(olderResult.published).toBe(true);
    expect(newerResult.published).toBe(true);
    const pointer = JSON.parse((await store.get(pointerKey(GAME)))!.body.toString('utf8'));
    expect(pointer.archiveKey).toBe(newerResult.archiveKey);
    expect(pointer.previousArchiveKey).toBe(olderResult.archiveKey);
  });

  it('fails closed on a real 403 and does not publish over an unreadable pointer', async () => {
    const denied = harness();
    denied.s3.denyPointerPuts = true;
    const blocked = await publishCurrentSnapshot(request(denied.store));
    expect(blocked.published).toBe(false);
    expect(blocked.reason).toBe('pointer_write_failed');
    expect(denied.s3.objects.has(pointerKey(GAME))).toBe(false);

    const { s3, store } = harness();
    const first = await publishCurrentSnapshot(request(store));
    const body = Buffer.from((await store.get(pointerKey(GAME)))!.body);
    s3.denyPointerGets = true;
    const hidden = await publishCurrentSnapshot(request(store, {
      pullRunId: 8,
      observedAt: '2026-11-23T22:20:00.000Z',
      controllerEnqueuedAt: '2026-11-23T22:19:00.000Z',
    }));
    expect(hidden.reason).toBe('pointer_unreadable');
    s3.denyPointerGets = false;
    expect((await store.get(pointerKey(GAME)))!.body.equals(body)).toBe(true);
    expect(first.archiveKey).toBeTruthy();

    const reader = createAwsCurrentBoardStore({
      bucket: 'isolated-bucket',
      readOnly: true,
      client: s3 as unknown as S3Client,
    });
    s3.denyPointerGets = true;
    const inaccessible = await readCurrentBoard({ store: reader, gameId: GAME, now: OBSERVED });
    expect(inaccessible).toMatchObject({ available: false, reason: 'unavailable' });
    const absent = harness();
    const missing = await readCurrentBoard({
      store: createAwsCurrentBoardStore({ bucket: 'isolated-bucket', readOnly: true, client: absent.s3 as unknown as S3Client }),
      gameId: GAME,
      now: OBSERVED,
    });
    expect(missing).toMatchObject({ available: false, reason: 'missing' });
    absent.s3.listBucket = true;
    const confirmedMiss = await readCurrentBoard({ store: absent.store, gameId: GAME, now: OBSERVED });
    expect(confirmedMiss).toMatchObject({ available: false, reason: 'missing' });
    expect(absent.s3.commands.some((command) => command.startsWith('PUT'))).toBe(false);
  });

  it('publishes an absent archive with If-None-Match and keeps a bad object off the pointer', async () => {
    const first = harness();
    expect(first.s3.listBucket).toBe(false);
    await expect(first.store.get(pointerKey(GAME))).resolves.toBeNull();
    const published = await publishCurrentSnapshot(request(first.store));
    expect(published.published).toBe(true);
    const archiveCommands = first.s3.commands.filter((command) => command.includes(published.archiveKey!));
    expect(archiveCommands[0]).toBe(`PUT ${published.archiveKey}`);
    const retry = await publishCurrentSnapshot(request(first.store));
    expect(retry.idempotent).toBe(true);
    expect(retry.archiveKey).toBe(published.archiveKey);

    const stored = Buffer.from((await first.store.get(published.archiveKey!))!.body);
    first.s3.objects.get(published.archiveKey!)!.body = Buffer.from('conflicting-bytes');
    const conflict = await publishCurrentSnapshot(request(first.store));
    expect(conflict.published).toBe(false);
    expect((await first.store.get(pointerKey(GAME)))!.body.includes(published.archiveKey!)).toBe(true);
    first.s3.objects.get(published.archiveKey!)!.body = stored;

    const denied = harness();
    denied.s3.denyGets = true;
    const blocked = await publishCurrentSnapshot(request(denied.store));
    expect(blocked.published).toBe(false);
    expect(denied.s3.objects.has(pointerKey(GAME))).toBe(false);

    const unverified = harness();
    unverified.s3.nextGetStatus = 500;
    const failedCheck = await publishCurrentSnapshot(request(unverified.store));
    expect(failedCheck.published).toBe(false);
    expect(unverified.s3.objects.has(pointerKey(GAME))).toBe(false);
  });
});
