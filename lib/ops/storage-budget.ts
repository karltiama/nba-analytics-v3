/**
 * Free-plan database-size budget.
 * The quota is 500,000,000 bytes of sum(pg_database_size), not 500 MiB of
 * the current database alone. These helpers do not open a connection.
 */

export const FREE_PLAN_QUOTA_BYTES = 500_000_000;

/** The mebibyte figure the checkpoint used to treat as 500 MB. It is not the quota. */
export const FIVE_HUNDRED_MEBIBYTES = 500 * 1024 * 1024;

export type QuotaStatus = 'under' | 'at_quota' | 'over' | 'unmeasured';

export type ClusterSizeMeasurement =
  | {
      ok: true;
      databases: readonly { datname: string; bytes: number }[];
      clusterBytes: number;
    }
  | { ok: false; reason: 'missing' | 'invalid' };

export type QuotaClassification = {
  status: QuotaStatus;
  quotaBytes: typeof FREE_PLAN_QUOTA_BYTES;
  clusterBytes: number | null;
  /** True only when a finite cluster sum is strictly below the quota. */
  pass: boolean;
};

export function sumClusterDatabaseBytes(
  rows: readonly { datname?: unknown; bytes?: unknown }[] | null | undefined
): ClusterSizeMeasurement {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, reason: 'missing' };
  const databases: { datname: string; bytes: number }[] = [];
  for (const row of rows) {
    const datname = typeof row.datname === 'string' ? row.datname.trim() : '';
    const bytes = typeof row.bytes === 'number' ? row.bytes : Number(row.bytes);
    if (!datname || !Number.isSafeInteger(bytes) || bytes < 0) return { ok: false, reason: 'invalid' };
    databases.push({ datname, bytes });
  }
  const clusterBytes = databases.reduce((sum, database) => sum + database.bytes, 0);
  if (!Number.isSafeInteger(clusterBytes)) return { ok: false, reason: 'invalid' };
  return { ok: true, databases, clusterBytes };
}

export function classifyFreePlanQuota(clusterBytes: number | null | undefined): QuotaClassification {
  if (typeof clusterBytes !== 'number' || !Number.isSafeInteger(clusterBytes) || clusterBytes < 0) {
    return { status: 'unmeasured', quotaBytes: FREE_PLAN_QUOTA_BYTES, clusterBytes: null, pass: false };
  }
  const status: QuotaStatus =
    clusterBytes < FREE_PLAN_QUOTA_BYTES ? 'under' : clusterBytes === FREE_PLAN_QUOTA_BYTES ? 'at_quota' : 'over';
  return {
    status,
    quotaBytes: FREE_PLAN_QUOTA_BYTES,
    clusterBytes,
    pass: status === 'under',
  };
}

/**
 * A current-database reading under the quota is not a cluster pass when
 * other databases push the sum to the quota or past it.
 */
export function currentDatabaseQuotaIsFalsePass(currentDatabaseBytes: number, clusterBytes: number): boolean {
  return classifyFreePlanQuota(currentDatabaseBytes).pass && !classifyFreePlanQuota(clusterBytes).pass;
}

/** Decimal bytes. These are not mebibytes. */
export const CLUSTER_WARNING_BYTES = 350_000_000;
export const CLUSTER_RESTRICT_BYTES = 400_000_000;
export const CLUSTER_HALT_BYTES = 450_000_000;
export const STORAGE_MEASUREMENT_MAX_AGE_MS = 60 * 60 * 1000;

export type StorageWriteCategory =
  | 'historical_raw_props'
  | 'historical_raw_odds'
  | 'optional_backfill'
  | 'current_board'
  | 'game_status'
  | 'scoreboard'
  | 's3_archive';

export type StoragePressure = 'ok' | 'warning' | 'restrict' | 'halt' | 'quota' | 'unmeasured' | 'stale';

export type StorageMeasurement = {
  clusterBytes?: number | null;
  measuredAt?: string | null;
  valid?: boolean | null;
};

export type StorageWriteDecision = {
  category: StorageWriteCategory;
  allowed: boolean;
  pressure: StoragePressure;
  reason: string;
};

const HIGH_VOLUME = new Set<StorageWriteCategory>([
  'historical_raw_props',
  'historical_raw_odds',
  'optional_backfill',
  'current_board',
  'scoreboard',
]);

const OPTIONAL_HISTORICAL = new Set<StorageWriteCategory>([
  'historical_raw_props',
  'historical_raw_odds',
  'optional_backfill',
]);

export function storagePressure(clusterBytes: number): StoragePressure {
  if (clusterBytes >= FREE_PLAN_QUOTA_BYTES) return 'quota';
  if (clusterBytes >= CLUSTER_HALT_BYTES) return 'halt';
  if (clusterBytes >= CLUSTER_RESTRICT_BYTES) return 'restrict';
  if (clusterBytes >= CLUSTER_WARNING_BYTES) return 'warning';
  return 'ok';
}

function measurementAgeMs(measuredAt: string, now: string): number | null {
  const measured = Date.parse(measuredAt);
  const current = Date.parse(now);
  if (!Number.isFinite(measured) || !Number.isFinite(current)) return null;
  return current - measured;
}

/**
 * Cached measurement only. Does not open PostgreSQL or SSM.
 * S3 archival stays allowed when the database gate is closed.
 * game_status may continue between the high-volume halt and the quota,
 * and only while the measurement is fresh. It stops at 500,000,000 bytes.
 */
export function decideStorageWrite(category: StorageWriteCategory, measurement: StorageMeasurement, now: string): StorageWriteDecision {
  if (category === 's3_archive') {
    return { category, allowed: true, pressure: 'ok', reason: 's3 archival does not depend on the database-size gate' };
  }

  if (measurement.valid !== true) {
    return { category, allowed: false, pressure: 'unmeasured', reason: 'cluster size measurement is missing or invalid' };
  }
  const clusterBytes = measurement.clusterBytes;
  if (typeof clusterBytes !== 'number' || !Number.isSafeInteger(clusterBytes) || clusterBytes < 0) {
    return { category, allowed: false, pressure: 'unmeasured', reason: 'cluster size measurement is missing or invalid' };
  }
  if (typeof measurement.measuredAt !== 'string') {
    return { category, allowed: false, pressure: 'unmeasured', reason: 'cluster size measurement has no timestamp' };
  }
  const age = measurementAgeMs(measurement.measuredAt, now);
  if (age == null || age < 0 || age > STORAGE_MEASUREMENT_MAX_AGE_MS) {
    return { category, allowed: false, pressure: 'stale', reason: 'cluster size measurement is older than 60 minutes or has a bad timestamp' };
  }

  const pressure = storagePressure(clusterBytes);
  if (pressure === 'quota') {
    return { category, allowed: false, pressure, reason: 'cluster is at or above the 500,000,000 byte quota' };
  }
  if (HIGH_VOLUME.has(category) && pressure === 'halt') {
    return { category, allowed: false, pressure, reason: 'high-volume PostgreSQL writes stop at 450,000,000 bytes' };
  }
  if (OPTIONAL_HISTORICAL.has(category) && (pressure === 'restrict' || pressure === 'halt')) {
    return { category, allowed: false, pressure, reason: 'optional historical PostgreSQL writes stop at 400,000,000 bytes' };
  }
  if (category === 'game_status') {
    return {
      category,
      allowed: true,
      pressure,
      reason: 'game-status writes stay allowed below 500,000,000 bytes when the measurement is fresh',
    };
  }
  return { category, allowed: true, pressure, reason: 'measurement is fresh and below this category threshold' };
}
