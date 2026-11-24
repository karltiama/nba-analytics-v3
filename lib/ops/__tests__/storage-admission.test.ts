import { GetItemCommand, UpdateItemCommand, type AttributeValue } from '@aws-sdk/client-dynamodb';
import { describe, expect, it } from 'vitest';

import {
  CLUSTER_DATABASE_ROWS_SQL,
  CLUSTER_DATABASE_TOTAL_SQL,
  publishClusterMeasurement,
  type ClusterMeasurementLease,
} from '@/lib/ops/cluster-measurement';
import {
  CLUSTER_HALT_BYTES,
  CLUSTER_RESTRICT_BYTES,
  CLUSTER_WARNING_BYTES,
  FREE_PLAN_QUOTA_BYTES,
  RECLAMATION_ABORT_BYTES,
} from '@/lib/ops/storage-budget';
import {
  LEGACY_SETTLED_RECONCILE_GRACE_MS,
  MemoryStorageReservationStore,
  admitPersistentWrite,
  storageWriteCeiling,
  transitionReservation,
  type AdmissionMeasurement,
  type StorageReservationStore,
} from '@/lib/ops/storage-admission';
import {
  STORAGE_RESERVATION_CONDITION,
  STORAGE_RESERVATION_TABLE_NAME,
  createDynamoStorageReservationStore,
  type StorageReservationDynamoClient,
} from '@/lib/ops/storage-reservation-dynamo';

const NOW = '2026-11-19T16:00:00.000Z';
const MEASURED = '2026-11-19T15:30:00.000Z';

function measurement(clusterBytes: number, patch: Partial<AdmissionMeasurement> = {}): AdmissionMeasurement {
  return {
    clusterBytes,
    measuredAt: MEASURED,
    source: 'publisher',
    valid: true,
    complete: true,
    ...patch,
  };
}

function admit(input: {
  kind?: 'scoreboard' | 'game_status' | 'historical_raw_props' | 'historical_recovery' | 'current_season_ingestion';
  invocationId?: string;
  clusterBytes?: number;
  bound?: number | null;
  reservations?: StorageReservationStore;
  measurement?: AdmissionMeasurement;
  tables?: string[];
  now?: string;
}) {
  return admitPersistentWrite({
    writerId: 'scoreboard-collector',
    kind: input.kind ?? 'scoreboard',
    invocationId: input.invocationId ?? 'invoke-1',
    now: input.now ?? NOW,
    measurement: input.measurement ?? measurement(input.clusterBytes ?? 1_000_000),
    physicalGrowthBoundBytes: input.bound === undefined ? 1_000 : input.bound,
    tables: input.tables ?? ['display.scoreboard_games', 'raw.acquisition_requests'],
    reservations: input.reservations ?? new MemoryStorageReservationStore(),
  });
}

