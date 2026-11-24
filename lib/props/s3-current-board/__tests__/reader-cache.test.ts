import { gzipSync } from 'node:zlib';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { S3Client } from '@aws-sdk/client-s3';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { query, queryOne } from '@/lib/db';
import { getPlayerPropsForExplorer } from '@/lib/betting/props-explorer-serving';
import {
  buildArchiveEnvelope,
  gzipEnvelope,
  openEnvelope,
  type PlayerPropArchiveRow,
} from '@/lambda/player-props-snapshot/src/player-prop-snapshot-archive';
import { publishCurrentSnapshot, type PublishRequest } from '@/lambda/player-props-snapshot/src/f39b/publish';
import type { ProviderPage } from '@/lambda/player-props-snapshot/src/f39b/pages';
import { InMemoryPrototypeStore } from '@/lambda/player-props-snapshot/src/f39b/store';
import type { BdlPlayerPropRow } from '@/lambda/player-props-snapshot/src/types';
import { HISTORICAL_BOARD_MAX_COMPRESSED_BYTES, HISTORICAL_BOARD_MAX_UNCOMPRESSED_BYTES } from '@/lib/props/historical-board-archive';
import {
  PROPS_MAX_MARKET_CHARS,
  PROPS_MAX_PLAYER_NAME_CHARS,
  PROPS_MAX_PROP_TYPE_CHARS,
  PROPS_MAX_RAW_JSON_BYTES,
  PROPS_MAX_ROWS_PER_GAME,
  PROPS_MAX_VENDOR_CHARS,
} from '@/lib/ops/storage-growth-bounds';
import { AwsCurrentBoardStore, S3ObjectError } from '@/lib/props/s3-current-board/aws-store';
import {
  CURRENT_BOARD_CACHE_MAX_DECODED_BYTES,
  CURRENT_BOARD_DECODE_LIMITS,
  CURRENT_BOARD_MAX_COMPRESSED_BYTES,
  CURRENT_BOARD_MAX_UNCOMPRESSED_BYTES,
} from '@/lib/props/s3-current-board/bounds';
import { collectBoundedBytes, CompressedObjectTooLargeError } from '@/lib/props/s3-current-board/bounded-body';
import { pointerKey } from '@/lib/props/s3-current-board/pointer';
import { readCurrentBoard, type CurrentBoardReadTiming } from '@/lib/props/s3-current-board/read';
import { resetVerifiedSnapshotCacheForTests, snapshotCacheKey, VerifiedSnapshotCache } from '@/lib/props/s3-current-board/snapshot-cache';
import { buildCurrentQuickBuildRequest } from '@/lib/quick-builds/current-board';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockQueryOne = queryOne as ReturnType<typeof vi.fn>;

const GAME_DATE = '2026-11-23';
const TIP = '2026-11-24T00:00:00.000Z';
const OBSERVED = '2026-11-23T22:00:00.000Z';
const ENQUEUED = '2026-11-23T21:59:00.000Z';
const NOW = new Date('2026-11-23T22:05:00.000Z');

function row(playerId: number, line: string, over: number, under: number): BdlPlayerPropRow {
  return {
    id: playerId,
    game_id: 501,
    player_id: playerId,
    vendor: 'DraftKings',
    prop_type: 'points',
    line_value: line,
    market: { type: 'over_under', over_odds: over, under_odds: under },
    updated_at: '2026-11-23T21:50:00.000Z',
  };
}

function page(rows: BdlPlayerPropRow[]): ProviderPage {
  return { httpStatus: 200, payload: { data: rows, meta: { next_cursor: null } } };
}

function publishGame(
  store: InMemoryPrototypeStore,
  pullRunId: number,
  rows: BdlPlayerPropRow[],
  observedAt = OBSERVED,
): Promise<Awaited<ReturnType<typeof publishCurrentSnapshot>>> {
  const request: PublishRequest = {
    store,
    gameId: '501',
    bdlGameId: 501,
    gameDate: GAME_DATE,
    gameStartTime: TIP,
    pullRunId,
    pages: [page(rows)],
    observedAt,
    controllerEnqueuedAt: new Date(Date.parse(ENQUEUED) + pullRunId * 1000).toISOString(),
  };
  return publishCurrentSnapshot(request);
}

function isArchiveKey(key: string): boolean {
  return key.endsWith('.json.gz') && !key.endsWith('.publication.json');
}

function watch(inner: InMemoryPrototypeStore) {
  const keys: string[] = [];
  return {
    keys,
    archiveGets() {
      return keys.filter(isArchiveKey);
    },
    async get(key: string) {
      keys.push(key);
      return inner.get(key);
    },
  };
}

