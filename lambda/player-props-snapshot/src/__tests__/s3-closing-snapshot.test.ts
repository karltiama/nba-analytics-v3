import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { InMemoryPrototypeStore } from '../f39b/store';
import { publishCurrentSnapshot } from '../f39b/publish';
import { buildArchiveEnvelope, buildPlayerPropSnapshotArchiveKey, writeArchiveObject } from '../player-prop-snapshot-archive';
import {
  ClosingSnapshotRefusal,
  HISTORICAL_READER_CHANGE,
  MISSING_DURABILITY_CONTRACT,
  closingSnapshotKey,
  decisionRowsFromClosingArtifact,
  publishClosingSnapshot,
  type ClosingGame,
  type GameRunRecord,
  type PullEvidence,
} from '../s3-closing-snapshot';

const GAME: ClosingGame = { gameId: '101', gameDate: '2026-11-23', status: 'Final', startTime: '2026-11-23T23:00:00.000Z' };
const STARTED = '2026-11-23T17:00:00.000Z';

function provider(playerId: number, vendor: string, prop: string, line: string) {
  return {
    id: playerId,
    game_id: 101,
    player_id: playerId,
    vendor,
    prop_type: prop,
    line_value: line,
    market: { type: 'over_under', over_odds: -110, under_odds: -110 },
    updated_at: STARTED,
  };
}

function bodies(store: InMemoryPrototypeStore): Map<string, string> {
  const saved = new Map<string, string>();
  for (const [key, object] of store.objects) {
    if (!key.endsWith('/closing.json')) saved.set(key, object.body.toString('base64'));
  }
  return saved;
}

function sameBodies(store: InMemoryPrototypeStore, before: Map<string, string>): void {
  for (const [key, body] of before) {
    expect(store.objects.get(key)?.body.toString('base64')).toBe(body);
  }
}

async function publishPull(
  store: InMemoryPrototypeStore,
  pullRunId: number,
  observedAt: string,
  rows: ReturnType<typeof provider>[]
): Promise<string> {
  const result = await publishCurrentSnapshot({
    store,
    gameId: GAME.gameId,
    bdlGameId: 101,
    gameDate: GAME.gameDate,
    gameStartTime: GAME.startTime!,
    pullRunId,
    pages: [{ httpStatus: 200, payload: { data: rows, meta: { next_cursor: null } } }],
    observedAt,
    controllerEnqueuedAt: STARTED,
  });
  expect(result.archiveKey).toBeTruthy();
  return result.archiveKey as string;
}

function committed(pullRunId: number, archiveKey: string): PullEvidence {
  return {
    pullRunId,
    queriedGame: true,
    gameRun: {
      status: 'success',
      archiveStatus: 'archived',
      archiveKey,
      startedAt: STARTED,
      rowsFetched: 1,
      rowsStored: 0,
      providerAttempts: 1,
    },
  };
}

