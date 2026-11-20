import { GetItemCommand, UpdateItemCommand, type AttributeValue } from '@aws-sdk/client-dynamodb';
import { describe, expect, it, vi } from 'vitest';

import {
  MemoryStorageReservationStore,
  admitPersistentWrite,
  type AdmissionMeasurement,
} from '@/lib/ops/storage-admission';
import {
  createDynamoStorageReservationStore,
  STORAGE_RESERVATION_CONDITION,
  STORAGE_RESERVATION_TABLE_NAME,
  type StorageReservationDynamoClient,
} from '@/lib/ops/storage-reservation-dynamo';
import { CLUSTER_HALT_BYTES, CLUSTER_RESTRICT_BYTES } from '@/lib/ops/storage-budget';
import {
  GAME_STATUS_MAX_GAMES_PER_PAGE,
  GAME_STATUS_PHYSICAL_GROWTH_BOUND_BYTES,
  SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES,
  ledgerRowRefusal,
  observedGrowthVerdict,
} from '@/lib/ops/storage-growth-bounds';
import { createMemoryGameStore, runGameStatusSync, type ProviderGame } from '@/lib/games/status-sync';
import { runLambdaGameStatusSync } from '@/lib/games/status-sync-lambda';
import { runLambdaScoreboard } from '@/lib/scoreboard/lambda';
import { createMemoryScoreboardStore } from '@/lib/scoreboard/store';

const NOW = '2026-11-19T16:10:00.000Z';
const INTENT = '2026-11-19T16:00:00.000Z';
const INACTIVE = '2026-11-19T16:05:00.000Z';
const SNAPSHOT = '2026-11-19T16:06:00.000Z';
const MEASURED = '2026-11-19T16:07:00.000Z';

function measurement(over: Partial<AdmissionMeasurement> = {}): AdmissionMeasurement {
  return {
    clusterBytes: 1_000_000,
    measuredAt: MEASURED,
    source: 'local-test',
    valid: true,
    complete: true,
    ...over,
  };
}

async function hold(store: MemoryStorageReservationStore, invocationId: string, writerId: string, inWrite: boolean) {
  const admitted = await admitPersistentWrite({
    writerId,
    kind: writerId === 'game-status-sync' ? 'game_status' : 'scoreboard',
    invocationId,
    now: INTENT,
    measurement: measurement({ measuredAt: '2026-11-19T15:30:00.000Z' }),
    physicalGrowthBoundBytes: 1_000,
    tables: writerId === 'game-status-sync' ? ['analytics.games'] : ['display.scoreboard_games'],
    reservations: store,
  });
  expect(admitted.allowed).toBe(true);
  const noted = await store.noteWriteIntent({
    invocationId,
    writerId,
    boundBytes: 1_000,
    intentAt: INTENT,
    inWrite,
  });
  expect(noted.ok).toBe(true);
  return store.ledgerVersion();
}

function recovery(store: MemoryStorageReservationStore, invocationId: string, writerId: string, version: number, over: Record<string, unknown> = {}) {
  return store.releaseStranded({
    now: NOW,
    invocationId,
    writerId,
    boundBytes: 1_000,
    expectedVersion: version,
    inactiveAt: INACTIVE,
    confirmSessionEnded: true,
    measurement: measurement(),
    databaseSnapshotAt: SNAPSHOT,
    ...over,
  });
}

