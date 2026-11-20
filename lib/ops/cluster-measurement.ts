/**
 * Cluster-size measurement publisher and reader.
 * This module does not open PostgreSQL, AWS, or S3.
 * A future publisher calls the injected session at most once every 15 minutes
 * and writes one small record. Handlers read that record. They do not each
 * run pg_database_size. A shared reading is not a disk reservation.
 * Live publication is refused by unavailableClusterMeasurementStore.
 */

import {
  STORAGE_MEASUREMENT_MAX_AGE_MS,
  assessClusterMeasurement,
  type ClusterMeasurementAssessment,
  type StorageMeasurement,
} from '@/lib/ops/storage-budget';

export const CLUSTER_MEASUREMENT_SCHEMA_VERSION = 1;
export const CLUSTER_MEASUREMENT_STATEMENT_TIMEOUT = '15s';
export const CLUSTER_MEASUREMENT_MIN_INTERVAL_MS = 15 * 60 * 1000;

export const CLUSTER_DATABASE_ROWS_SQL = `select d.datname, pg_database_size(d.oid) as bytes
from pg_database d
order by bytes desc, d.datname`;

export const CLUSTER_DATABASE_TOTAL_SQL = `select coalesce(sum(pg_database_size(d.oid)), 0)::bigint as cluster_bytes,
       clock_timestamp() as observed_at
from pg_database d`;

export const CLUSTER_MEASUREMENT_BEGIN_SQL = 'begin read only';
export const CLUSTER_MEASUREMENT_TIMEOUT_SQL = `set local statement_timeout = '${CLUSTER_MEASUREMENT_STATEMENT_TIMEOUT}'`;
export const CLUSTER_MEASUREMENT_ROLLBACK_SQL = 'rollback';

export type ClusterMeasurementQueryResult = {
  rows: readonly Record<string, unknown>[];
};

export interface ClusterMeasurementSession {
  query(sql: string): Promise<ClusterMeasurementQueryResult>;
}

export type ClusterMeasurementRelease = 'clean' | 'discard';

/**
 * One checked-out connection. Every statement in the measurement transaction
 * uses `session`. `release('clean')` may return it to a pool. `release('discard')`
 * must not. A future pg adapter checks out with `pool.connect()`, never `pool.query`,
 * and maps discard to `client.release(error)` so node-pg destroys the client.
 * This phase does not open a pool.
 */
export interface ClusterMeasurementLease {
  readonly session: ClusterMeasurementSession;
  release(result: ClusterMeasurementRelease): Promise<void>;
}

export interface ClusterMeasurementLeasor {
  acquire(): Promise<ClusterMeasurementLease>;
}

export type ClusterMeasurementRecord = {
  schemaVersion: number;
  valid: boolean;
  clusterBytes: number | null;
  measuredAt: string | null;
  reason: string | null;
};

export interface ClusterMeasurementStore {
  get(): Promise<ClusterMeasurementRecord | null>;
  put(record: ClusterMeasurementRecord): Promise<void>;
}

export function unavailableClusterMeasurementStore(): ClusterMeasurementStore {
  const refuse = (): Promise<never> =>
    Promise.reject(new Error('live cluster measurement publication is not available in this phase'));
  return { get: refuse, put: refuse };
}

export function unavailableClusterMeasurementLeasor(): ClusterMeasurementLeasor {
  return {
    acquire() {
      return Promise.reject(new Error('live cluster measurement connections are not available in this phase'));
    },
  };
}

export class MemoryClusterMeasurementStore implements ClusterMeasurementStore {
  private record: ClusterMeasurementRecord | null = null;

  async get(): Promise<ClusterMeasurementRecord | null> {
    return this.record == null ? null : { ...this.record };
  }

  async put(record: ClusterMeasurementRecord): Promise<void> {
    this.record = { ...record };
  }
}

export function safeMeasurementReason(error: unknown): string {
  const text = error instanceof Error ? error.message : 'cluster measurement failed';
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]').slice(0, 200);
}

function normalizeInteger(value: unknown): unknown {
  if (typeof value === 'number' || typeof value === 'bigint') {
    if (typeof value === 'bigint') {
      if (value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) return Number.NaN;
      return Number(value);
    }
    return value;
  }
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
  }
  return value;
}

function invalidCollection(reason: string): ClusterMeasurementAssessment {
  return { valid: false, clusterBytes: null, reason, databaseObservedAt: null };
}

/** Same-transaction database clock. Application clocks are not a substitute. */
export function readDatabaseObservedAt(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return null;
}

function joinReasons(first: string, second: string): string {
  return `${first}; ${second}`.slice(0, 200);
}

/**
 * Rolls back only after BEGIN succeeded. A rollback or release error is returned
 * to the caller. This function does not decide that the measurement is valid.
 */