describe('S3 historical closing snapshot', () => {
  it('keeps the last quote, a removed market, a changed line, and every book', async () => {
    const store = new InMemoryPrototypeStore();
    const first = await publishPull(store, 1, '2026-11-23T17:05:00.000Z', [
      provider(77, 'draftkings', 'points', '10.5'),
      provider(77, 'fanduel', 'points', '10.5'),
      provider(77, 'draftkings', 'rebounds', '4.5'),
    ]);
    const second = await publishPull(store, 2, '2026-11-23T18:00:00.000Z', [
      provider(77, 'draftkings', 'points', '12.5'),
    ]);
    await store.put(
      'current/source=balldontlie/league=nba/entity=player_prop_current/game_id=101/pointer.json',
      Buffer.from('{"archiveKey":"later-only"}\n'),
      {},
      { kind: 'if-none-match', etag: '*' }
    );
    const before = bodies(store);
    const published = await publishClosingSnapshot({
      store,
      game: GAME,
      pulls: [committed(2, second), committed(1, first)],
    });
    const find = (book: string, prop: string, side: string) => published.artifact.lines.find((row) => (
      row.sportsbook === book && row.propType === prop && row.side === side
    ));
    expect(find('draftkings', 'points', 'over')).toMatchObject({
      lineValue: 12.5,
      decisionAt: '2026-11-23T18:00:00.000Z',
      decisionClock: 'RESPONSE_RECEIVED',
      playerId: '77',
    });
    expect(find('fanduel', 'points', 'over')).toMatchObject({ lineValue: 10.5, decisionAt: '2026-11-23T17:05:00.000Z' });
    expect(find('draftkings', 'rebounds', 'under')).toMatchObject({ lineValue: 4.5 });
    expect(published.artifact.completeness).toBe('complete');
    expect(published.artifact.marketCount).toBe(published.artifact.lines.length);
    expect(published.artifact.pulls.map((pull) => pull.observationClock)).toEqual(['RESPONSE_RECEIVED', 'RESPONSE_RECEIVED']);
    const stored = JSON.parse(store.objects.get(published.key)!.body.toString('utf8'));
    const rows = decisionRowsFromClosingArtifact(stored);
    expect(rows).toEqual(published.artifact.lines);
    expect(HISTORICAL_READER_CHANGE.smallestChange).toMatch(/no research.prop_decision_lines rows/);
    expect(HISTORICAL_READER_CHANGE.smallestChange).toMatch(/unavailable/);
    expect(HISTORICAL_READER_CHANGE.pastDatePropsExplorer).toMatch(/props-explorer-serving/);
    expect(HISTORICAL_READER_CHANGE.historicalPropEvaluation).toMatch(/evaluate-player-projections/);
    expect(HISTORICAL_READER_CHANGE.playerLevelHistoricalResearch).toMatch(/opening-player-props/);
    sameBodies(store, before);
  });

  it('breaks an equal timestamp with the higher pull_run_id', async () => {
    const store = new InMemoryPrototypeStore();
    const observedAt = '2026-11-23T18:00:00.000Z';
    const earlier = await publishPull(store, 1, observedAt, [provider(77, 'draftkings', 'points', '10.5')]);
    const later = await publishPull(store, 2, observedAt, [provider(77, 'draftkings', 'points', '11.5')]);
    const published = await publishClosingSnapshot({
      store,
      game: GAME,
      pulls: [committed(1, earlier), committed(2, later)],
    });
    expect(published.artifact.lines.find((row) => row.side === 'over')).toMatchObject({ lineValue: 11.5 });
  });

  it('refuses a missing archive', async () => {
    const store = new InMemoryPrototypeStore();
    const key = buildPlayerPropSnapshotArchiveKey({
      rawPrefix: 'raw',
      season: 2026,
      gameDate: GAME.gameDate,
      gameId: GAME.gameId,
      pullRunId: 4,
      snapshotAt: STARTED,
    });
    await expect(publishClosingSnapshot({
      store,
      game: GAME,
      pulls: [committed(4, key)],
    })).rejects.toMatchObject({ coverage: { completeness: 'verified_subset' } });
    expect(store.objects.has(closingSnapshotKey(GAME))).toBe(false);
  });

  it('refuses an invalid manifest and leaves the archive in place', async () => {
    const store = new InMemoryPrototypeStore();
    const archiveKey = await publishPull(store, 1, '2026-11-23T17:05:00.000Z', [provider(77, 'draftkings', 'points', '10.5')]);
    const manifestKey = `${archiveKey}.publication.json`;
    const manifest = await store.get(manifestKey);
    const before = bodies(store);
    await store.put(manifestKey, Buffer.from('{'), manifest!.metadata, { kind: 'if-match', etag: manifest!.etag });
    const error = await publishClosingSnapshot({
      store,
      game: GAME,
      pulls: [committed(1, archiveKey)],
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ClosingSnapshotRefusal);
    expect((error as ClosingSnapshotRefusal).coverage?.findings[0]?.state).toBe('invalid_manifest');
    expect((error as ClosingSnapshotRefusal).coverage?.completeness).not.toBe('complete');
    expect(store.objects.has(closingSnapshotKey(GAME))).toBe(false);
    expect(store.objects.get(archiveKey)?.body.toString('base64')).toBe(before.get(archiveKey));
  });

  it('refuses a failed game run, recovers an uncommitted archive, and reports a pull with no game run', async () => {
    const failed = new InMemoryPrototypeStore();
    const failedRun: GameRunRecord = {
      status: 'error',
      archiveStatus: 'failed',
      archiveKey: null,
      startedAt: STARTED,
      rowsFetched: 0,
      rowsStored: 0,
      providerAttempts: 1,
    };
    const failedError = await publishClosingSnapshot({
      store: failed,
      game: GAME,
      pulls: [{ pullRunId: 3, queriedGame: true, gameRun: failedRun }],
    }).catch((caught: unknown) => caught);
    expect(failedError).toBeInstanceOf(ClosingSnapshotRefusal);
    expect((failedError as ClosingSnapshotRefusal).coverage?.findings[0]?.state).toBe('failed');
    expect(failed.objects.has(closingSnapshotKey(GAME))).toBe(false);

    const recovered = new InMemoryPrototypeStore();
    const archiveKey = await publishPull(recovered, 6, '2026-11-23T17:05:00.000Z', [provider(77, 'draftkings', 'points', '9.5')]);
    const open: GameRunRecord = {
      status: 'started',
      archiveStatus: 'pending',
      archiveKey: null,
      startedAt: STARTED,
      rowsFetched: 1,
      rowsStored: 0,
      providerAttempts: 1,
    };
    const published = await publishClosingSnapshot({
      store: recovered,
      game: GAME,
      pulls: [{ pullRunId: 6, queriedGame: true, gameRun: open }],
    });
    expect(published.artifact.pulls[0]).toMatchObject({ archiveKey, recoveredUncommittedGameRun: true });
    expect(published.artifact.lines.find((row) => row.side === 'over')?.lineValue).toBe(9.5);

    const gap = new InMemoryPrototypeStore();
    const good = await publishPull(gap, 1, '2026-11-23T17:05:00.000Z', [provider(77, 'draftkings', 'points', '10.5')]);
    const gapError = await publishClosingSnapshot({
      store: gap,
      game: GAME,
      pulls: [committed(1, good), { pullRunId: 8, queriedGame: true, gameRun: null }],
    }).catch((caught: unknown) => caught);
    expect(gapError).toBeInstanceOf(ClosingSnapshotRefusal);
    const coverage = (gapError as ClosingSnapshotRefusal).coverage;
    expect(coverage?.completeness).toBe('unverifiable');
    expect(coverage?.missingDurabilityContract).toBe(MISSING_DURABILITY_CONTRACT);
    expect(gap.objects.has(closingSnapshotKey(GAME))).toBe(false);
    expect(gap.objects.has(good)).toBe(true);
  });

  it('accepts a Final game and refuses a postponed game', async () => {
    const store = new InMemoryPrototypeStore();
    const archiveKey = await publishPull(store, 1, '2026-11-23T17:05:00.000Z', [provider(77, 'draftkings', 'points', '10.5')]);
    await expect(publishClosingSnapshot({
      store,
      game: { ...GAME, status: 'Postponed' },
      pulls: [committed(1, archiveKey)],
    })).rejects.toThrow(/Final game/);
    expect(store.objects.has(closingSnapshotKey(GAME))).toBe(false);
    const published = await publishClosingSnapshot({
      store,
      game: GAME,
      pulls: [committed(1, archiveKey)],
    });
    expect(published.artifact.completeness).toBe('complete');
    expect(published.artifact.lines.length).toBeGreaterThan(0);
  });

  it('retries the same closing artifact without rewriting archives', async () => {
    const store = new InMemoryPrototypeStore();
    const archiveKey = await publishPull(store, 1, '2026-11-23T17:05:00.000Z', [provider(77, 'draftkings', 'points', '10.5')]);
    const before = bodies(store);
    const first = await publishClosingSnapshot({ store, game: GAME, pulls: [committed(1, archiveKey)] });
    const second = await publishClosingSnapshot({ store, game: GAME, pulls: [committed(1, archiveKey)] });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.artifact.contentChecksum).toBe(first.artifact.contentChecksum);
    expect([...store.objects.keys()].filter((key) => key.endsWith('/closing.json'))).toEqual([closingSnapshotKey(GAME)]);
    sameBodies(store, before);
  });

  it('rejects a conflicting closing artifact', async () => {
    const store = new InMemoryPrototypeStore();
    const archiveKey = await publishPull(store, 1, '2026-11-23T17:05:00.000Z', [provider(77, 'draftkings', 'points', '10.5')]);
    const key = closingSnapshotKey(GAME);
    const before = bodies(store);
    await store.put(key, Buffer.from('{"other":true}\n'), {}, { kind: 'if-none-match', etag: '*' });
    await expect(publishClosingSnapshot({
      store,
      game: GAME,
      pulls: [committed(1, archiveKey)],
    })).rejects.toThrow(/conflicts/);
    expect(store.objects.get(key)?.body.toString('utf8')).toBe('{"other":true}\n');
    sameBodies(store, before);
  });

  it('refuses an archive that has no observation clock', async () => {
    const store = new InMemoryPrototypeStore();
    const key = buildPlayerPropSnapshotArchiveKey({
      rawPrefix: 'raw',
      season: 2026,
      gameDate: GAME.gameDate,
      gameId: GAME.gameId,
      pullRunId: 9,
      snapshotAt: STARTED,
    });
    const envelope = buildArchiveEnvelope({
      season: 2026,
      pullRunId: 9,
      gameId: GAME.gameId,
      sourceGameId: 101,
      gameDate: GAME.gameDate,
      snapshotAt: STARTED,
      gameStartTime: GAME.startTime,
      rows: [],
    });
    await writeArchiveObject({ store, key, envelope });
    const error = await publishClosingSnapshot({
      store,
      game: GAME,
      pulls: [committed(9, key)],
    }).catch((caught: unknown) => caught);
    expect((error as ClosingSnapshotRefusal).coverage?.findings[0]?.state).toBe('missing_clock');
    expect(store.objects.has(closingSnapshotKey(GAME))).toBe(false);
  });

  it('refuses pending and contradictory pull evidence', async () => {
    const pending = new InMemoryPrototypeStore();
    const pendingError = await publishClosingSnapshot({
      store: pending,
      game: GAME,
      pulls: [{
        pullRunId: 5,
        queriedGame: true,
        gameRun: {
          status: 'started',
          archiveStatus: 'pending',
          archiveKey: null,
          startedAt: STARTED,
          rowsFetched: null,
          rowsStored: null,
          providerAttempts: 1,
        },
      }],
    }).catch((caught: unknown) => caught);
    expect((pendingError as ClosingSnapshotRefusal).coverage?.findings[0]?.state).toBe('pending');
    expect(pending.objects.has(closingSnapshotKey(GAME))).toBe(false);

    const conflict = new InMemoryPrototypeStore();
    const archiveKey = await publishPull(conflict, 1, '2026-11-23T17:05:00.000Z', [provider(77, 'draftkings', 'points', '10.5')]);
    const conflictError = await publishClosingSnapshot({
      store: conflict,
      game: GAME,
      pulls: [committed(1, `${archiveKey}.other`)],
    }).catch((caught: unknown) => caught);
    expect((conflictError as ClosingSnapshotRefusal).coverage?.findings[0]?.state).toBe('contradictory');
    expect(conflict.objects.has(archiveKey)).toBe(true);
    expect(conflict.objects.has(closingSnapshotKey(GAME))).toBe(false);
  });

  it('does not write PostgreSQL market or decision-line rows', () => {
    const source = readFileSync(new URL('../s3-closing-snapshot.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/insert into|pool\.query|ListBucket|ListObjects/i);
    expect(source).not.toMatch(/insertDecisionCloseRows|materializeGameDecisionClose/);
    expect(source).toMatch(/Do not union it with raw\.player_prop_snapshots_v2/);
  });
});
