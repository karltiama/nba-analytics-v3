import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { gunzipEnvelope } from '../../player-prop-snapshot-archive';
import { manifestProblem, sealManifest, type PublicationManifest } from '../manifest';
import { measurePublication } from '../measure';
import { PROPS_PAGE_CAP, validateProviderPull, type ProviderPage } from '../pages';
import { publishCurrentSnapshot, type PublishRequest } from '../publish';
import { evaluateCurrentQuickBuilds } from '../quick-builds';
import { readCurrentBoard } from '../reader';
import { IN_MEMORY_S3_DIFFERENCES, InMemoryPrototypeStore } from '../store';
import { highVolumePropsMarketWrites } from '../writes';
import type { BdlPlayerPropRow } from '../../types';

const GAME = '501';
const BDL_GAME = 501;
const GAME_DATE = '2026-11-23';
const TIP = '2026-11-24T00:00:00.000Z';
const OBSERVED = '2026-11-23T22:00:00.000Z';
const ENQUEUED = '2026-11-23T21:59:00.000Z';
const NOW = '2026-11-23T22:05:00.000Z';

function row(playerId: number, line: string, over: number, under: number, vendor = 'DraftKings', prop = 'points'): BdlPlayerPropRow {
  return {
    id: playerId,
    game_id: BDL_GAME,
    player_id: playerId,
    vendor,
    prop_type: prop,
    line_value: line,
    market: { type: 'over_under', over_odds: over, under_odds: under },
    updated_at: '2026-11-23T21:50:00.000Z',
  };
}

function page(rows: BdlPlayerPropRow[], next: number | null = null): ProviderPage {
  return { httpStatus: 200, payload: { data: rows, meta: { next_cursor: next } } };
}