describe('stranded reservation recovery', () => {
  it('refuses a timeout, a stale measurement, a snapshot that is newer than the measurement, and an active writer', async () => {
    const store = new MemoryStorageReservationStore();
    const version = await hold(store, 'run-1', 'scoreboard-collector', true);
    const timeout = await recovery(store, 'run-1', 'scoreboard-collector', version, {
      confirmSessionEnded: false,
      processTimedOut: true,
    });
    const stale = await recovery(store, 'run-1', 'scoreboard-collector', version, {
      measurement: measurement({ measuredAt: '2026-11-19T14:00:00.000Z' }),
    });
    const delayed = await recovery(store, 'run-1', 'scoreboard-collector', version, {
      measurement: measurement({ measuredAt: '2026-11-19T16:05:30.000Z' }),
      databaseSnapshotAt: SNAPSHOT,
    });
    const active = await recovery(store, 'run-1', 'scoreboard-collector', version, { confirmSessionEnded: false });
    expect(timeout.ok).toBe(false);
    expect(stale.ok).toBe(false);
    expect(delayed.ok).toBe(false);
    expect(active.ok).toBe(false);
    if (!timeout.ok) expect(timeout.reason).toMatch(/timeout/);
    if (!delayed.ok) expect(delayed.reason).toMatch(/snapshot|inactive/);
    expect(store.snapshot().active['run-1']?.boundBytes).toBe(1_000);
    expect(store.ledgerVersion()).toBe(version);
  });

  it('releases only the stopped invocation and rejects a second recovery', async () => {
    const store = new MemoryStorageReservationStore();
    const first = await hold(store, 'run-1', 'scoreboard-collector', true);
    await hold(store, 'run-2', 'game-status-sync', false);
    const version = store.ledgerVersion();
    const [left, right] = await Promise.all([
      recovery(store, 'run-1', 'scoreboard-collector', version),
      recovery(store, 'run-1', 'scoreboard-collector', version),
    ]);
    const winners = [left, right].filter((result) => result.ok);
    expect(winners).toHaveLength(1);
    expect(store.snapshot().active['run-1']).toBeUndefined();
    expect(store.snapshot().active['run-2']?.boundBytes).toBe(1_000);
    expect(store.snapshot().protectedBytes).toBe(1_000);
    const again = await recovery(store, 'run-1', 'scoreboard-collector', first);
    expect(again.ok).toBe(false);
    expect(store.snapshot().protectedBytes).toBe(1_000);
  });

  it('lets the same invocation retry without adding a second hold', async () => {
    const store = new MemoryStorageReservationStore();
    await hold(store, 'run-1', 'game-status-sync', false);
    const retry = await admitPersistentWrite({
      writerId: 'game-status-sync',
      kind: 'game_status',
      invocationId: 'run-1',
      now: INTENT,
      measurement: measurement({ measuredAt: '2026-11-19T15:40:00.000Z' }),
      physicalGrowthBoundBytes: 1_000,
      tables: ['analytics.games'],
      reservations: store,
    });
    expect(retry.allowed).toBe(true);
    expect(retry.reason).toContain('already holds');
    expect(store.snapshot().protectedBytes).toBe(1_000);
  });

  it('uses a conditional update so two dynamo recoveries cannot both release the hold', async () => {
    let version = 0;
    let json = JSON.stringify({ protectedBytes: 0, active: {}, settled: {} });
    const client: StorageReservationDynamoClient = {
      async send(command) {
        if (command instanceof GetItemCommand) {
          return { Item: { ledger_version: { N: String(version) }, ledger_json: { S: json } } as Record<string, AttributeValue> };
        }
        if (command instanceof UpdateItemCommand) {
          expect(command.input.ConditionExpression).toBe(STORAGE_RESERVATION_CONDITION);
          const seen = Number(command.input.ExpressionAttributeValues?.[':seen']?.N);
          if (seen !== version) {
            const error = new Error('condition failed');
            error.name = 'ConditionalCheckFailedException';
            throw error;
          }
          version += 1;
          json = command.input.ExpressionAttributeValues?.[':ledger']?.S ?? json;
          return {};
        }
        throw new Error('unexpected command');
      },
    };
    const store = createDynamoStorageReservationStore(client, STORAGE_RESERVATION_TABLE_NAME);
    const admitted = await admitPersistentWrite({
      writerId: 'scoreboard-collector',
      kind: 'scoreboard',
      invocationId: 'dyn-1',
      now: INTENT,
      measurement: measurement({ measuredAt: '2026-11-19T15:30:00.000Z' }),
      physicalGrowthBoundBytes: 1_000,
      tables: ['display.scoreboard_games'],
      reservations: store,
    });
    expect(admitted.allowed).toBe(true);
    const noted = await store.noteWriteIntent({
      invocationId: 'dyn-1',
      writerId: 'scoreboard-collector',
      boundBytes: 1_000,
      intentAt: INTENT,
      inWrite: true,
    });
    expect(noted.ok).toBe(true);
    const seen = noted.ok ? noted.version : 0;
    const input = {
      now: NOW,
      invocationId: 'dyn-1',
      writerId: 'scoreboard-collector',
      boundBytes: 1_000,
      expectedVersion: seen,
      inactiveAt: INACTIVE,
      confirmSessionEnded: true,
      measurement: measurement(),
      databaseSnapshotAt: SNAPSHOT,
    };
    const [left, right] = await Promise.all([store.releaseStranded(input), store.releaseStranded(input)]);
    expect([left, right].filter((result) => result.ok)).toHaveLength(1);
    expect(JSON.parse(json).active['dyn-1']).toBeUndefined();
    expect(JSON.parse(json).protectedBytes).toBe(0);
  });
});