async function finishLease(lease: ClusterMeasurementLease, opened: boolean): Promise<string | null> {
  let rollbackError: string | null = null;
  if (opened) {
    try {
      await lease.session.query(CLUSTER_MEASUREMENT_ROLLBACK_SQL);
    } catch (error) {
      rollbackError = safeMeasurementReason(error);
    }
  }
  try {
    await lease.release(rollbackError == null ? 'clean' : 'discard');
  } catch (error) {
    const releaseError = safeMeasurementReason(error);
    return rollbackError == null ? releaseError : joinReasons(rollbackError, releaseError);
  }
  return rollbackError;
}

export async function collectClusterMeasurement(lease: ClusterMeasurementLease): Promise<ClusterMeasurementAssessment> {
  const session = lease.session;
  let opened = false;
  let assessment = invalidCollection('cluster measurement did not complete');
  try {
    await session.query(CLUSTER_MEASUREMENT_BEGIN_SQL);
    opened = true;
    await session.query(CLUSTER_MEASUREMENT_TIMEOUT_SQL);
    const listed = await session.query(CLUSTER_DATABASE_ROWS_SQL);
    const totaled = await session.query(CLUSTER_DATABASE_TOTAL_SQL);
    if (!Array.isArray(totaled.rows) || totaled.rows.length !== 1) {
      assessment = invalidCollection('cluster total query did not return one row');
    } else {
      assessment = {
        ...assessClusterMeasurement(listed.rows, normalizeInteger(totaled.rows[0]?.cluster_bytes)),
        databaseObservedAt: readDatabaseObservedAt(totaled.rows[0]?.observed_at),
      };
    }
  } catch (error) {
    assessment = invalidCollection(safeMeasurementReason(error));
  }

  const cleanupError = await finishLease(lease, opened);
  if (cleanupError != null) {
    const reason = assessment.valid ? cleanupError : joinReasons(assessment.reason, cleanupError);
    return invalidCollection(reason);
  }
  return assessment;
}

function ageMs(measuredAt: string, now: string): number | null {
  const measured = Date.parse(measuredAt);
  const current = Date.parse(now);
  if (!Number.isFinite(measured) || !Number.isFinite(current)) return null;
  return current - measured;
}

function failedRecord(reason: string): ClusterMeasurementRecord {
  return {
    schemaVersion: CLUSTER_MEASUREMENT_SCHEMA_VERSION,
    valid: false,
    clusterBytes: null,
    measuredAt: null,
    reason,
  };
}

/**
 * A successful publish inside the 15-minute interval leaves the stored
 * timestamp unchanged. A failed collection replaces the stored record with
 * valid:false and a null size. It does not copy the previous size forward
 * under a new timestamp.
 */
export async function publishClusterMeasurement(input: {
  leasor: ClusterMeasurementLeasor;
  store: ClusterMeasurementStore;
  now: string;
}): Promise<ClusterMeasurementRecord> {
  const existing = await input.store.get();
  if (existing?.valid === true && typeof existing.measuredAt === 'string') {
    const age = ageMs(existing.measuredAt, input.now);
    if (age != null && age >= 0 && age < CLUSTER_MEASUREMENT_MIN_INTERVAL_MS) {
      return existing;
    }
  }

  const lease = await input.leasor.acquire();
  const collected = await collectClusterMeasurement(lease);
  if (!collected.valid || collected.clusterBytes == null) {
    const failed = failedRecord(collected.reason);
    await input.store.put(failed);
    return failed;
  }

  const published: ClusterMeasurementRecord = {
    schemaVersion: CLUSTER_MEASUREMENT_SCHEMA_VERSION,
    valid: true,
    clusterBytes: collected.clusterBytes,
    measuredAt: input.now,
    reason: null,
  };
  await input.store.put(published);
  return published;
}

function rejectedMeasurement(): StorageMeasurement {
  return { valid: false, clusterBytes: null, measuredAt: null };
}

/**
 * Readers pass this result to decideLabeledStorageWrite.
 * A missing, stale, future, malformed, or invalid record is not a usable
 * measurement. This function does not change measuredAt and does not read
 * pg_database_size(current_database()).
 */
export function readClusterMeasurement(record: unknown, now: string): StorageMeasurement {
  if (record == null || typeof record !== 'object') return rejectedMeasurement();
  const candidate = record as {
    schemaVersion?: unknown;
    valid?: unknown;
    clusterBytes?: unknown;
    measuredAt?: unknown;
  };
  if (candidate.schemaVersion !== CLUSTER_MEASUREMENT_SCHEMA_VERSION) return rejectedMeasurement();
  if (candidate.valid !== true) return rejectedMeasurement();
  if (typeof candidate.clusterBytes !== 'number' || !Number.isSafeInteger(candidate.clusterBytes) || candidate.clusterBytes < 0) {
    return rejectedMeasurement();
  }
  if (typeof candidate.measuredAt !== 'string' || Number.isNaN(Date.parse(candidate.measuredAt))) {
    return rejectedMeasurement();
  }
  const age = ageMs(candidate.measuredAt, now);
  if (age == null || age < 0 || age > STORAGE_MEASUREMENT_MAX_AGE_MS) return rejectedMeasurement();
  return {
    valid: true,
    clusterBytes: candidate.clusterBytes,
    measuredAt: candidate.measuredAt,
  };
}
