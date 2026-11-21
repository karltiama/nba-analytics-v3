import { describe, expect, it } from 'vitest';
import {
  CLUSTER_DATABASE_ROWS_SQL,
  CLUSTER_DATABASE_TOTAL_SQL,
  CLUSTER_MEASUREMENT_BEGIN_SQL,
  CLUSTER_MEASUREMENT_MIN_INTERVAL_MS,
  CLUSTER_MEASUREMENT_ROLLBACK_SQL,
  CLUSTER_MEASUREMENT_SCHEMA_VERSION,
  CLUSTER_MEASUREMENT_TIMEOUT_SQL,
  MemoryClusterMeasurementStore,
  collectClusterMeasurement,
  publishClusterMeasurement,
  readClusterMeasurement,
  unavailableClusterMeasurementLeasor,
  unavailableClusterMeasurementStore,
  type ClusterMeasurementLease,
  type ClusterMeasurementLeasor,
  type ClusterMeasurementSession,
  type ClusterMeasurementStore,
} from '@/lib/ops/cluster-measurement';
import { CLUSTER_HALT_BYTES, decideLabeledStorageWrite } from '@/lib/ops/storage-budget';

const PHASE_B1_ROWS = [
  { datname: 'postgres', bytes: 463_572_115 },
  { datname: 'template1', bytes: 7_586_319 },
  { datname: 'template0', bytes: 7_504_399 },
];
const PHASE_B1_TOTAL = 478_662_833;

type FailAt = 'begin' | 'timeout' | 'rows' | 'total' | 'rollback';

function openLease(rows: readonly Record<string, unknown>[], total: unknown, failAt?: FailAt, releaseError?: string) {
  const queries: string[] = [];
  const sessions: ClusterMeasurementSession[] = [];
  const session: ClusterMeasurementSession = {
    async query(sql: string) {
      sessions.push(session);
      queries.push(sql);
      if (failAt === 'begin' && sql === CLUSTER_MEASUREMENT_BEGIN_SQL) {
        throw new Error('canceling statement due to statement timeout postgresql://user:secret@db.example/postgres');
      }
      if (failAt === 'timeout' && sql === CLUSTER_MEASUREMENT_TIMEOUT_SQL) throw new Error('set local failed');
      if (failAt === 'rows' && sql === CLUSTER_DATABASE_ROWS_SQL) throw new Error('statement timeout');
      if (failAt === 'total' && sql === CLUSTER_DATABASE_TOTAL_SQL) throw new Error('statement timeout');
      if (failAt === 'rollback' && sql === CLUSTER_MEASUREMENT_ROLLBACK_SQL) throw new Error('rollback failed');
      if (sql === CLUSTER_DATABASE_ROWS_SQL) return { rows };
      if (sql === CLUSTER_DATABASE_TOTAL_SQL) return { rows: [{ cluster_bytes: total }] };
      return { rows: [] };
    },
  };
  const state: { result: 'clean' | 'discard' | null; calls: number } = { result: null, calls: 0 };
  const pool = { idle: [] as ClusterMeasurementSession[], discarded: [] as ClusterMeasurementSession[] };
  const lease: ClusterMeasurementLease = {
    session,
    async release(result) {
      state.calls += 1;
      if (state.calls > 1) throw new Error('session released twice');
      state.result = result;
      if (releaseError) throw new Error(releaseError);
      if (result === 'clean') pool.idle.push(session);
      else pool.discarded.push(session);
    },
  };
  let acquisitions = 0;
  const leasor: ClusterMeasurementLeasor = {
    async acquire() {
      acquisitions += 1;
      return lease;
    },
  };
  return { lease, leasor, queries, sessions, session, state, pool, acquisitions: () => acquisitions };
}

class RejectingPutStore implements ClusterMeasurementStore {
  constructor(private readonly inner: MemoryClusterMeasurementStore) {}

  get() {
    return this.inner.get();
  }

  async put(): Promise<void> {
    throw new Error('measurement store rejected the write');
  }
}

