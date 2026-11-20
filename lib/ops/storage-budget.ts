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

/**
 * Phase B1 counted every pg_database row, including template0.
 * This check does not open a connection, does not read datallowconn,
 * and does not accept pg_database_size(current_database()) as the total.
 * A partial row list is never valid, even when independentTotal matches that partial sum.
 */
export const REQUIRED_CLUSTER_DATABASE_NAMES = ['postgres', 'template1', 'template0'] as const;

export type ClusterMeasurementAssessment = {
  valid: boolean;
  clusterBytes: number | null;
  reason: string;
  /** PostgreSQL clock captured with the size read. Absent when the total row has none. */
  databaseObservedAt?: string | null;
};

export function assessClusterMeasurement(
  rows: readonly { datname?: unknown; bytes?: unknown }[] | null | undefined,
  independentTotal: unknown
): ClusterMeasurementAssessment {
  const measured = sumClusterDatabaseBytes(rows);
  if (!measured.ok) {
    return {
      valid: false,
      clusterBytes: null,
      reason: measured.reason === 'missing' ? 'cluster measurement rows are missing' : 'cluster measurement rows are invalid',
    };
  }
  const names = measured.databases.map((database) => database.datname);
  if (new Set(names).size !== names.length) {
    return { valid: false, clusterBytes: null, reason: 'cluster measurement repeats a database name' };
  }
  for (const required of REQUIRED_CLUSTER_DATABASE_NAMES) {
    if (!names.includes(required)) {
      return { valid: false, clusterBytes: null, reason: `cluster measurement is missing ${required}` };
    }
  }
  if (typeof independentTotal !== 'number' || !Number.isSafeInteger(independentTotal) || independentTotal !== measured.clusterBytes) {
    return { valid: false, clusterBytes: null, reason: 'cluster row sum does not match the independent total' };
  }
  return {
    valid: true,
    clusterBytes: measured.clusterBytes,
    reason: 'cluster measurement includes every required database and matches the independent total',
  };
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
/**
 * Reclamation stops if a rewrite would reach this size.
 * It is not an ingestion allowance. Writers halt at CLUSTER_HALT_BYTES.
 */
export const RECLAMATION_ABORT_BYTES = 490_000_000;
export const STORAGE_MEASUREMENT_MAX_AGE_MS = 60 * 60 * 1000;

export type StorageWriteCategory =
  | 'historical_raw_props'
  | 'historical_raw_odds'
  | 'optional_backfill'
  | 'current_board'
  | 'game_status'
  | 'scoreboard'
  | 's3_archive'
  | 'current_season_box'
  | 'injury';

/**
 * Per-operation cap for `current_season_box`.
 * This is the caller's estimate of the payload it is about to submit.
 * It is not a measurement of physical database growth: indexes, TOAST,
 * WAL, free-space maps, and existing pages can make the cluster change
 * larger or smaller than this number. The cap does not serialize other writers.
 */
export const CURRENT_SEASON_BOX_OPERATION_CAP_BYTES = 2_000_000;

export type StoragePayloadEstimate = {
  estimatedPayloadBytes?: number | null;
};

/** Declared by code at the call site. A requested category label does not override kind. */
export type StorageOperationKind =
  | 'current_season_ingestion'
  | 'historical_backfill'
  | 'historical_recovery'
  | 'historical_raw_props'
  | 'historical_raw_odds'
  | 'optional_backfill'
  | 'current_board'
  | 'game_status'
  | 'scoreboard'
  | 's3_archive'
  | 'injury_ingestion';

export type StorageOperationLabel = {
  kind: StorageOperationKind;
  requestedCategory?: StorageWriteCategory | null;
};

export type HistoricalRecoveryRequest = {
  requestedCategory?: StorageWriteCategory | null;
  /** Ignored. An approval flag does not grant historical recovery. */
  approved?: boolean | null;
  /** Ignored. A game allowlist does not grant historical recovery. */
  gameIds?: readonly string[] | null;
};

export type StoragePressure = 'ok' | 'warning' | 'restrict' | 'halt' | 'quota' | 'unmeasured' | 'stale';

export type StorageMeasurement = {
  clusterBytes?: number | null;
  measuredAt?: string | null;
  valid?: boolean | null;
};

export type StorageWriteDecision = {
  category: StorageWriteCategory | null;
  allowed: boolean;
  pressure: StoragePressure;
  reason: string;
};

const STORAGE_WRITE_CATEGORIES: readonly StorageWriteCategory[] = [
  'historical_raw_props',
  'historical_raw_odds',
  'optional_backfill',
  'current_board',
  'game_status',
  'scoreboard',
  's3_archive',
  'current_season_box',
  'injury',
];

const KIND_TO_CATEGORY = {
  current_season_ingestion: 'current_season_box',
  historical_backfill: 'optional_backfill',
  historical_recovery: 'optional_backfill',
  historical_raw_props: 'historical_raw_props',
  historical_raw_odds: 'historical_raw_odds',
  optional_backfill: 'optional_backfill',
  current_board: 'current_board',
  game_status: 'game_status',
  scoreboard: 'scoreboard',
  s3_archive: 's3_archive',
  injury_ingestion: 'injury',
} as const satisfies Record<StorageOperationKind, StorageWriteCategory>;

function isStorageWriteCategory(value: unknown): value is StorageWriteCategory {
  return typeof value === 'string' && (STORAGE_WRITE_CATEGORIES as readonly string[]).includes(value);
}

function isStorageOperationKind(value: unknown): value is StorageOperationKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(KIND_TO_CATEGORY, value);
}

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
 * Maps a code-owned operation kind to a storage class.
 * `requestedCategory` is ignored. An unknown kind returns null.
 * This does not grant a write.
 */