describe('envelopes refuse before a write', () => {
  const live = {
    DATA_MODE: 'live_api',
    OFFSEASON_MODE: '0',
    CRON_DRY_RUN: '0',
    LIVE_INGESTION_ENABLED: 'true',
    STATUS_SYNC_TARGET_SEASON: '2026',
  };

  it('refuses a full-season write, an oversized page, and an oversized status without upserting', async () => {
    const store = createMemoryGameStore();
    const upsert = vi.spyOn(store, 'upsert');
    const fetchPage = vi.fn();
    const unbounded = await runGameStatusSync({
      env: live,
      now: new Date('2026-10-22T03:15:00.000Z'),
      mode: 'full_season',
      dryRun: false,
      store,
      fetchPage,
    });
    expect(unbounded.status).toBe('failed');
    expect(unbounded.reason).toContain('full_season');
    expect(fetchPage).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();

    const games: ProviderGame[] = Array.from({ length: GAME_STATUS_MAX_GAMES_PER_PAGE + 1 }, (_, index) => ({
      id: 4000 + index,
      season: 2026,
      status: 'Scheduled',
      datetime: '2026-10-22T23:30:00.000Z',
      date: '2026-10-22',
      home_team_score: 0,
      visitor_team_score: 0,
      home_team: { id: 13 },
      visitor_team: { id: 14 },
    }));
    const page = await runGameStatusSync({
      env: live,
      now: new Date('2026-10-22T03:15:00.000Z'),
      dryRun: false,
      allowFrozenSimulation: true,
      startDate: '2026-10-22',
      endDate: '2026-10-22',
      store,
      fetchPage: async () => ({ status: 200, ok: true, json: { data: games, meta: { next_cursor: null } } }),
    });
    expect(page.status).toBe('failed');
    expect(page.reason).toContain('envelope');
    expect(upsert).not.toHaveBeenCalled();

    const wide = await runGameStatusSync({
      env: live,
      now: new Date('2026-10-22T03:15:00.000Z'),
      dryRun: false,
      allowFrozenSimulation: true,
      startDate: '2026-10-22',
      endDate: '2026-10-22',
      store,
      fetchPage: async () => ({
        status: 200,
        ok: true,
        json: {
          data: [{ ...games[0], id: 1, status: 'S'.repeat(81) }],
          meta: { next_cursor: null },
        },
      }),
    });
    expect(wide.status).toBe('failed');
    expect(wide.reason).toMatch(/physical envelope/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses a scoreboard page above the cap before the display store write', async () => {
    const store = createMemoryScoreboardStore();
    const upsert = vi.spyOn(store, 'upsertGames');
    const record = vi.spyOn(store, 'recordGamesRequest');
    const rows = Array.from({ length: 101 }, (_, index) => ({
      id: 7000 + index,
      date: '2026-10-09',
      datetime: '2026-10-10T00:00:00.000Z',
      season: 2026,
      status: 'Scheduled',
      period: 0,
      home_team: { id: 5, abbreviation: 'CHI', full_name: 'Chicago Bulls' },
      visitor_team: { id: 15, abbreviation: 'MEM', full_name: 'Memphis Grizzlies' },
      home_team_score: 0,
      visitor_team_score: 0,
    }));
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return {
        status: 200,
        ok: true,
        json: { data: calls === 1 ? rows : [], meta: { next_cursor: null } },
        acquisition: { requestIds: ['req-cap'], archiveStatuses: ['ARCHIVED' as const], s3Keys: [], blockedReason: null },
      };
    };
    const result = await (await import('@/lib/scoreboard/collector')).runScoreboardCycle({
      env: {
        DATA_MODE: 'live_api',
        OFFSEASON_MODE: '0',
        CRON_DRY_RUN: '0',
        LIVE_INGESTION_ENABLED: '1',
        SCOREBOARD_COLLECT_PRESEASON: '1',
        SCOREBOARD_TARGET_SEASON: '2026',
      },
      store,
      fetch: { games: fetch, liveBox: fetch },
      now: new Date('2026-10-09T16:00:00.000Z'),
    });
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('envelope');
    expect(upsert).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(store.games.size).toBe(0);
  });

  it('refuses an under-sized injected bound and a retry count above the envelope before fetch', async () => {
    const fetchPage = vi.fn(async () => ({ status: 200, ok: true, json: { data: [], meta: { next_cursor: null } } }));
    const base = {
      env: {
        DATA_MODE: 'live_api',
        OFFSEASON_MODE: '0',
        CRON_DRY_RUN: '0',
        LIVE_INGESTION_ENABLED: 'true',
        STATUS_SYNC_TARGET_SEASON: '2026',
        BALLDONTLIE_API_KEY: 'test-not-a-real-key',
        NBA_DATA_BUCKET: 'not-contacted',
        BDL_RATE_LIMIT_MAX_RETRIES: '9',
      },
      now: new Date('2026-10-22T03:15:00.000Z'),
      manualCanary: true,
      dryRun: false as const,
      startDate: '2026-10-22',
      endDate: '2026-10-22',
      store: createMemoryGameStore(),
      fetchPage,
      storage: {
        now: INTENT,
        invocationId: 'retry-cap',
        measurement: measurement({ measuredAt: '2026-11-19T15:30:00.000Z' }),
        physicalGrowthBoundBytes: 1,
        reservations: new MemoryStorageReservationStore(),
      },
    };
    const capped = await runLambdaGameStatusSync(base);
    expect(capped.wroteDb).toBe(false);
    expect(capped.reason).toContain('envelope');
    expect(fetchPage).not.toHaveBeenCalled();
    expect(GAME_STATUS_PHYSICAL_GROWTH_BOUND_BYTES).toBeGreaterThan(1);
    expect(ledgerRowRefusal({
      request_id: 'r',
      pull_run_id: 'p',
      provider: 'balldontlie',
      league: 'nba',
      endpoint_family: 'games',
      endpoint_path: '/v1/games',
      scope_kind: 'date',
      scope_id: '2026-10-22',
      page_index: 0,
      attempt: 5,
      request_started_at: INTENT,
      collector_name: 'game-status-sync',
      collector_version: 'v1',
    })).toMatch(/attempt/);
  });

  it('keeps the reservation when settlement throws and does not start a second write', async () => {
    const store = new MemoryStorageReservationStore();
    store.settle = async () => {
      throw new Error('settlement response failed');
    };
    let fetches = 0;
    const fetch = async () => {
      fetches += 1;
      return {
        status: 200,
        ok: true,
        json: {
          data: fetches === 1
            ? [{
                id: 5001,
                date: '2026-10-09',
                datetime: '2026-10-10T00:00:00.000Z',
                season: 2026,
                status: 'Scheduled',
                period: 0,
                home_team: { id: 5, abbreviation: 'CHI', full_name: 'Chicago Bulls' },
                visitor_team: { id: 15, abbreviation: 'MEM', full_name: 'Memphis Grizzlies' },
                home_team_score: 0,
                visitor_team_score: 0,
              }]
            : [],
          meta: { next_cursor: null },
        },
        acquisition: { requestIds: ['req-1'], archiveStatuses: ['ARCHIVED' as const], s3Keys: [], blockedReason: null },
      };
    };
    const storage = {
      now: INTENT,
      invocationId: 'settle-fail',
      measurement: measurement({
        measuredAt: '2026-11-19T15:30:00.000Z',
        clusterBytes: CLUSTER_HALT_BYTES - SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES - 1,
      }),
      physicalGrowthBoundBytes: 1,
      reservations: store,
      observedDatabaseGrowth: {
        beforeBytes: CLUSTER_HALT_BYTES - SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES - 1,
        afterBytes: CLUSTER_HALT_BYTES - SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES - 1,
      },
    };
    const env = {
      DATA_MODE: 'live_api',
      OFFSEASON_MODE: '0',
      CRON_DRY_RUN: '0',
      LIVE_INGESTION_ENABLED: '1',
      SCOREBOARD_COLLECT_PRESEASON: '1',
      SCOREBOARD_TARGET_SEASON: '2026',
      BALLDONTLIE_API_KEY: 'test-not-a-real-key',
      NBA_RAW_PREFIX: 'raw',
    };
    await expect(
      runLambdaScoreboard({
        env,
        now: new Date('2026-10-09T16:00:00.000Z'),
        store: createMemoryScoreboardStore(),
        fetch: { games: fetch, liveBox: fetch },
        storage,
      })
    ).rejects.toThrow('settlement response failed');
    expect(fetches).toBe(1);
    expect(store.snapshot().active['settle-fail']?.boundBytes).toBe(SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES);
    const second = await runLambdaScoreboard({
      env,
      now: new Date('2026-10-09T16:00:00.000Z'),
      store: createMemoryScoreboardStore(),
      fetch: { games: fetch, liveBox: fetch },
      storage: { ...storage, invocationId: 'settle-fail-2' },
    });
    expect(second.status).toBe('failed');
    expect(second.reason).toContain('no room');
    expect(fetches).toBe(1);
  });

  it('admits one envelope near halt and near restrict, and refuses unexpected growth without another write', async () => {
    const bound = SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES;
    const nearHalt = new MemoryStorageReservationStore();
    const haltCluster = CLUSTER_HALT_BYTES - bound - 1;
    const first = await admitPersistentWrite({
      writerId: 'scoreboard-collector',
      kind: 'scoreboard',
      invocationId: 'halt-1',
      now: INTENT,
      measurement: measurement({ measuredAt: '2026-11-19T15:30:00.000Z', clusterBytes: haltCluster }),
      physicalGrowthBoundBytes: bound,
      tables: ['display.scoreboard_games'],
      reservations: nearHalt,
    });
    const second = await admitPersistentWrite({
      writerId: 'scoreboard-collector',
      kind: 'scoreboard',
      invocationId: 'halt-2',
      now: INTENT,
      measurement: measurement({ measuredAt: '2026-11-19T15:30:00.000Z', clusterBytes: haltCluster }),
      physicalGrowthBoundBytes: bound,
      tables: ['display.scoreboard_games'],
      reservations: nearHalt,
    });
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);

    const atHalt = await admitPersistentWrite({
      writerId: 'game-status-sync',
      kind: 'game_status',
      invocationId: 'at-halt',
      now: INTENT,
      measurement: measurement({ measuredAt: '2026-11-19T15:30:00.000Z', clusterBytes: CLUSTER_HALT_BYTES }),
      physicalGrowthBoundBytes: GAME_STATUS_PHYSICAL_GROWTH_BOUND_BYTES,
      tables: ['analytics.games'],
      reservations: new MemoryStorageReservationStore(),
    });
    expect(atHalt.allowed).toBe(false);

    const nearRestrict = new MemoryStorageReservationStore();
    const restrictCluster = CLUSTER_RESTRICT_BYTES - 1;
    const restrictFirst = await admitPersistentWrite({
      writerId: 'scoreboard-collector',
      kind: 'scoreboard',
      invocationId: 'restrict-1',
      now: INTENT,
      measurement: measurement({ measuredAt: '2026-11-19T15:30:00.000Z', clusterBytes: restrictCluster }),
      physicalGrowthBoundBytes: bound,
      tables: ['display.scoreboard_games'],
      reservations: nearRestrict,
    });
    const restrictSecond = await admitPersistentWrite({
      writerId: 'game-status-sync',
      kind: 'game_status',
      invocationId: 'restrict-2',
      now: INTENT,
      measurement: measurement({ measuredAt: '2026-11-19T15:30:00.000Z', clusterBytes: restrictCluster }),
      physicalGrowthBoundBytes: bound,
      tables: ['analytics.games'],
      reservations: nearRestrict,
    });
    const room = CLUSTER_HALT_BYTES - restrictCluster - bound;
    expect(restrictFirst.allowed).toBe(restrictCluster + bound < CLUSTER_HALT_BYTES);
    expect(restrictSecond.allowed).toBe(restrictFirst.allowed && bound < room);

    const verdict = observedGrowthVerdict(1_000, 1_000 + bound + 1, bound);
    expect(verdict.ok).toBe(false);
    let extraWrites = 0;
    if (verdict.ok) extraWrites += 1;
    expect(extraWrites).toBe(0);
  });
});