describe('cluster measurement collection', () => {
  const now = '2026-11-18T20:00:00.000Z';

  it('reads every database, including template0, and reconciles the independent total', async () => {
    expect(CLUSTER_DATABASE_ROWS_SQL).not.toContain('datallowconn');
    expect(CLUSTER_DATABASE_TOTAL_SQL).not.toContain('current_database');
    expect(CLUSTER_DATABASE_TOTAL_SQL).toContain('clock_timestamp()');
    const session = openLease(PHASE_B1_ROWS, String(PHASE_B1_TOTAL));
    const collected = await collectClusterMeasurement(session.lease);
    expect(collected.valid).toBe(true);
    expect(collected.clusterBytes).toBe(PHASE_B1_TOTAL);
    expect(session.queries).toEqual([
      CLUSTER_MEASUREMENT_BEGIN_SQL,
      CLUSTER_MEASUREMENT_TIMEOUT_SQL,
      CLUSTER_DATABASE_ROWS_SQL,
      CLUSTER_DATABASE_TOTAL_SQL,
      'rollback',
    ]);
    const store = new MemoryClusterMeasurementStore();
    const published = await publishClusterMeasurement({ leasor: openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL).leasor, store, now });
    expect(published.valid).toBe(true);
    expect(published.clusterBytes).toBe(PHASE_B1_TOTAL);
    expect(published.schemaVersion).toBe(CLUSTER_MEASUREMENT_SCHEMA_VERSION);
  });

  it('rejects a catalog that drops template0', async () => {
    const rows = PHASE_B1_ROWS.filter((row) => row.datname !== 'template0');
    const partial = 463_572_115 + 7_586_319;
    const collected = await collectClusterMeasurement(openLease(rows, partial).lease);
    expect(collected.valid).toBe(false);
    expect(collected.clusterBytes).toBeNull();
  });

  it('rejects a repeated database name', async () => {
    const rows = [...PHASE_B1_ROWS, { datname: 'template0', bytes: 1 }];
    const collected = await collectClusterMeasurement(openLease(rows, PHASE_B1_TOTAL + 1).lease);
    expect(collected.valid).toBe(false);
    expect(collected.clusterBytes).toBeNull();
  });

  it('includes an additional database in the reconciled total', async () => {
    const rows = [...PHASE_B1_ROWS, { datname: 'extra', bytes: 10 }];
    const collected = await collectClusterMeasurement(openLease(rows, PHASE_B1_TOTAL + 10).lease);
    expect(collected).toMatchObject({ valid: true, clusterBytes: PHASE_B1_TOTAL + 10 });
  });

  it('rejects unsafe, fractional, and negative sizes', async () => {
    const fractional = await collectClusterMeasurement(
      openLease([{ datname: 'postgres', bytes: 1.5 }, { datname: 'template1', bytes: 1 }, { datname: 'template0', bytes: 1 }], 3).lease
    );
    expect(fractional.valid).toBe(false);
    const negative = await collectClusterMeasurement(openLease(PHASE_B1_ROWS, -1).lease);
    expect(negative.valid).toBe(false);
    const unsafe = await collectClusterMeasurement(openLease(PHASE_B1_ROWS, `${Number.MAX_SAFE_INTEGER}9`).lease);
    expect(unsafe.valid).toBe(false);
  });

  it('fails closed when the row sum and the independent total disagree', async () => {
    const collected = await collectClusterMeasurement(openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL - 1).lease);
    expect(collected.valid).toBe(false);
    expect(collected.clusterBytes).toBeNull();
    const store = new MemoryClusterMeasurementStore();
    const published = await publishClusterMeasurement({
      leasor: openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL - 1).leasor,
      store,
      now,
    });
    expect(published.valid).toBe(false);
    expect(published.clusterBytes).toBeNull();
  });

  it('publishes no valid record when a query times out, and redacts connection text', async () => {
    const store = new MemoryClusterMeasurementStore();
    const published = await publishClusterMeasurement({
      leasor: openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL, 'begin').leasor,
      store,
      now,
    });
    expect(published.valid).toBe(false);
    expect(published.clusterBytes).toBeNull();
    expect(published.measuredAt).toBeNull();
    expect(published.reason).not.toContain('secret');
    expect(published.reason).toContain('[redacted]');
    const rowsFailed = await collectClusterMeasurement(openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL, 'rows').lease);
    expect(rowsFailed.valid).toBe(false);
  });
});