function streamOf(chunks: Uint8Array[], onRead?: () => void): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      onRead?.();
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index]);
      index += 1;
    },
  });
}

function bytes(length: number, fill = 7): Uint8Array {
  return new Uint8Array(length).fill(fill);
}

function xorshift(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state >>>= 0;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

function entropy(next: () => number, length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/';
  let out = '';
  for (let index = 0; index < length; index += 1) out += alphabet[next() % alphabet.length];
  return out;
}

describe('current-board reader bounds and verified snapshot cache', () => {
  beforeEach(() => {
    resetVerifiedSnapshotCacheForTests();
    vi.clearAllMocks();
    delete process.env.CURRENT_PROPS_SOURCE;
  });

  it('reads a cold archive, then serves the same verified snapshot without another archive fetch', async () => {
    const inner = new InMemoryPrototypeStore();
    await publishGame(inner, 2, [row(10, '22.5', -115, -105)]);
    const store = watch(inner);
    const timings: CurrentBoardReadTiming[] = [];
    const cold = await readCurrentBoard({
      store,
      gameId: '501',
      now: NOW.toISOString(),
      timing: (event) => timings.push(event),
    });
    const warm = await readCurrentBoard({
      store,
      gameId: '501',
      now: NOW.toISOString(),
      timing: (event) => timings.push(event),
    });
    expect(cold.available).toBe(true);
    expect(warm.available).toBe(true);
    if (!cold.available || !warm.available) return;
    expect(warm.rows).toEqual(cold.rows);
    expect(warm.observedAt).toBe(OBSERVED);
    expect(warm.snapshot.envelopeChecksum).toBe(cold.snapshot.envelopeChecksum);
    expect(store.archiveGets()).toHaveLength(1);
    expect(store.keys.filter((key) => key.endsWith('/pointer.json'))).toHaveLength(2);
    expect(store.keys.filter((key) => key.endsWith('.publication.json'))).toHaveLength(2);
    expect(timings.map((event) => event.cache)).toEqual(['miss', 'hit']);
    expect(timings[0].compressedBytes).toBeGreaterThan(0);
    expect(timings[0].decodedBytes).toBeGreaterThan(0);
    expect(timings[1].archiveMs).toBe(0);
    expect(timings[1].decompressMs).toBe(0);
    expect(timings[1].decodedBytes).toBe(timings[0].decodedBytes);
    expect(timings[1].result).toBe('fresh');
    console.info(JSON.stringify({
      event: 'current_board_local_fixture_timing',
      note: 'local fixture durations, not production percentiles',
      cold: timings[0],
      warm: timings[1],
    }));
  });

  it('does not let a caller mutate the cached snapshot', async () => {
    const inner = new InMemoryPrototypeStore();
    await publishGame(inner, 2, [row(10, '22.5', -115, -105)]);
    const store = watch(inner);
    const first = await readCurrentBoard({ store, gameId: '501', now: NOW.toISOString() });
    if (!first.available) throw new Error('board unavailable');
    first.rows[0].oddsAmerican = 1;
    first.rows[0].sportsbook = 'mutated';
    const second = await readCurrentBoard({ store, gameId: '501', now: NOW.toISOString() });
    expect(second.available && second.rows[0]).toMatchObject({ oddsAmerican: -115, sportsbook: 'draftkings' });
    expect(store.archiveGets()).toHaveLength(1);
  });

  it('loads the new archive when the pointer advances to a different checksum', async () => {
    const inner = new InMemoryPrototypeStore();
    await publishGame(inner, 2, [row(10, '22.5', -115, -105)]);
    const store = watch(inner);
    const first = await readCurrentBoard({ store, gameId: '501', now: NOW.toISOString() });
    await publishGame(inner, 4, [row(10, '24.5', -120, -100)], '2026-11-23T22:04:00.000Z');
    const second = await readCurrentBoard({ store, gameId: '501', now: NOW.toISOString() });
    expect(first.available && first.rows[0].line).toBe(22.5);
    expect(second.available && second.rows[0].line).toBe(24.5);
    expect(first.available && second.available && first.snapshot.envelopeChecksum).not.toBe(second.snapshot.envelopeChecksum);
    expect(store.archiveGets()).toHaveLength(2);
  });

  it('evicts the oldest verified snapshot when the decoded-byte budget is full', async () => {
    const inner = new InMemoryPrototypeStore();
    const sizes = new Map<string, number>();
    const probe = new VerifiedSnapshotCache(CURRENT_BOARD_CACHE_MAX_DECODED_BYTES);
    for (const gameId of [501, 502]) {
      await publishCurrentSnapshot({
        store: inner,
        gameId: String(gameId),
        bdlGameId: gameId,
        gameDate: GAME_DATE,
        gameStartTime: TIP,
        pullRunId: 2,
        pages: [page([{ ...row(10, '22.5', -115, -105), game_id: gameId }])],
        observedAt: OBSERVED,
        controllerEnqueuedAt: ENQUEUED,
      });
      await readCurrentBoard({
        store: inner,
        gameId: String(gameId),
        now: NOW.toISOString(),
        cache: probe,
        timing: (event) => {
          if (event.decodedBytes != null) sizes.set(String(gameId), event.decodedBytes);
        },
      });
    }
    const budget = Math.max(...sizes.values());
    const cache = new VerifiedSnapshotCache(budget);
    await readCurrentBoard({ store: inner, gameId: '501', now: NOW.toISOString(), cache });
    expect(cache.size).toBe(1);
    await readCurrentBoard({ store: inner, gameId: '502', now: NOW.toISOString(), cache });
    expect(cache.size).toBe(1);
    expect(cache.retained).toBe(sizes.get('502'));
    const restored = watch(inner);
    const again = await readCurrentBoard({ store: restored, gameId: '501', now: NOW.toISOString(), cache });
    expect(again.available && again.gameId).toBe('501');
    expect(restored.archiveGets()).toHaveLength(1);
    expect(cache.retained).toBeLessThanOrEqual(budget);
  });

  it('keeps one in-flight archive fetch for concurrent readers and does not cache a failed verify', async () => {
    const inner = new InMemoryPrototypeStore();
    const published = await publishGame(inner, 2, [row(10, '22.5', -115, -105)]);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const counts = { archive: 0, manifest: 0, pointer: 0 };
    const store = {
      async get(key: string) {
        const object = await inner.get(key);
        if (key.endsWith('/pointer.json')) counts.pointer += 1;
        else if (key.endsWith('.publication.json')) counts.manifest += 1;
        else if (isArchiveKey(key)) {
          counts.archive += 1;
          await gate;
        }
        return object;
      },
    };
    const cache = new VerifiedSnapshotCache(CURRENT_BOARD_CACHE_MAX_DECODED_BYTES);
    const pending = Promise.all([
      readCurrentBoard({ store, gameId: '501', now: NOW.toISOString(), cache }),
      readCurrentBoard({ store, gameId: '501', now: NOW.toISOString(), cache }),
    ]);
    for (let attempt = 0; attempt < 50 && !(counts.pointer >= 2 && counts.manifest >= 2 && counts.archive === 1); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(counts).toMatchObject({ pointer: 2, manifest: 2, archive: 1 });
    release();
    const [left, right] = await pending;
    expect(left.available && right.available).toBe(true);
    expect(cache.size).toBe(1);
    expect(counts.archive).toBe(1);

    const archive = await inner.get(published.archiveKey!);
    archive!.body[archive!.body.length - 1] ^= 0xff;
    const failed = new VerifiedSnapshotCache(CURRENT_BOARD_CACHE_MAX_DECODED_BYTES);
    const broken = watch(inner);
    const first = await readCurrentBoard({ store: broken, gameId: '501', now: NOW.toISOString(), cache: failed });
    const second = await readCurrentBoard({ store: broken, gameId: '501', now: NOW.toISOString(), cache: failed });
    expect(first).toMatchObject({ available: false, reason: 'unavailable' });
    expect(second).toMatchObject({ available: false, reason: 'unavailable' });
    expect(failed.size).toBe(0);
    expect(broken.archiveGets()).toHaveLength(2);
  });

  it('returns a board that exceeds the cache budget and does not retain it', async () => {
    const inner = new InMemoryPrototypeStore();
    await publishGame(inner, 2, [row(10, '22.5', -115, -105)]);
    const store = watch(inner);
    const cache = new VerifiedSnapshotCache(1);
    const first = await readCurrentBoard({ store, gameId: '501', now: NOW.toISOString(), cache });
    const second = await readCurrentBoard({ store, gameId: '501', now: NOW.toISOString(), cache });
    expect(first.available && second.available).toBe(true);
    expect(cache.size).toBe(0);
    expect(cache.retained).toBe(0);
    expect(store.archiveGets()).toHaveLength(2);
    expect(CURRENT_BOARD_CACHE_MAX_DECODED_BYTES).toBe(32 * 1024 * 1024);
  });

  it('rejects a missing, low, or high ContentLength without truncating the body', async () => {
    const small = bytes(20, 4);
    const missing = await collectBoundedBytes(
      { transformToWebStream: () => streamOf([small]) },
      undefined,
      100,
    );
    expect(missing).toEqual(Buffer.from(small));

    let reads = 0;
    const low = await collectBoundedBytes(
      { transformToWebStream: () => streamOf([small], () => { reads += 1; }) },
      1,
      100,
    );
    expect(low).toEqual(Buffer.from(small));
    expect(reads).toBeGreaterThan(0);
    const exact = await collectBoundedBytes(
      { transformToWebStream: () => streamOf([small]) },
      small.byteLength,
      100,
    );
    expect(exact).toEqual(Buffer.from(small));
    const high = await collectBoundedBytes(
      { transformToWebStream: () => streamOf([small]) },
      80,
      100,
    );
    expect(high).toEqual(Buffer.from(small));

    const over = bytes(CURRENT_BOARD_MAX_COMPRESSED_BYTES + 1, 9);
    await expect(collectBoundedBytes(
      { transformToWebStream: () => streamOf([over]) },
      undefined,
      CURRENT_BOARD_MAX_COMPRESSED_BYTES,
    )).rejects.toBeInstanceOf(CompressedObjectTooLargeError);

    let opened = false;
    await expect(collectBoundedBytes(
      { transformToWebStream: () => streamOf([bytes(1)], () => { opened = true; }) },
      CURRENT_BOARD_MAX_COMPRESSED_BYTES + 1,
      CURRENT_BOARD_MAX_COMPRESSED_BYTES,
    )).rejects.toBeInstanceOf(CompressedObjectTooLargeError);
    expect(opened).toBe(false);

    const client = {
      async send() {
        return {
          ContentLength: 8,
          ETag: '"etag"',
          Metadata: {},
          Body: { transformToWebStream: () => streamOf([over]) },
        };
      },
    };
    const aws = new AwsCurrentBoardStore({
      bucket: 'isolated-bucket',
      client: client as unknown as S3Client,
    });
    await expect(aws.get(pointerKey('501'))).rejects.toBeInstanceOf(S3ObjectError);
  });

  it('rejects an oversized, truncated, or malformed archive before parse and does not cache it', async () => {
    const huge = gzipSync(Buffer.alloc(CURRENT_BOARD_MAX_UNCOMPRESSED_BYTES + 1, 0x61));
    expect(huge.length).toBeLessThan(CURRENT_BOARD_MAX_COMPRESSED_BYTES);
    expect(() => openEnvelope(huge, CURRENT_BOARD_DECODE_LIMITS)).toThrow(/archive_too_large/);

    const inner = new InMemoryPrototypeStore();
    const published = await publishGame(inner, 2, [row(10, '22.5', -115, -105)]);
    const valid = Buffer.from((await inner.get(published.archiveKey!))!.body);
    const cache = new VerifiedSnapshotCache(CURRENT_BOARD_CACHE_MAX_DECODED_BYTES);
    const archive = (await inner.get(published.archiveKey!))!;
    archive.body = huge;
    const inflated = await readCurrentBoard({ store: inner, gameId: '501', now: NOW.toISOString(), cache });
    expect(inflated).toMatchObject({ available: false, reason: 'unavailable' });

    archive.body = valid.subarray(0, Math.max(2, valid.length - 5));
    const truncated = await readCurrentBoard({ store: inner, gameId: '501', now: NOW.toISOString(), cache });
    expect(truncated).toMatchObject({ available: false, reason: 'unavailable' });
    expect(() => openEnvelope(archive.body, CURRENT_BOARD_DECODE_LIMITS)).toThrow();
    try {
      openEnvelope(archive.body, CURRENT_BOARD_DECODE_LIMITS);
    } catch (error) {
      expect((error as Error).message).not.toBe('archive_too_large');
    }

    archive.body = Buffer.from([0x1f, 0x8b, 0x00, 0x00]);
    const malformed = await readCurrentBoard({ store: inner, gameId: '501', now: NOW.toISOString(), cache });
    expect(malformed).toMatchObject({ available: false, reason: 'unavailable' });
    expect(cache.size).toBe(0);

    const compressed = Buffer.alloc(CURRENT_BOARD_MAX_COMPRESSED_BYTES + 1, 1);
    expect(() => openEnvelope(compressed, CURRENT_BOARD_DECODE_LIMITS)).toThrow(/archive_too_large/);
  });

  it('rejects a manifest or checksum that does not match the pointer', async () => {
    const inner = new InMemoryPrototypeStore();
    const published = await publishGame(inner, 2, [row(10, '22.5', -115, -105)]);
    const cache = new VerifiedSnapshotCache(CURRENT_BOARD_CACHE_MAX_DECODED_BYTES);
    const manifest = (await inner.get(published.manifestKey!))!;
    manifest.body = Buffer.from(manifest.body.toString('utf8').replace(published.archiveKey!, 'raw/other.json.gz'));
    const mismatched = await readCurrentBoard({ store: inner, gameId: '501', now: NOW.toISOString(), cache });
    expect(mismatched).toMatchObject({ available: false, reason: 'unavailable' });
    expect(cache.size).toBe(0);

    const fresh = new InMemoryPrototypeStore();
    const again = await publishGame(fresh, 2, [row(10, '22.5', -115, -105)]);
    const pointer = (await fresh.get(pointerKey('501')))!;
    const parsed = JSON.parse(pointer.body.toString('utf8')) as { envelopeChecksum: string };
    parsed.envelopeChecksum = 'ab'.repeat(32);
    pointer.body = Buffer.from(JSON.stringify(parsed));
    const conflict = await readCurrentBoard({ store: fresh, gameId: '501', now: NOW.toISOString(), cache });
    expect(conflict).toMatchObject({ available: false, reason: 'unavailable' });
    expect(cache.size).toBe(0);
    expect(again.published).toBe(true);
  });

  it('stops serving a cached board once the observation is stale or the game has tipped', async () => {
    const inner = new InMemoryPrototypeStore();
    await publishGame(inner, 2, [row(10, '22.5', -115, -105)]);
    const store = watch(inner);
    const fresh = await readCurrentBoard({ store, gameId: '501', now: NOW.toISOString() });
    const stale = await readCurrentBoard({
      store,
      gameId: '501',
      now: new Date(Date.parse(OBSERVED) + 30 * 60 * 1000 + 1).toISOString(),
    });
    const expired = await readCurrentBoard({ store, gameId: '501', now: TIP });
    expect(fresh.available && fresh.observedAt).toBe(OBSERVED);
    expect(stale).toMatchObject({ available: false, reason: 'stale' });
    expect(expired).toMatchObject({ available: false, reason: 'expired' });
    expect(store.archiveGets()).toHaveLength(1);
  });

  it('fails closed on a missing or invalid pointer', async () => {
    const empty = new InMemoryPrototypeStore();
    expect(await readCurrentBoard({ store: empty, gameId: '501', now: NOW.toISOString() })).toMatchObject({
      available: false,
      reason: 'missing',
    });
    await empty.put(pointerKey('501'), Buffer.from('{'), {}, { kind: 'if-none-match', etag: '*' });
    expect(await readCurrentBoard({ store: empty, gameId: '501', now: NOW.toISOString() })).toMatchObject({
      available: false,
      reason: 'unavailable',
    });
    expect(await readCurrentBoard({ store: empty, gameId: 'not-a-game', now: NOW.toISOString() })).toMatchObject({
      available: false,
      reason: 'unavailable',
    });
  });

  it('does not fall back to PostgreSQL when the current-board read fails', async () => {
    process.env.CURRENT_PROPS_SOURCE = 's3';
    mockQuery.mockImplementation(async (sql: string) => {
      if (/player_props_current|player_prop_snapshots|player_prop_game_runs/i.test(sql)) {
        throw new Error('postgres props read');
      }
      return [];
    });
    mockQueryOne.mockResolvedValue({ start_time: TIP, away_abbr: 'BOS', home_abbr: 'NYK' });
    const result = await getPlayerPropsForExplorer({
      dateEt: GAME_DATE,
      todayEt: GAME_DATE,
      gameId: '501',
      now: NOW,
      limit: 100,
      offset: 0,
      store: {
        async get() {
          throw new Error('s3 down');
        },
      },
    });
    expect(result.sourceTable).toBe('s3.player_prop_current');
    expect(result.rows).toEqual([]);
    expect(result.marketContext).toBe('live');
    const sql = mockQuery.mock.calls.map((call) => String(call[0]));
    expect(sql.some((text) => /player_props_current/i.test(text))).toBe(false);
  });

  it('keeps the Props Explorer rows and the Quick Build observation clock on the verified board', async () => {
    process.env.CURRENT_PROPS_SOURCE = 's3';
    const inner = new InMemoryPrototypeStore();
    await publishGame(inner, 2, [row(10, '22.5', -115, -105)]);
    const store = watch(inner);
    mockQueryOne.mockResolvedValue({ start_time: TIP, away_abbr: 'BOS', home_abbr: 'NYK' });
    mockQuery.mockImplementation(async (sql: string) => {
      if (/player_props_current|player_prop_snapshots|player_prop_game_runs/i.test(sql)) {
        throw new Error('postgres props read');
      }
      if (sql.includes('analytics.players')) return [{ player_id: '10', full_name: 'Player Ten' }];
      return [];
    });
    const explorer = await getPlayerPropsForExplorer({
      dateEt: GAME_DATE,
      todayEt: GAME_DATE,
      gameId: '501',
      now: NOW,
      limit: 100,
      offset: 0,
      store,
    });
    const again = await getPlayerPropsForExplorer({
      dateEt: GAME_DATE,
      todayEt: GAME_DATE,
      gameId: '501',
      now: NOW,
      limit: 100,
      offset: 0,
      store,
    });
    expect(explorer.sourceTable).toBe('s3.player_prop_current');
    expect(explorer.rows.map((item) => [item.playerId, item.side, item.oddsAmerican, item.snapshotAt])).toEqual([
      [10, 'over', -115, OBSERVED],
      [10, 'under', -105, OBSERVED],
    ]);
    expect(again.rows).toEqual(explorer.rows);
    const quick = await buildCurrentQuickBuildRequest({
      sportsbook: 'draftkings',
      preset: 'balanced',
      now: NOW,
      games: [{ gameId: '501', startTime: TIP, status: 'scheduled' }],
      store,
    });
    expect(quick.policy.maxObservationAgeMs).toBe(30 * 60 * 1000);
    expect(quick.observations.map((item) => item.observedAt)).toEqual([OBSERVED, OBSERVED]);
    expect(quick.attempts[0].completedAt).toBe(OBSERVED);
    expect(store.archiveGets()).toHaveLength(1);
  });

  it('keeps distinct archives on distinct in-flight reads and releases evicted entries', async () => {
    expect(snapshotCacheKey('a\nb', 'c')).not.toBe(snapshotCacheKey('a', 'b\nc'));
    const inner = new InMemoryPrototypeStore();
    for (const gameId of [501, 502]) {
      await publishCurrentSnapshot({
        store: inner,
        gameId: String(gameId),
        bdlGameId: gameId,
        gameDate: GAME_DATE,
        gameStartTime: TIP,
        pullRunId: 2,
        pages: [page([{ ...row(10, '22.5', -115, -105), game_id: gameId }])],
        observedAt: OBSERVED,
        controllerEnqueuedAt: ENQUEUED,
      });
    }
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let archives = 0;
    const store = {
      async get(key: string) {
        const object = await inner.get(key);
        if (isArchiveKey(key)) {
          archives += 1;
          await gate;
        }
        return object;
      },
    };
    const cache = new VerifiedSnapshotCache(CURRENT_BOARD_CACHE_MAX_DECODED_BYTES);
    const pending = Promise.all([
      readCurrentBoard({ store, gameId: '501', now: NOW.toISOString(), cache }),
      readCurrentBoard({ store, gameId: '502', now: NOW.toISOString(), cache }),
    ]);
    for (let attempt = 0; attempt < 50 && archives < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(archives).toBe(2);
    release();
    const boards = await pending;
    expect(boards.every((board) => board.available)).toBe(true);
    expect(cache.size).toBe(2);

    const tight = new VerifiedSnapshotCache(100);
    const older = {
      archiveKey: 'raw/older.json.gz',
      envelopeChecksum: 'a'.repeat(64),
      envelope: { marker: 'older' },
      decodedBytes: 40,
    };
    const newer = {
      archiveKey: 'raw/newer.json.gz',
      envelopeChecksum: 'b'.repeat(64),
      envelope: { marker: 'newer' },
      decodedBytes: 70,
    };
    expect(tight.remember(older as never)).toBe(true);
    expect(tight.remember(newer as never)).toBe(true);
    expect(tight.peek(older.archiveKey, older.envelopeChecksum)).toBeNull();
    expect(tight.retained).toBe(70);
    expect(tight.retained).toBeLessThanOrEqual(100);
  });

  it('publishes a high-entropy max board that the old compressed cap would reject', async () => {
    const next = xorshift(0x5eed);
    const rows: BdlPlayerPropRow[] = [];
    for (let index = 0; index < PROPS_MAX_ROWS_PER_GAME; index += 1) {
      const vendor = entropy(next, PROPS_MAX_VENDOR_CHARS);
      const propType = entropy(next, PROPS_MAX_PROP_TYPE_CHARS);
      const playerName = entropy(next, PROPS_MAX_PLAYER_NAME_CHARS);
      const base = {
        id: index + 1,
        game_id: 501,
        player_id: 100000 + (index % 450),
        vendor,
        prop_type: propType,
        line_value: String((index % 80) / 2),
        market: { type: 'milestone' as const, odds: -400 + (index % 700) },
        updated_at: `2026-11-23T21:${String(index % 60).padStart(2, '0')}:${String((index * 3) % 60).padStart(2, '0')}.000Z`,
        player_name: playerName,
      };
      const bare = Buffer.byteLength(JSON.stringify(base));
      const payload = bare < PROPS_MAX_RAW_JSON_BYTES
        ? entropy(next, PROPS_MAX_RAW_JSON_BYTES - bare - ',"payload":""'.length)
        : entropy(next, 8);
      rows.push({ ...base, payload });
    }
    const rawSizes = rows.map((item) => Buffer.byteLength(JSON.stringify(item)));
    expect(Math.max(...rawSizes)).toBeGreaterThanOrEqual(PROPS_MAX_RAW_JSON_BYTES - 8);
    const store = new InMemoryPrototypeStore();
    const published = await publishCurrentSnapshot({
      store,
      gameId: '501',
      bdlGameId: 501,
      gameDate: GAME_DATE,
      gameStartTime: TIP,
      pullRunId: 9,
      pages: [{ httpStatus: 200, payload: { data: rows, meta: { next_cursor: null } } }],
      observedAt: OBSERVED,
      controllerEnqueuedAt: ENQUEUED,
    });
    expect(published.published).toBe(true);
    const archive = await store.get(published.archiveKey!);
    expect(archive!.body.length).toBeGreaterThan(HISTORICAL_BOARD_MAX_COMPRESSED_BYTES);
    expect(archive!.body.length).toBeLessThanOrEqual(CURRENT_BOARD_MAX_COMPRESSED_BYTES);
    const workerRead = new AwsCurrentBoardStore({
      bucket: 'isolated-bucket',
      client: {
        async send() {
          return {
            ContentLength: archive!.body.length,
            ETag: '"worker-read-back"',
            Metadata: {},
            Body: { transformToByteArray: async () => archive!.body },
          };
        },
      } as unknown as S3Client,
    });
    const reread = await workerRead.get(published.archiveKey!);
    expect(reread!.body.equals(archive!.body)).toBe(true);
    const bounded = await collectBoundedBytes(
      { transformToByteArray: async () => archive!.body },
      archive!.body.length,
      CURRENT_BOARD_MAX_COMPRESSED_BYTES,
    );
    const opened = openEnvelope(bounded, CURRENT_BOARD_DECODE_LIMITS);
    expect(opened.envelope.row_count).toBe(PROPS_MAX_ROWS_PER_GAME);
    expect(opened.uncompressedBytes).toBeGreaterThan(HISTORICAL_BOARD_MAX_UNCOMPRESSED_BYTES);
    expect(opened.uncompressedBytes).toBeLessThanOrEqual(CURRENT_BOARD_MAX_UNCOMPRESSED_BYTES);
    expect(opened.uncompressedBytes).toBeGreaterThan(CURRENT_BOARD_CACHE_MAX_DECODED_BYTES);
    const reads = watch(store);
    const cache = new VerifiedSnapshotCache(CURRENT_BOARD_CACHE_MAX_DECODED_BYTES);
    const first = await readCurrentBoard({ store: reads, gameId: '501', now: NOW.toISOString(), cache });
    const second = await readCurrentBoard({ store: reads, gameId: '501', now: NOW.toISOString(), cache });
    expect(first.available && second.available).toBe(true);
    expect(cache.size).toBe(0);
    expect(reads.archiveGets()).toHaveLength(2);
    if (first.available) first.rows[0].oddsAmerican = 1;
    expect(second.available && second.rows[0].oddsAmerican).not.toBe(1);
    console.info(JSON.stringify({
      event: 'current_board_high_entropy_fixture',
      note: 'documented field caps, not a production percentile',
      rows: PROPS_MAX_ROWS_PER_GAME,
      compressedBytes: archive!.body.length,
      decodedBytes: opened.uncompressedBytes,
      compressedCap: CURRENT_BOARD_MAX_COMPRESSED_BYTES,
      decompressedCap: CURRENT_BOARD_MAX_UNCOMPRESSED_BYTES,
      cacheBudget: CURRENT_BOARD_CACHE_MAX_DECODED_BYTES,
    }));
  }, 180_000);

  it('admits a publisher-max board under the current caps and rejects the historical decompressed cap', () => {
    const prefix = '{"payload":"';
    const suffix = '"}';
    const fill = PROPS_MAX_RAW_JSON_BYTES - Buffer.byteLength(prefix + suffix);
    const raw = { payload: 'x'.repeat(fill) };
    expect(Buffer.byteLength(JSON.stringify(raw))).toBe(PROPS_MAX_RAW_JSON_BYTES);
    const rows: PlayerPropArchiveRow[] = Array.from({ length: PROPS_MAX_ROWS_PER_GAME }, (_, index) => ({
      game_id: '501',
      source_game_id: 501,
      player_id: String(index),
      source_player_id: index,
      player_name: 'N'.repeat(PROPS_MAX_PLAYER_NAME_CHARS),
      team_id: '1',
      opponent_id: '2',
      sportsbook: 'V'.repeat(PROPS_MAX_VENDOR_CHARS),
      prop_type: 'P'.repeat(PROPS_MAX_PROP_TYPE_CHARS),
      market_type: 'M'.repeat(PROPS_MAX_MARKET_CHARS),
      side: index % 2 === 0 ? 'over' : 'under',
      line_value: 22.5,
      odds_american: -110,
      odds_decimal: 1.909,
      implied_probability: 0.524,
      snapshot_at: OBSERVED,
      game_start_time: TIP,
      source: 'balldontlie',
      pull_run_id: 2,
      game_run_id: '2:501',
      provider_updated_at: OBSERVED,
      raw_json: raw,
    }));
    const envelope = buildArchiveEnvelope({
      season: 2026,
      pullRunId: 2,
      gameId: '501',
      sourceGameId: 501,
      gameDate: GAME_DATE,
      snapshotAt: OBSERVED,
      gameStartTime: TIP,
      rows,
      observation: { observedAt: OBSERVED, controllerEnqueuedAt: ENQUEUED },
    });
    const jsonBytes = Buffer.byteLength(`${JSON.stringify(envelope)}\n`);
    const compressed = gzipEnvelope(envelope);
    expect(jsonBytes).toBeGreaterThan(HISTORICAL_BOARD_MAX_UNCOMPRESSED_BYTES);
    expect(jsonBytes).toBeLessThanOrEqual(CURRENT_BOARD_MAX_UNCOMPRESSED_BYTES);
    expect(compressed.length).toBeLessThanOrEqual(CURRENT_BOARD_MAX_COMPRESSED_BYTES);
    expect(compressed.length).toBeLessThanOrEqual(HISTORICAL_BOARD_MAX_COMPRESSED_BYTES);
    const opened = openEnvelope(compressed, CURRENT_BOARD_DECODE_LIMITS);
    expect(opened.uncompressedBytes).toBe(jsonBytes);
    expect(opened.envelope.row_count).toBe(PROPS_MAX_ROWS_PER_GAME);
    expect(() => openEnvelope(compressed, {
      maxCompressedBytes: HISTORICAL_BOARD_MAX_COMPRESSED_BYTES,
      maxUncompressedBytes: HISTORICAL_BOARD_MAX_UNCOMPRESSED_BYTES,
    })).toThrow(/archive_too_large/);
    console.info(JSON.stringify({
      event: 'current_board_publisher_max_fixture',
      note: 'local size check, not a production measurement',
      rows: PROPS_MAX_ROWS_PER_GAME,
      jsonBytes,
      compressedBytes: compressed.length,
      decompressedCap: CURRENT_BOARD_MAX_UNCOMPRESSED_BYTES,
      compressedCap: CURRENT_BOARD_MAX_COMPRESSED_BYTES,
    }));
  }, 120_000);

  it('emits timing without the market payload', async () => {
    const inner = new InMemoryPrototypeStore();
    await publishGame(inner, 2, [row(10, '22.5', -115, -105)]);
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await readCurrentBoard({ store: inner, gameId: '501', now: NOW.toISOString() });
    const line = spy.mock.calls.map((call) => String(call[0])).find((text) => text.includes('current_board_read'));
    expect(line).toBeTruthy();
    const event = JSON.parse(line!) as CurrentBoardReadTiming;
    expect(event.cache).toBe('miss');
    expect(event.result).toBe('fresh');
    expect(line).not.toContain('DraftKings');
    expect(line).not.toContain('accessToken');
    expect(Object.keys(event)).not.toContain('rows');
    spy.mockRestore();
  });
});