describe('shared admission contract', () => {
  it('keeps the published thresholds and does not treat reclamation abort as a write allowance', () => {
    expect(CLUSTER_WARNING_BYTES).toBe(350_000_000);
    expect(CLUSTER_RESTRICT_BYTES).toBe(400_000_000);
    expect(CLUSTER_HALT_BYTES).toBe(450_000_000);
    expect(RECLAMATION_ABORT_BYTES).toBe(490_000_000);
    expect(FREE_PLAN_QUOTA_BYTES).toBe(500_000_000);
    expect(storageWriteCeiling('game_status')).toBe(CLUSTER_HALT_BYTES);
    expect(storageWriteCeiling('scoreboard')).toBe(CLUSTER_HALT_BYTES);
    expect(storageWriteCeiling('historical_raw_props')).toBe(CLUSTER_RESTRICT_BYTES);
    expect(storageWriteCeiling('game_status')).not.toBe(RECLAMATION_ABORT_BYTES);
  });

  it('does not admit historical recovery through the production writer', async () => {
    const store = new MemoryStorageReservationStore();
    const decision = await admit({
      kind: 'historical_recovery',
      clusterBytes: 1_000,
      reservations: store,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('do not grant it');
    expect(store.snapshot().protectedBytes).toBe(0);
  });

  it('admits a fresh complete measurement under the ceiling and warns at 350,000,000', async () => {
    const fresh = await admit({ clusterBytes: 1_000 });
    expect(fresh.allowed).toBe(true);
    expect(fresh.alert).toBe('none');
    expect(fresh.reservedBytes).toBe(1_000);
    const warning = await admit({ clusterBytes: CLUSTER_WARNING_BYTES, kind: 'game_status' });
    expect(warning.allowed).toBe(true);
    expect(warning.pressure).toBe('warning');
    expect(warning.alert).toBe('warning');
  });

  it('denies stale, missing, future-dated, and incomplete measurements', async () => {
    const staleAt = new Date(Date.parse(NOW) - 60 * 60 * 1000 - 1).toISOString();
    const stale = await admit({ measurement: measurement(1_000, { measuredAt: staleAt }) });
    const missing = await admit({ measurement: measurement(1_000, { valid: false, clusterBytes: null }) });
    const future = await admit({ measurement: measurement(1_000, { measuredAt: '2026-11-19T16:00:00.001Z' }) });
    const incomplete = await admit({ measurement: measurement(1_000, { complete: false }) });
    const untrusted = await admit({ measurement: measurement(1_000, { source: '  ' }) });
    expect(stale).toMatchObject({ allowed: false, pressure: 'stale', alert: 'critical' });
    expect(missing.allowed).toBe(false);
    expect(future.reason).toContain('future-dated');
    expect(incomplete.reason).toContain('incomplete');
    expect(untrusted.reason).toContain('untrusted');
    expect(stale.settle).toBeTypeOf('function');
  });

  it('denies game-status and scoreboard at halt and historical writes at restrict', async () => {
    const halt = measurement(CLUSTER_HALT_BYTES);
    const game = await admit({ kind: 'game_status', measurement: halt, tables: ['analytics.games'] });
    const board = await admit({ kind: 'scoreboard', measurement: halt });
    const historical = await admit({
      kind: 'historical_raw_props',
      measurement: measurement(CLUSTER_RESTRICT_BYTES),
      tables: ['raw.player_prop_snapshots_v2'],
    });
    expect(game.allowed).toBe(false);
    expect(game.reason).toContain('450,000,000');
    expect(board.allowed).toBe(false);
    expect(historical.allowed).toBe(false);
    expect(historical.reason).toContain('400,000,000');
    const belowAbort = await admit({ kind: 'game_status', clusterBytes: RECLAMATION_ABORT_BYTES - 1, tables: ['analytics.games'] });
    expect(belowAbort.allowed).toBe(false);
    expect(belowAbort.pressure).toBe('halt');
  });

  it('denies an unknown or over-ceiling physical bound and does not reserve it', async () => {
    const store = new MemoryStorageReservationStore();
    const unknown = await admit({ bound: null, reservations: store });
    const zero = await admit({ bound: 0, reservations: store });
    const over = await admit({
      clusterBytes: CLUSTER_HALT_BYTES - 1_000,
      bound: 1_000,
      reservations: store,
    });
    expect(unknown.allowed).toBe(false);
    expect(unknown.reason).toContain('physical PostgreSQL growth bound');
    expect(zero.allowed).toBe(false);
    expect(over.allowed).toBe(false);
    expect(over.reason).toContain('no room');
    expect(store.snapshot().protectedBytes).toBe(0);
  });

  it('counts an outstanding reservation against the next writer', async () => {
    const store = new MemoryStorageReservationStore();
    const first = await admit({
      invocationId: 'a',
      clusterBytes: CLUSTER_HALT_BYTES - 1_500,
      bound: 1_000,
      reservations: store,
    });
    const second = await admit({
      invocationId: 'b',
      clusterBytes: CLUSTER_HALT_BYTES - 1_500,
      bound: 1_000,
      reservations: store,
    });
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(second.reservedBytes).toBe(1_000);
    expect(store.snapshot().protectedBytes).toBe(1_000);
  });

  it('does not double-spend a retried invocation and leaves an interrupted write protected', async () => {
    const store = new MemoryStorageReservationStore();
    const input = {
      invocationId: 'same',
      clusterBytes: CLUSTER_HALT_BYTES - 1_500,
      bound: 1_000,
      reservations: store,
    };
    const first = await admit(input);
    const retry = await admit(input);
    expect(first.allowed).toBe(true);
    expect(retry.allowed).toBe(true);
    expect(retry.reason).toContain('already holds');
    expect(store.snapshot().protectedBytes).toBe(1_000);
    const other = await admit({ ...input, invocationId: 'other' });
    expect(other.allowed).toBe(false);
    expect(store.snapshot().active.same).toBeDefined();
  });

  it('drops a settled reservation only after a newer measurement', async () => {
    const store = new MemoryStorageReservationStore();
    const held = await admit({ invocationId: 'done', clusterBytes: 1_000, bound: 400, reservations: store });
    expect(held.allowed).toBe(true);
    await held.settle();
    const sameMeasurement = await admit({
      invocationId: 'next',
      clusterBytes: CLUSTER_HALT_BYTES - 500,
      bound: 400,
      reservations: store,
    });
    expect(sameMeasurement.allowed).toBe(false);
    const later = await admit({
      invocationId: 'later',
      clusterBytes: CLUSTER_HALT_BYTES - 500,
      bound: 400,
      reservations: store,
      measurement: measurement(CLUSTER_HALT_BYTES - 500, { measuredAt: '2026-11-19T16:30:00.000Z' }),
      now: '2026-11-19T16:30:00.000Z',
    });
    expect(later.allowed).toBe(true);
    expect(store.snapshot().settled.done).toBeUndefined();
  });

  it('does not reconcile a settled hold from a measurement taken during its write', async () => {
    const store = new MemoryStorageReservationStore();
    const bound = 29_179_904;
    const cluster = 399_167_665;
    const admissionDb = '2026-11-20T02:00:00.000Z';
    const duringWriteDb = '2026-11-20T02:00:10.000Z';
    const postWriteDb = '2026-11-20T02:00:20.000Z';
    const writerA = await admit({
      reservations: store,
      invocationId: 'invoke-a',
      clusterBytes: cluster,
      bound,
      now: admissionDb,
      measurement: measurement(cluster, { measuredAt: admissionDb, databaseObservedAt: admissionDb }),
    });
    expect(writerA.allowed).toBe(true);
    await writerA.settle({ databaseObservedAt: postWriteDb });
    expect(store.snapshot().settled['invoke-a']).toMatchObject({
      boundBytes: bound,
      observedThrough: postWriteDb,
    });

    const writerB = await admit({
      reservations: store,
      invocationId: 'invoke-b',
      clusterBytes: cluster,
      bound,
      now: '2026-11-20T02:00:40.000Z',
      measurement: measurement(cluster, {
        measuredAt: '2026-11-20T02:00:40.000Z',
        databaseObservedAt: duringWriteDb,
      }),
    });
    expect(writerB.allowed).toBe(false);
    expect(store.snapshot().settled['invoke-a']?.boundBytes).toBe(bound);
    expect(store.snapshot().active['invoke-b']).toBeUndefined();
    expect(store.snapshot().protectedBytes).toBe(bound);

    const retry = await admit({
      reservations: store,
      invocationId: 'invoke-a',
      clusterBytes: cluster,
      bound,
      now: '2026-11-20T02:00:40.000Z',
      measurement: measurement(cluster, {
        measuredAt: '2026-11-20T02:00:40.000Z',
        databaseObservedAt: postWriteDb,
      }),
    });
    expect(retry.allowed).toBe(true);
    expect(retry.reason).toContain('already holds');
    expect(store.snapshot().protectedBytes).toBe(bound);

    const laterDb = '2026-11-20T02:01:00.000Z';
    const next = await admit({
      reservations: store,
      invocationId: 'invoke-c',
      clusterBytes: cluster,
      bound,
      now: laterDb,
      measurement: measurement(cluster, { measuredAt: laterDb, databaseObservedAt: laterDb }),
    });
    expect(next.allowed).toBe(true);
    expect(store.snapshot().settled['invoke-a']).toBeUndefined();
    expect(store.snapshot().active['invoke-c']?.boundBytes).toBe(bound);
    expect(store.snapshot().protectedBytes).toBe(bound);
  });

  it('keeps an active hold and a legacy settled hold until a database observation is actually later', async () => {
    const store = new MemoryStorageReservationStore();
    const bound = 1_000;
    const cluster = 1_000_000;
    const admitted = await admit({
      reservations: store,
      invocationId: 'live',
      clusterBytes: cluster,
      bound,
      now: NOW,
      measurement: measurement(cluster, { databaseObservedAt: MEASURED }),
    });
    expect(admitted.allowed).toBe(true);
    const whileActive = await admit({
      reservations: store,
      invocationId: 'other',
      clusterBytes: CLUSTER_HALT_BYTES - 1,
      bound,
      now: '2026-11-19T18:00:00.000Z',
      measurement: measurement(CLUSTER_HALT_BYTES - 1, {
        measuredAt: '2026-11-19T18:00:00.000Z',
        databaseObservedAt: '2026-11-19T18:00:00.000Z',
      }),
    });
    expect(whileActive.allowed).toBe(false);
    expect(store.snapshot().active.live?.boundBytes).toBe(bound);
    expect(store.snapshot().protectedBytes).toBe(bound);

    await admitted.settle();
    const duringGrace = new Date(Date.parse(NOW) + 1_000).toISOString();
    const tooSoon = await admit({
      reservations: store,
      invocationId: 'soon',
      clusterBytes: CLUSTER_HALT_BYTES - 1_500,
      bound,
      now: duringGrace,
      measurement: measurement(CLUSTER_HALT_BYTES - 1_500, {
        measuredAt: duringGrace,
        databaseObservedAt: duringGrace,
      }),
    });
    expect(tooSoon.allowed).toBe(false);
    expect(store.snapshot().settled.live?.boundBytes).toBe(bound);
    expect(store.snapshot().settled.live?.observedThrough).toBeUndefined();
    expect(store.snapshot().protectedBytes).toBe(bound);

    const afterGrace = new Date(Date.parse(NOW) + LEGACY_SETTLED_RECONCILE_GRACE_MS + 1).toISOString();
    const recovered = await admit({
      reservations: store,
      invocationId: 'recovered',
      clusterBytes: CLUSTER_HALT_BYTES - 1_500,
      bound,
      now: afterGrace,
      measurement: measurement(CLUSTER_HALT_BYTES - 1_500, {
        measuredAt: afterGrace,
        databaseObservedAt: afterGrace,
      }),
    });
    expect(recovered.allowed).toBe(true);
    expect(store.snapshot().settled.live).toBeUndefined();
    expect(store.snapshot().active.recovered?.boundBytes).toBe(bound);
    expect(store.snapshot().protectedBytes).toBe(bound);
  });

  it('keeps an unfinished reservation after a newer measurement', async () => {
    const ledger = transitionReservation(
      { protectedBytes: 100, active: { live: { boundBytes: 100, writerId: 'w', operation: 'scoreboard' } }, settled: {} },
      { type: 'reconcile', measurementAt: '2026-11-19T18:00:00.000Z' }
    );
    expect(ledger.ok).toBe(true);
    if (!ledger.ok) return;
    expect(ledger.ledger.protectedBytes).toBe(100);
    expect(ledger.ledger.active.live).toBeDefined();
  });

  it('denies when the reservation service fails and admits only one of many racers', async () => {
    const broken: StorageReservationStore = {
      reserve: () => Promise.reject(new Error('dynamo unavailable')),
      settle: () => Promise.resolve(),
      noteWriteIntent: () => Promise.reject(new Error('dynamo unavailable')),
      releaseUnobserved: () => Promise.reject(new Error('dynamo unavailable')),
      releaseStranded: () => Promise.reject(new Error('dynamo unavailable')),
    };
    const failed = await admit({ reservations: broken });
    expect(failed.allowed).toBe(false);
    expect(failed.reason).toContain('reservation service failed');

    const store = new MemoryStorageReservationStore();
    const clusterBytes = CLUSTER_HALT_BYTES - 1_500;
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        admit({ invocationId: `racer-${index}`, clusterBytes, bound: 1_000, reservations: store })
      )
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect(store.snapshot().protectedBytes).toBe(1_000);
  });

  it('publishes a measurement while writes at that size are halted', async () => {
    const rows = [
      { datname: 'postgres', bytes: 460_000_000 },
      { datname: 'template1', bytes: 20_000_000 },
      { datname: 'template0', bytes: 20_000_000 },
    ];
    const total = 500_000_000;
    const session = {
      async query(sql: string) {
        if (sql === CLUSTER_DATABASE_ROWS_SQL) return { rows };
        if (sql === CLUSTER_DATABASE_TOTAL_SQL) return { rows: [{ cluster_bytes: total }] };
        return { rows: [] };
      },
    };
    const lease: ClusterMeasurementLease = { session, release: async () => undefined };
    const record = await publishClusterMeasurement({
      leasor: { acquire: async () => lease },
      store: {
        async get() {
          return null;
        },
        async put() {
          return undefined;
        },
      },
      now: NOW,
    });
    expect(record.valid).toBe(true);
    expect(record.clusterBytes).toBe(total);
    const decision = await admit({
      kind: 'game_status',
      tables: ['analytics.games', 'raw.acquisition_requests'],
      measurement: measurement(record.clusterBytes ?? 0, { measuredAt: record.measuredAt }),
    });
    expect(decision.allowed).toBe(false);
  });
});

describe('dynamo conditional reservation', () => {
  it('lets one of two concurrent conditional updates consume the allowance', async () => {
    let version = 0;
    let json = JSON.stringify({ protectedBytes: 0, active: {}, settled: {} });
    let updates = 0;
    const client: StorageReservationDynamoClient = {
      async send(command) {
        if (command instanceof GetItemCommand) {
          expect(command.input.ConsistentRead).toBe(true);
          expect(command.input.TableName).toBe(STORAGE_RESERVATION_TABLE_NAME);
          return {
            Item: {
              ledger_version: { N: String(version) },
              ledger_json: { S: json },
            } as Record<string, AttributeValue>,
          };
        }
        if (command instanceof UpdateItemCommand) {
          expect(command.input.ConditionExpression).toBe(STORAGE_RESERVATION_CONDITION);
          const seen = Number(command.input.ExpressionAttributeValues?.[':seen']?.N);
          updates += 1;
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
    const clusterBytes = CLUSTER_HALT_BYTES - 1_500;
    const [left, right] = await Promise.all([
      admit({ invocationId: 'left', clusterBytes, bound: 1_000, reservations: store, kind: 'game_status', tables: ['analytics.games'] }),
      admit({ invocationId: 'right', clusterBytes, bound: 1_000, reservations: store, kind: 'scoreboard' }),
    ]);
    const winners = [left, right].filter((result) => result.allowed);
    expect(winners).toHaveLength(1);
    expect(updates).toBeGreaterThan(1);
    const retry = await admit({
      invocationId: winners[0]?.invocationId ?? 'left',
      clusterBytes,
      bound: 1_000,
      reservations: store,
    });
    expect(retry.allowed).toBe(true);
    expect(retry.reason).toContain('already holds');
    expect(JSON.parse(json).protectedBytes).toBe(1_000);
  });
});

describe('unobserved terminal failure', () => {
  it('releases one invocation without touching another hold or the ceiling', async () => {
    const store = new MemoryStorageReservationStore();
    const bound = 1_000;
    const essentialBound = 2_000;
    const cluster = CLUSTER_HALT_BYTES - 10_000;
    const failed = await admit({
      reservations: store,
      invocationId: 'props-failed',
      clusterBytes: cluster,
      bound,
      kind: 'scoreboard',
      tables: ['raw.player_prop_game_runs'],
    });
    const essential = await admit({
      reservations: store,
      invocationId: 'scoreboard-live',
      clusterBytes: cluster,
      bound: essentialBound,
      kind: 'scoreboard',
    });
    expect(failed.allowed).toBe(true);
    expect(essential.allowed).toBe(true);
    expect(store.snapshot().protectedBytes).toBe(bound + essentialBound);

    await failed.releaseUnobserved();
    await failed.releaseUnobserved();
    expect(store.snapshot().protectedBytes).toBe(essentialBound);
    expect(store.snapshot().active['props-failed']).toBeUndefined();
    expect(store.snapshot().settled['props-failed']?.bytesReleased).toBe(true);
    expect(store.snapshot().settled['props-failed']?.observedThrough).toBeUndefined();
    expect(store.snapshot().active['scoreboard-live']?.boundBytes).toBe(essentialBound);

    await essential.settle();
    expect(store.snapshot().protectedBytes).toBe(essentialBound);
    expect(store.snapshot().settled['scoreboard-live']?.bytesReleased).toBeUndefined();
    expect(CLUSTER_HALT_BYTES).toBe(450_000_000);
  });

  it('does not release a different invocation or drive protected bytes negative', () => {
    const ledger = {
      protectedBytes: 100,
      active: {
        mine: { boundBytes: 40, writerId: 'player-props-worker', operation: 'current_board' },
        other: { boundBytes: 60, writerId: 'scoreboard-collector', operation: 'scoreboard' },
      },
      settled: {},
    };
    const wrong = transitionReservation(ledger, {
      type: 'releaseUnobserved',
      invocationId: 'other',
      writerId: 'player-props-worker',
      boundBytes: 40,
      settledAt: NOW,
    });
    expect(wrong.ok).toBe(false);
    const released = transitionReservation(ledger, {
      type: 'releaseUnobserved',
      invocationId: 'mine',
      writerId: 'player-props-worker',
      boundBytes: 40,
      settledAt: NOW,
    });
    expect(released.ok).toBe(true);
    if (!released.ok) return;
    expect(released.ledger.protectedBytes).toBe(60);
    expect(released.ledger.active.other?.boundBytes).toBe(60);
    const again = transitionReservation(released.ledger, {
      type: 'releaseUnobserved',
      invocationId: 'mine',
      writerId: 'player-props-worker',
      boundBytes: 40,
      settledAt: NOW,
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.idempotent).toBe(true);
    expect(again.ledger.protectedBytes).toBe(60);
    const short = transitionReservation(
      { protectedBytes: 10, active: { mine: { boundBytes: 40, writerId: 'w', operation: 'current_board' } }, settled: {} },
      { type: 'releaseUnobserved', invocationId: 'mine', writerId: 'w', boundBytes: 40, settledAt: NOW }
    );
    expect(short.ok).toBe(false);
  });
});