describe('cluster measurement reader', () => {
  const now = '2026-11-18T20:00:00.000Z';

  it('rejects a missing record', () => {
    expect(readClusterMeasurement(null, now)).toEqual({ valid: false, clusterBytes: null, measuredAt: null });
  });

  it('rejects stale and future-dated measurements without moving the timestamp', () => {
    const staleAt = new Date(Date.parse(now) - 60 * 60 * 1000 - 1).toISOString();
    const staleRecord = {
      schemaVersion: CLUSTER_MEASUREMENT_SCHEMA_VERSION,
      valid: true,
      clusterBytes: 1_000,
      measuredAt: staleAt,
      reason: null,
    };
    expect(readClusterMeasurement(staleRecord, now).valid).toBe(false);
    expect(staleRecord.measuredAt).toBe(staleAt);
    const future = { ...staleRecord, measuredAt: '2026-11-18T20:00:00.001Z' };
    expect(readClusterMeasurement(future, now).valid).toBe(false);
  });

  it('rejects a malformed timestamp, a bad size, and an unsupported version', () => {
    const base = {
      schemaVersion: CLUSTER_MEASUREMENT_SCHEMA_VERSION,
      valid: true,
      clusterBytes: 1_000,
      measuredAt: now,
      reason: null,
    };
    expect(readClusterMeasurement({ ...base, measuredAt: 'yesterday' }, now).valid).toBe(false);
    expect(readClusterMeasurement({ ...base, clusterBytes: 1.5 }, now).valid).toBe(false);
    expect(readClusterMeasurement({ ...base, clusterBytes: -1 }, now).valid).toBe(false);
    expect(readClusterMeasurement({ ...base, schemaVersion: 2 }, now).valid).toBe(false);
    expect(readClusterMeasurement({ ...base, valid: false }, now).valid).toBe(false);
  });

  it('does not keep a previous reading alive after a failed publish', async () => {
    const store = new MemoryClusterMeasurementStore();
    const firstNow = '2026-11-18T18:00:00.000Z';
    await publishClusterMeasurement({
      leasor: openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL).leasor,
      store,
      now: firstNow,
    });
    const failed = await publishClusterMeasurement({
      leasor: openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL, 'total').leasor,
      store,
      now,
    });
    expect(failed.valid).toBe(false);
    expect(failed.clusterBytes).toBeNull();
    expect(failed.measuredAt).toBeNull();
    const measurement = readClusterMeasurement(await store.get(), now);
    expect(measurement.valid).toBe(false);
    expect(
      decideLabeledStorageWrite({ kind: 'current_season_ingestion' }, measurement, now, { estimatedPayloadBytes: 1 }).allowed
    ).toBe(false);
  });

  it('lets a stopped publisher age out instead of refreshing the previous timestamp', async () => {
    const store = new MemoryClusterMeasurementStore();
    const firstNow = '2026-11-18T18:00:00.000Z';
    await publishClusterMeasurement({
      leasor: openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL).leasor,
      store,
      now: firstNow,
    });
    const stored = await store.get();
    const later = new Date(Date.parse(firstNow) + 60 * 60 * 1000 + 1).toISOString();
    expect(readClusterMeasurement(stored, later).valid).toBe(false);
    expect(stored?.measuredAt).toBe(firstNow);
  });

  it('does not query again or rewrite a valid record inside 15 minutes', async () => {
    const store = new MemoryClusterMeasurementStore();
    await publishClusterMeasurement({
      leasor: openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL).leasor,
      store,
      now,
    });
    const again = openLease([{ datname: 'postgres', bytes: 1 }], 1);
    const fiveMinutes = new Date(Date.parse(now) + 5 * 60 * 1000).toISOString();
    const skipped = await publishClusterMeasurement({ leasor: again.leasor, store, now: fiveMinutes });
    expect(skipped.measuredAt).toBe(now);
    expect(skipped.clusterBytes).toBe(PHASE_B1_TOTAL);
    expect(again.queries).toEqual([]);
    expect(again.acquisitions()).toBe(0);
    expect(CLUSTER_MEASUREMENT_MIN_INTERVAL_MS).toBe(15 * 60 * 1000);
  });

  it('feeds a valid publication into the admission contract', async () => {
    const store = new MemoryClusterMeasurementStore();
    const published = await publishClusterMeasurement({
      leasor: openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL).leasor,
      store,
      now,
    });
    const measurement = readClusterMeasurement(published, now);
    expect(measurement).toEqual({ valid: true, clusterBytes: PHASE_B1_TOTAL, measuredAt: now });
    const historicalSize = decideLabeledStorageWrite(
      { kind: 'current_season_ingestion', requestedCategory: 'optional_backfill' },
      measurement,
      now,
      { estimatedPayloadBytes: 1_000 }
    );
    expect(historicalSize.pressure).toBe('halt');
    expect(historicalSize.allowed).toBe(false);
    expect(PHASE_B1_TOTAL).toBeGreaterThanOrEqual(CLUSTER_HALT_BYTES);
    expect(decideLabeledStorageWrite({ kind: 's3_archive' }, { valid: false }, now).allowed).toBe(true);

    const underHalt = await publishClusterMeasurement({
      leasor: openLease(
        [
          { datname: 'postgres', bytes: 100 },
          { datname: 'template1', bytes: 40 },
          { datname: 'template0', bytes: 20 },
        ],
        160
      ).leasor,
      store: new MemoryClusterMeasurementStore(),
      now,
    });
    const admitted = decideLabeledStorageWrite(
      { kind: 'current_season_ingestion' },
      readClusterMeasurement(underHalt, now),
      now,
      { estimatedPayloadBytes: 2_000_000 }
    );
    expect(admitted.allowed).toBe(true);
    expect(admitted.category).toBe('current_season_box');
  });

  it('refuses the live store without a network client', async () => {
    const store = unavailableClusterMeasurementStore();
    await expect(store.get()).rejects.toThrow(/not available/);
    await expect(store.put({ schemaVersion: 1, valid: false, clusterBytes: null, measuredAt: null, reason: null })).rejects.toThrow(
      /not available/
    );
    await expect(unavailableClusterMeasurementLeasor().acquire()).rejects.toThrow(/not available/);
  });
});