export function resolveStorageWriteCategory(
  operation: { kind?: unknown; requestedCategory?: unknown } | null | undefined
): StorageWriteCategory | null {
  if (operation == null || typeof operation !== 'object') return null;
  if (!isStorageOperationKind(operation.kind)) return null;
  return KIND_TO_CATEGORY[operation.kind];
}

function decideCurrentSeasonBox(
  pressure: StoragePressure,
  payload: StoragePayloadEstimate | undefined
): StorageWriteDecision {
  const category = 'current_season_box' as const;
  if (pressure === 'quota') {
    return {
      category,
      allowed: false,
      pressure,
      reason: 'current-season box writes stop at the 500,000,000 byte quota',
    };
  }
  if (pressure === 'halt') {
    return {
      category,
      allowed: false,
      pressure,
      reason: 'current-season box writes stop at 450,000,000 bytes',
    };
  }
  const bytes = payload?.estimatedPayloadBytes;
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) {
    return {
      category,
      allowed: false,
      pressure,
      reason: 'current-season box writes require a non-negative integer payload estimate',
    };
  }
  if (bytes > CURRENT_SEASON_BOX_OPERATION_CAP_BYTES) {
    return {
      category,
      allowed: false,
      pressure,
      reason: 'current-season box payload exceeds the 2,000,000 byte per-operation cap',
    };
  }
  return {
    category,
    allowed: true,
    pressure,
    reason: 'current-season box payload is within the 2,000,000 byte cap and the cluster is below 450,000,000 bytes',
  };
}

/**
 * Category gate. Not exported: a caller-supplied category is not a trusted
 * operation kind. Unknown values are denied before the S3 exemption.
 * The payload cap is the caller's estimate, not physical database growth.
 */