function request(partial: Partial<PublishRequest> & { store: InMemoryPrototypeStore }): PublishRequest {
  return {
    gameId: GAME,
    bdlGameId: BDL_GAME,
    gameDate: GAME_DATE,
    gameStartTime: TIP,
    pullRunId: 2,
    pages: [page([row(10, '22.5', -115, -105), row(11, '18.5', -110, -110)])],
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

describe('F39B current props board', () => {
  it('documents the in-memory difference from S3', () => {
    expect(IN_MEMORY_S3_DIFFERENCES).toEqual([
      'synchronous map instead of in-flight S3 requests',
      '412 by default, 409 only when a test forces it',
      'etag is sha256 of the body, not md5',
      'no list, versioning, replication delay, or 403',
      'metadata keys are not lowercased or prefixed',
    ]);
  });

  it('archives a complete snapshot and reads the same rows back', async () => {
    const store = new InMemoryPrototypeStore();
    const published = await publishCurrentSnapshot(request({ store }));
    expect(published.published).toBe(true);
    const object = await store.get(published.archiveKey!);
    const envelope = gunzipEnvelope(object!.body);
    expect(envelope.archiveVersion).toBe('player_prop_snapshots.v1');
    expect(envelope.rows).toHaveLength(4);
    const board = await readCurrentBoard({ store, gameId: GAME, now: NOW });
    expect(board.available).toBe(true);
    if (!board.available) return;
    expect(board.snapshotClass).toBe('current_stored_snapshot');
    expect(board.observedAt).toBe(OBSERVED);
    expect(board.rows.map((item) => [item.playerId, item.side, item.line, item.oddsAmerican])).toEqual([
      ['10', 'over', 22.5, -115],
      ['10', 'under', 22.5, -105],
      ['11', 'over', 18.5, -110],
      ['11', 'under', 18.5, -110],
    ]);
    expect(board.completeness).toMatchObject({ status: 'complete', rowsFetched: 2, rowCount: 4, cursorClosed: true });
  });

  it('rejects a manifest whose checksum or row count was changed', () => {
    const store = new InMemoryPrototypeStore();
    return publishCurrentSnapshot(request({ store })).then(async (published) => {
      const object = await store.get(published.manifestKey!);
      const manifest = JSON.parse(object!.body.toString('utf8')) as PublicationManifest;
      expect(manifestProblem({ ...manifest, manifestChecksum: '0'.repeat(64) })).toMatch(/checksum/);
      expect(manifestProblem({ ...manifest, rowCount: manifest.rowCount + 1, manifestChecksum: manifest.manifestChecksum })).toMatch(/checksum/);
      const tampered = sealManifest({ ...manifest, rowCount: 1 });
      object!.body = Buffer.from(`${JSON.stringify({ ...tampered, rowCount: 99, manifestChecksum: tampered.manifestChecksum })}\n`);
      const board = await readCurrentBoard({ store, gameId: GAME, now: NOW });
      expect(board).toMatchObject({ available: false, snapshotClass: null, reason: 'unavailable' });
    });
  });

  it('replaces the pointer with a newer snapshot and keeps an older one from replacing it', async () => {
    const store = new InMemoryPrototypeStore();
    const first = await publishCurrentSnapshot(request({ store, pullRunId: 2 }));
    const newer = await publishCurrentSnapshot(request({
      store,
      pullRunId: 3,
      observedAt: '2026-11-23T22:10:00.000Z',
      controllerEnqueuedAt: '2026-11-23T22:09:00.000Z',
      pages: [page([row(10, '24.5', -120, -100)])],
    }));
    expect(newer.published).toBe(true);
    const older = await publishCurrentSnapshot(request({
      store,
      pullRunId: 1,
      observedAt: '2026-11-23T21:00:00.000Z',
      controllerEnqueuedAt: '2026-11-23T20:59:00.000Z',
      pages: [page([row(10, '10.5', -130, -110)])],
    }));
    expect(older.published).toBe(false);
    expect(older.reason).toBe('older_snapshot');
    const board = await readCurrentBoard({ store, gameId: GAME, now: '2026-11-23T22:12:00.000Z' });
    expect(board.available && board.snapshot.archiveKey).toBe(newer.archiveKey);
    expect(await store.get(first.archiveKey!)).not.toBeNull();
    expect(await store.get(older.archiveKey!)).not.toBeNull();
  });

  it('uses pull_run_id when the observation time is equal', async () => {
    const store = new InMemoryPrototypeStore();
    await publishCurrentSnapshot(request({ store, pullRunId: 4 }));
    const lower = await publishCurrentSnapshot(request({
      store,
      pullRunId: 3,
      controllerEnqueuedAt: '2026-11-23T21:58:00.000Z',
    }));
    expect(lower.reason).toBe('older_snapshot');
    const higher = await publishCurrentSnapshot(request({
      store,
      pullRunId: 9,
      controllerEnqueuedAt: '2026-11-23T21:58:30.000Z',
      pages: [page([row(12, '15.5', -108, -112)])],
    }));
    expect(higher.published).toBe(true);
    const board = await readCurrentBoard({ store, gameId: GAME, now: NOW });
    expect(board.available && board.snapshot.pullRunId).toBe(9);
  });

  it('treats a 409 conflict as a reread and does not let the older writer win', async () => {
    const store = new InMemoryPrototypeStore();
    store.holdPointerPuts = 2;
    const newer = publishCurrentSnapshot(request({
      store,
      pullRunId: 8,
      observedAt: '2026-11-23T22:20:00.000Z',
      controllerEnqueuedAt: '2026-11-23T22:19:00.000Z',
      pages: [page([row(10, '25.5', -125, -105)])],
    }));
    const older = publishCurrentSnapshot(request({
      store,
      pullRunId: 7,
      observedAt: '2026-11-23T22:15:00.000Z',
      controllerEnqueuedAt: '2026-11-23T22:14:00.000Z',
      pages: [page([row(10, '21.5', -101, -119)])],
    }));
    await until(() => store.waitingPointerPuts() === 2);
    store.nextConflictStatus = 409;
    store.releasePointerPuts();
    const [newerResult, olderResult] = await Promise.all([newer, older]);
    expect(newerResult.published).toBe(true);
    expect(olderResult.published).toBe(false);
    const board = await readCurrentBoard({ store, gameId: GAME, now: '2026-11-23T22:21:00.000Z' });
    expect(board.available && board.rows.map((item) => item.line)).toEqual([25.5, 25.5]);
  });

  it('lets a newer observation replace a pointer that won the first race', async () => {
    const store = new InMemoryPrototypeStore();
    store.holdPointerPuts = 2;
    const older = publishCurrentSnapshot(request({
      store,
      pullRunId: 5,
      observedAt: '2026-11-23T22:10:00.000Z',
      controllerEnqueuedAt: '2026-11-23T22:09:00.000Z',
    }));
    const newer = publishCurrentSnapshot(request({
      store,
      pullRunId: 6,
      observedAt: '2026-11-23T22:20:00.000Z',
      controllerEnqueuedAt: '2026-11-23T22:19:00.000Z',
      pages: [page([row(11, '19.5', -111, -109)])],
    }));
    await until(() => store.waitingPointerPuts() === 2);
    store.releasePointerPuts();
    const [olderResult, newerResult] = await Promise.all([older, newer]);
    expect(olderResult.published).toBe(true);
    expect(newerResult.published).toBe(true);
    const board = await readCurrentBoard({ store, gameId: GAME, now: '2026-11-23T22:21:00.000Z' });
    expect(board.available && board.snapshot.pullRunId).toBe(6);
  });

  it('drops a removed line instead of merging it into the next board', async () => {
    const store = new InMemoryPrototypeStore();
    await publishCurrentSnapshot(request({ store }));
    await publishCurrentSnapshot(request({
      store,
      pullRunId: 4,
      observedAt: '2026-11-23T22:30:00.000Z',
      controllerEnqueuedAt: '2026-11-23T22:29:00.000Z',
      pages: [page([row(11, '18.5', -110, -110)])],
    }));
    const board = await readCurrentBoard({ store, gameId: GAME, now: '2026-11-23T22:31:00.000Z' });
    expect(board.available && board.rows.map((item) => item.playerId)).toEqual(['11', '11']);
  });

  it('refuses an incomplete page, a repeated cursor, a foreign game, and the page cap', async () => {
    const store = new InMemoryPrototypeStore();
    const bad = await publishCurrentSnapshot(request({ store, pages: [{ httpStatus: 500, payload: {} }] }));
    const repeated = await publishCurrentSnapshot(request({
      store,
      pages: [page([row(10, '22.5', -110, -110)], 7), page([row(10, '22.5', -110, -110)], 7)],
    }));
    const foreign = await publishCurrentSnapshot(request({
      store,
      pages: [page([{ ...row(10, '22.5', -110, -110), game_id: 999 }])],
    }));
    const capped = await publishCurrentSnapshot(request({
      store,
      pages: Array.from({ length: PROPS_PAGE_CAP }, (_, index) => page([row(10, '22.5', -110, -110)], index + 1)),
    }));
    expect([bad, repeated, foreign, capped].map((result) => result.reason)).toEqual([
      'incomplete_pagination',
      'incomplete_pagination',
      'incomplete_pagination',
      'incomplete_pagination',
    ]);
    expect(await readCurrentBoard({ store, gameId: GAME, now: NOW })).toMatchObject({ available: false, reason: 'missing' });
    const truncated = validateProviderPull(
      Array.from({ length: PROPS_PAGE_CAP }, (_, index) => page([row(10, '22.5', -110, -110)], index + 1)),
      BDL_GAME
    );
    expect(truncated.ok).toBe(false);
    if (!truncated.ok) expect(truncated.evidence.truncatedAtCap).toBe(true);
  });

  it('archives a post-tip pull and does not make it current', async () => {
    const store = new InMemoryPrototypeStore();
    const result = await publishCurrentSnapshot(request({ store, observedAt: TIP }));
    expect(result.published).toBe(false);
    expect(result.reason).toBe('post_tip');
    expect(await store.get(result.archiveKey!)).not.toBeNull();
    expect(await readCurrentBoard({ store, gameId: GAME, now: TIP })).toMatchObject({ available: false, reason: 'missing' });
  });

  it('withholds a stale pointer and an expired pointer, and keeps the archive', async () => {
    const store = new InMemoryPrototypeStore();
    const published = await publishCurrentSnapshot(request({ store }));
    const stale = await readCurrentBoard({
      store,
      gameId: GAME,
      now: '2026-11-23T22:30:00.001Z',
    });
    const expired = await readCurrentBoard({ store, gameId: GAME, now: TIP });
    expect(stale).toMatchObject({ available: false, snapshotClass: null, reason: 'stale' });
    expect(expired).toMatchObject({ available: false, snapshotClass: null, reason: 'expired' });
    expect(await store.get(published.archiveKey!)).not.toBeNull();
  });

  it('does not serve an archive that the pointer does not name', async () => {
    const store = new InMemoryPrototypeStore();
    const first = await publishCurrentSnapshot(request({ store, pullRunId: 2 }));
    const second = await publishCurrentSnapshot(request({
      store,
      pullRunId: 3,
      observedAt: '2026-11-23T22:10:00.000Z',
      controllerEnqueuedAt: '2026-11-23T22:09:00.000Z',
      pages: [page([row(12, '30.5', -140, 110)])],
    }));
    const board = await readCurrentBoard({ store, gameId: GAME, now: '2026-11-23T22:11:00.000Z' });
    expect(board.available && board.snapshot.archiveKey).toBe(second.archiveKey);
    expect(board.available && board.rows.some((item) => item.playerId === '10')).toBe(false);
    const historical = gunzipEnvelope((await store.get(first.archiveKey!))!.body);
    expect(historical.rows.some((item) => item.player_id === '10')).toBe(true);
    expect(readCurrentBoard.length).toBe(1);
  });

  it('does not overwrite an archive when the same key arrives with different rows', async () => {
    const store = new InMemoryPrototypeStore();
    const first = await publishCurrentSnapshot(request({ store }));
    const original = Buffer.from((await store.get(first.archiveKey!))!.body);
    const conflict = await publishCurrentSnapshot(request({
      store,
      pages: [page([row(10, '22.5', -150, -110)])],
    }));
    expect(conflict.published).toBe(false);
    expect(conflict.reason).toBe('conflict');
    expect(Buffer.compare((await store.get(first.archiveKey!))!.body, original)).toBe(0);
    const board = await readCurrentBoard({ store, gameId: GAME, now: NOW });
    expect(board.available && board.rows.some((item) => item.oddsAmerican === -115)).toBe(true);
  });

  it('retries the same snapshot without a second archive or pointer body', async () => {
    const store = new InMemoryPrototypeStore();
    const first = await publishCurrentSnapshot(request({ store }));
    const etag = (await store.get(`current/source=balldontlie/league=nba/entity=player_prop_current/game_id=${GAME}/pointer.json`))!.etag;
    const archiveBytes = (await store.get(first.archiveKey!))!.body.length;
    const second = await publishCurrentSnapshot(request({ store }));
    expect(second).toMatchObject({ published: true, idempotent: true, reason: 'already_current' });
    expect((await store.get(first.archiveKey!))!.body.length).toBe(archiveBytes);
    expect((await store.get(`current/source=balldontlie/league=nba/entity=player_prop_current/game_id=${GAME}/pointer.json`))!.etag).toBe(etag);
  });

  it('does not publish when the archive read or the pointer write fails', async () => {
    const archiveStore = new InMemoryPrototypeStore();
    archiveStore.failGets = 1;
    const archiveFailed = await publishCurrentSnapshot(request({ store: archiveStore }));
    expect(archiveFailed.published).toBe(false);
    expect(await readCurrentBoard({ store: archiveStore, gameId: GAME, now: NOW })).toMatchObject({ reason: 'missing' });

    const pointerStore = new InMemoryPrototypeStore();
    pointerStore.failPointerPuts = 1;
    const pointerFailed = await publishCurrentSnapshot(request({ store: pointerStore }));
    expect(pointerFailed.published).toBe(false);
    expect(pointerFailed.reason).toBe('pointer_write_failed');
  });

  it('accepts a complete pregame board and rejects ineligible Quick Builds inputs', async () => {
    const store = new InMemoryPrototypeStore();
    await publishCurrentSnapshot(request({
      store,
      pages: [page([
        row(10, '22.5', -115, -105),
        row(11, '7.5', -110, -110, 'DraftKings', 'rebounds'),
        row(10, '22.5', -118, -102, 'FanDuel'),
      ])],
    }));
    const board = await readCurrentBoard({ store, gameId: GAME, now: NOW });
    const accepted = evaluateCurrentQuickBuilds({
      board,
      sportsbook: 'draftkings',
      policy: { mode: 'research_snapshot', asOf: NOW },
      gameStartTime: TIP,
      gameStatus: 'Scheduled',
    });
    expect(accepted.selection?.games[0]?.eligiblePullRunId).toBe('2');
    expect(accepted.markets.map((market) => [market.over.playerId, market.over.market, market.over.line])).toEqual([
      ['10', 'points', 22.5],
      ['11', 'rebounds', 7.5],
    ]);
    expect(accepted.generator).toMatchObject({ status: 'empty', emptyReason: 'NO_CROSS_GAME', builds: [] });

    const removed = await publishCurrentSnapshot(request({
      store,
      pullRunId: 5,
      observedAt: '2026-11-23T22:06:00.000Z',
      controllerEnqueuedAt: '2026-11-23T22:05:30.000Z',
      pages: [page([row(11, '7.5', -110, -110, 'DraftKings', 'rebounds')])],
    }));
    expect(removed.published).toBe(true);
    const next = await readCurrentBoard({ store, gameId: GAME, now: '2026-11-23T22:06:30.000Z' });
    const afterRemoval = evaluateCurrentQuickBuilds({
      board: next,
      sportsbook: 'draftkings',
      policy: { mode: 'research_snapshot', asOf: '2026-11-23T22:06:30.000Z' },
      gameStartTime: TIP,
      gameStatus: 'Scheduled',
    });
    expect(afterRemoval.markets.map((market) => market.over.playerId)).toEqual(['11']);

    const stale = evaluateCurrentQuickBuilds({
      board: next,
      sportsbook: 'draftkings',
      policy: { mode: 'recently_observed', asOf: '2026-11-23T23:00:00.000Z', maxObservationAgeMs: 60_000 },
      gameStartTime: TIP,
      gameStatus: 'Scheduled',
    });
    expect(stale.selection?.games[0]?.rejection).toBe('STALE_OBSERVATION');
    expect(stale.markets).toEqual([]);

    const finalGame = evaluateCurrentQuickBuilds({
      board: next,
      sportsbook: 'draftkings',
      policy: { mode: 'research_snapshot', asOf: NOW },
      gameStartTime: TIP,
      gameStatus: 'Final',
    });
    expect(finalGame.selection?.games[0]?.rejection).toBe('NOT_UPCOMING');
  });

  it('records zero high-volume props table writes', () => {
    const source = fs.readdirSync(path.join(__dirname, '..'))
      .filter((name) => name.endsWith('.ts'))
      .map((name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    for (const table of ['raw.player_prop_snapshots_v2', 'analytics.player_props_current', 'analytics.player_prop_current']) {
      expect(source).not.toContain(table);
    }
    expect(highVolumePropsMarketWrites).toEqual({ inserts: 0, updates: 0 });
  });

  it('measures one local fixture without calling that measurement a production cost', async () => {
    const store = new InMemoryPrototypeStore();
    const players = Array.from({ length: 12 }, (_, index) => row(100 + index, String(15 + index) + '.5', -110, -110));
    const rebounds = Array.from({ length: 12 }, (_, index) => row(100 + index, String(4 + (index % 5)) + '.5', -115, -105, 'DraftKings', 'rebounds'));
    const measured = await measurePublication({
      store,
      now: NOW,
      gameStatus: 'Scheduled',
      request: request({ store, pullRunId: 20, pages: [page([...players, ...rebounds])] }),
    });
    expect(measured.sourceObservations).toBe(24);
    expect(measured.normalizedRows).toBe(48);
    expect(measured.gzipArchiveBytes).toBeLessThan(measured.uncompressedArchiveBytes);
    expect(measured.s3PutRequests).toBeGreaterThan(0);
    expect(measured.s3GetRequests).toBeGreaterThan(0);
    console.log(JSON.stringify({ f39bMeasurement: measured }));
  });
});