describe('transaction cleanup', () => {
  const now = '2026-11-18T20:00:00.000Z';

  it('does not publish a valid result when rollback fails after both selects', async () => {
    const opened = openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL, 'rollback');
    const collected = await collectClusterMeasurement(opened.lease);
    expect(collected.valid).toBe(false);
    expect(collected.clusterBytes).toBeNull();
    expect(collected.reason).toContain('rollback failed');
    expect(opened.state.result).toBe('discard');
    expect(opened.pool.idle).toEqual([]);
    expect(opened.pool.discarded).toEqual([opened.session]);
    const store = new MemoryClusterMeasurementStore();
    const published = await publishClusterMeasurement({ leasor: openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL, 'rollback').leasor, store, now });
    expect(published.valid).toBe(false);
    expect(published.clusterBytes).toBeNull();
    expect(published.measuredAt).toBeNull();
  });

  it('does not publish a valid result when release fails after a successful rollback', async () => {
    const opened = openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL, undefined, 'release failed');
    const collected = await collectClusterMeasurement(opened.lease);
    expect(collected.valid).toBe(false);
    expect(collected.clusterBytes).toBeNull();
    expect(collected.reason).toContain('release failed');
    expect(opened.pool.idle).toEqual([]);
    expect(opened.pool.discarded).toEqual([]);
    expect(opened.state.calls).toBe(1);
    const published = await publishClusterMeasurement({
      leasor: openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL, undefined, 'release failed').leasor,
      store: new MemoryClusterMeasurementStore(),
      now,
    });
    expect(published).toMatchObject({ valid: false, clusterBytes: null, measuredAt: null });
  });

  it('runs every statement on the one acquired session', async () => {
    const opened = openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL);
    await collectClusterMeasurement(opened.lease);
    expect(opened.sessions.length).toBeGreaterThan(0);
    expect(opened.sessions.every((seen) => seen === opened.session)).toBe(true);
    expect(opened.lease.session).toBe(opened.session);
    expect(opened.state.result).toBe('clean');
    expect(opened.pool.idle).toEqual([opened.session]);
  });

  it('keeps an invalid result when an earlier statement fails and rollback then succeeds', async () => {
    const timeout = openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL, 'timeout');
    const collected = await collectClusterMeasurement(timeout.lease);
    expect(collected.valid).toBe(false);
    expect(timeout.queries).toContain(CLUSTER_MEASUREMENT_ROLLBACK_SQL);
    expect(timeout.state.result).toBe('clean');
    expect(timeout.pool.discarded).toEqual([]);

    const began = openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL, 'begin');
    const beginFailed = await collectClusterMeasurement(began.lease);
    expect(beginFailed.valid).toBe(false);
    expect(began.queries).not.toContain(CLUSTER_MEASUREMENT_ROLLBACK_SQL);
    expect(began.state.result).toBe('clean');

    const afterSelect = openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL, 'rows');
    const selectFailed = await collectClusterMeasurement(afterSelect.lease);
    expect(selectFailed.valid).toBe(false);
    expect(afterSelect.state.result).toBe('clean');

    const both = openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL, 'rollback');
    both.lease.session.query = async (sql: string) => {
      if (sql === CLUSTER_DATABASE_ROWS_SQL) throw new Error('statement timeout');
      if (sql === CLUSTER_MEASUREMENT_ROLLBACK_SQL) throw new Error('rollback failed');
      return { rows: [] };
    };
    const joined = await collectClusterMeasurement(both.lease);
    expect(joined.valid).toBe(false);
    expect(joined.reason).toContain('statement timeout');
    expect(joined.reason).toContain('rollback failed');
    expect(both.state.result).toBe('discard');
  });

  it('does not restamp a previous measurement when cleanup fails or the store rejects the write', async () => {
    const store = new MemoryClusterMeasurementStore();
    const firstNow = '2026-11-18T18:00:00.000Z';
    await publishClusterMeasurement({
      leasor: openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL).leasor,
      store,
      now: firstNow,
    });
    const published = await publishClusterMeasurement({
      leasor: openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL, 'rollback').leasor,
      store,
      now,
    });
    expect(published).toMatchObject({ valid: false, clusterBytes: null, measuredAt: null });
    expect((await store.get())?.measuredAt).toBeNull();

    const kept = new MemoryClusterMeasurementStore();
    await publishClusterMeasurement({
      leasor: openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL).leasor,
      store: kept,
      now: firstNow,
    });
    const rejecting = new RejectingPutStore(kept);
    const stillFresh = '2026-11-18T18:30:00.000Z';
    await expect(
      publishClusterMeasurement({
        leasor: openLease(PHASE_B1_ROWS, PHASE_B1_TOTAL, 'total').leasor,
        store: rejecting,
        now: stillFresh,
      })
    ).rejects.toThrow(/rejected the write/);
    const stored = await kept.get();
    expect(stored).toMatchObject({ valid: true, clusterBytes: PHASE_B1_TOTAL, measuredAt: firstNow });
    expect(
      decideLabeledStorageWrite({ kind: 'current_season_ingestion' }, readClusterMeasurement(stored, stillFresh), stillFresh, {
        estimatedPayloadBytes: 1,
      }).pressure
    ).toBe('halt');
  });
});