function decideStorageWrite(
  category: unknown,
  measurement: StorageMeasurement,
  now: string,
  payload?: StoragePayloadEstimate
): StorageWriteDecision {
  if (!isStorageWriteCategory(category)) {
    return { category: null, allowed: false, pressure: 'unmeasured', reason: 'unrecognized storage write category' };
  }
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
  if (age != null && age < 0) {
    return { category, allowed: false, pressure: 'stale', reason: 'cluster size measurement is future-dated' };
  }
  if (age == null || age > STORAGE_MEASUREMENT_MAX_AGE_MS) {
    return { category, allowed: false, pressure: 'stale', reason: 'cluster size measurement is older than 60 minutes or has a bad timestamp' };
  }

  const pressure = storagePressure(clusterBytes);
  if (pressure === 'quota') {
    return { category, allowed: false, pressure, reason: 'cluster is at or above the 500,000,000 byte quota' };
  }
  if (category === 'current_season_box') {
    return decideCurrentSeasonBox(pressure, payload);
  }
  if (HIGH_VOLUME.has(category) && pressure === 'halt') {
    return { category, allowed: false, pressure, reason: 'high-volume PostgreSQL writes stop at 450,000,000 bytes' };
  }
  if (OPTIONAL_HISTORICAL.has(category) && (pressure === 'restrict' || pressure === 'halt')) {
    return { category, allowed: false, pressure, reason: 'optional historical PostgreSQL writes stop at 400,000,000 bytes' };
  }
  if (category === 'game_status') {
    if (pressure === 'halt') {
      return {
        category,
        allowed: false,
        pressure,
        reason: 'game-status writes stop at 450,000,000 bytes',
      };
    }
    return {
      category,
      allowed: true,
      pressure,
      reason: 'game-status writes stay allowed below 450,000,000 bytes when the measurement is fresh',
    };
  }
  if (category === 'injury') {
    if (pressure === 'halt') {
      return {
        category,
        allowed: false,
        pressure,
        reason: 'injury writes stop at 450,000,000 bytes',
      };
    }
    return {
      category,
      allowed: true,
      pressure,
      reason: 'injury writes stay allowed below 450,000,000 bytes when the measurement is fresh',
    };
  }
  if (HIGH_VOLUME.has(category)) {
    return { category, allowed: true, pressure, reason: 'measurement is fresh and below this category threshold' };
  }
  return { category: null, allowed: false, pressure, reason: 'unrecognized storage write category' };
}

/**
 * Historical recovery is not current-season ingestion.
 * A requested `current_season_box` label, an approval flag, and a game
 * allowlist do not grant the write. The 36-game repair stays unauthorized.
 * This function has no approval grant. The local one-day entrypoint does
 * not call it.
 */
export function decideHistoricalRecovery(
  request: HistoricalRecoveryRequest,
  measurement: StorageMeasurement,
  now: string
): StorageWriteDecision {
  const requestedCategory = request != null && typeof request === 'object' ? request.requestedCategory : null;
  const category = resolveStorageWriteCategory({ kind: 'historical_recovery', requestedCategory });
  const observed = decideStorageWrite(category, measurement, now);
  return {
    category: category === 'optional_backfill' ? category : null,
    allowed: false,
    pressure: observed.pressure,
    reason:
      'historical recovery stays unauthorized; a current_season_box label, an allowlist, and an approval flag do not grant it',
  };
}

/**
 * Public admission decision. The kind must be chosen by handler code.
 * A category string, a requestedCategory label, or a queue payload is not a kind.
 * This function cannot detect a historical batch whose handler passed
 * kind `current_season_ingestion`. Recovery batches have to pass
 * kind `historical_recovery`. There is no exported category-only decision.
 */
export function decideLabeledStorageWrite(
  operation: StorageOperationLabel,
  measurement: StorageMeasurement,
  now: string,
  payload?: StoragePayloadEstimate
): StorageWriteDecision {
  const received: unknown = operation;
  if (received == null || typeof received !== 'object' || !isStorageOperationKind((received as { kind?: unknown }).kind)) {
    return { category: null, allowed: false, pressure: 'unmeasured', reason: 'unrecognized storage operation kind' };
  }
  const record = received as {
    kind: StorageOperationKind;
    requestedCategory?: unknown;
    approved?: unknown;
    gameIds?: unknown;
  };
  if (record.kind === 'historical_recovery') {
    return decideHistoricalRecovery(
      {
        requestedCategory: isStorageWriteCategory(record.requestedCategory) ? record.requestedCategory : null,
        approved: record.approved === true,
        gameIds: Array.isArray(record.gameIds) ? record.gameIds.filter((id): id is string => typeof id === 'string') : null,
      },
      measurement,
      now
    );
  }
  return decideStorageWrite(KIND_TO_CATEGORY[record.kind], measurement, now, payload);
}
