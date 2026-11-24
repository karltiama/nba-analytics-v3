/**
 * Current-only admission for one player-props worker message.
 * The ceiling is the shared 450,000,000-byte halt. Historical raw props stay refused.
 * A missing measurement or a reservation that does not fit refuses every Postgres write.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

import { CLUSTER_DATABASE_TOTAL_SQL } from '../../lib/ops/cluster-measurement';
import type { AdmissionMeasurement } from '../../lib/ops/storage-admission';
import {
  admitPersistentWrite,
  type StorageAdmissionDecision,
  type StorageReservationStore,
} from '../../lib/ops/storage-admission';
import {
  createDynamoStorageReservationStore,
  STORAGE_RESERVATION_TABLE_NAME,
} from '../../lib/ops/storage-reservation-dynamo';
import {
  PROPS_CURRENT_ONLY_PHYSICAL_GROWTH_BOUND_BYTES,
  PROPS_MAX_ROWS_PER_GAME,
  PROPS_PULL_CONTROL_PHYSICAL_GROWTH_BOUND_BYTES,
} from '../../lib/ops/storage-growth-bounds';
import type { StoragePressure } from '../../lib/ops/storage-budget';
import { propsPublicationMode } from './src/env';

export const PROPS_STORAGE_WRITER = 'player-props-worker';

export const PROPS_CURRENT_TABLES = [
  'analytics.player_props_current',
  'analytics.player_prop_current',
] as const;

/** Game-run, pull-run, and provider-attempt updates. No current-market tables. */
export const PROPS_S3_CONTROL_TABLES = [
  'raw.player_prop_game_runs',
  'raw.player_prop_pull_runs',
  'raw.player_prop_daily_attempts',
] as const;

export type PropsStorageMode = 'current_only' | 'halt';

export type PropsStorageDecision = {
  mode: PropsStorageMode;
  reason: string;
  pressure: StoragePressure;
  boundBytes: number;
  settle: () => Promise<void>;
};

export class PropsStorageRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PropsStorageRefusal';
  }
}

const noopSettle = async (): Promise<void> => undefined;

function halt(
  reason: string,
  pressure: StoragePressure = 'unmeasured',
  boundBytes = PROPS_CURRENT_ONLY_PHYSICAL_GROWTH_BOUND_BYTES
): PropsStorageDecision {
  return {
    mode: 'halt',
    reason,
    pressure,
    boundBytes,
    settle: noopSettle,
  };
}

/** A payload above the measured 30,000-row envelope has no reservation. */
export function assertCurrentOnlyRowCount(rowCount: number): void {
  if (!Number.isInteger(rowCount) || rowCount < 0 || rowCount > PROPS_MAX_ROWS_PER_GAME) {
    throw new PropsStorageRefusal(
      `prop payload of ${rowCount} rows exceeds the current-only envelope of ${PROPS_MAX_ROWS_PER_GAME}`
    );
  }
}

function admissionClock(requested: string, measuredAt: string | null): string {
  const requestedMs = Date.parse(requested);
  const measuredMs = measuredAt == null ? Number.NaN : Date.parse(measuredAt);
  if (Number.isFinite(requestedMs) && Number.isFinite(measuredMs) && measuredMs > requestedMs) {
    return new Date(measuredMs).toISOString();
  }
  return requested;
}

async function releaseAdmission(admission: StorageAdmissionDecision): Promise<void> {
  try {
    await admission.settle();
  } catch {
    // A failed settle leaves the hold. The next measurement cannot drop an active hold.
  }
}

async function admitPropsWrite(input: {
  now: string;
  invocationId: string;
  measurement: AdmissionMeasurement;
  reservations: StorageReservationStore;
  boundBytes: number;
  tables: readonly string[];
}): Promise<PropsStorageDecision> {
  const invocationId = input.invocationId.trim();
  if (invocationId === '') return halt('props storage admission has no invocation id', 'unmeasured', input.boundBytes);

  const admission = await admitPersistentWrite({
    writerId: PROPS_STORAGE_WRITER,
    kind: 'current_board',
    invocationId,
    now: input.now,
    measurement: input.measurement,
    physicalGrowthBoundBytes: input.boundBytes,
    tables: input.tables,
    reservations: input.reservations,
  });
  if (!admission.allowed || admission.alreadySettled) {
    return halt(admission.reason, admission.pressure, input.boundBytes);
  }

  try {
    const noted = await input.reservations.noteWriteIntent({
      invocationId,
      writerId: PROPS_STORAGE_WRITER,
      boundBytes: input.boundBytes,
      intentAt: input.now,
      inWrite: true,
    });
    if (!noted.ok) {
      await releaseAdmission(admission);
      return halt(noted.reason, admission.pressure, input.boundBytes);
    }
  } catch {
    await releaseAdmission(admission);
    return halt('reservation service failed; refusing the write', 'unmeasured', input.boundBytes);
  }

  return {
    mode: 'current_only',
    reason: admission.reason,
    pressure: admission.pressure,
    boundBytes: input.boundBytes,
    settle: async () => {
      await admission.settle();
    },
  };
}

export async function admitPropsCurrentOnly(input: {
  now: string;
  invocationId: string;
  measurement: AdmissionMeasurement;
  reservations: StorageReservationStore;
}): Promise<PropsStorageDecision> {
  return admitPropsWrite({
    ...input,
    boundBytes: PROPS_CURRENT_ONLY_PHYSICAL_GROWTH_BOUND_BYTES,
    tables: PROPS_CURRENT_TABLES,
  });
}

/** S3 publication still updates game-run bookkeeping. It does not reserve the market-table bound. */
export async function admitPropsS3Control(input: {
  now: string;
  invocationId: string;
  measurement: AdmissionMeasurement;
  reservations: StorageReservationStore;
}): Promise<PropsStorageDecision> {
  return admitPropsWrite({
    ...input,
    boundBytes: PROPS_PULL_CONTROL_PHYSICAL_GROWTH_BOUND_BYTES,
    tables: PROPS_S3_CONTROL_TABLES,
  });
}

type Queryable = {
  query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

type Connectable = Queryable & {
  connect: () => Promise<Queryable & { release: () => void }>;
};

export async function measurePropsCluster(pool: Connectable): Promise<AdmissionMeasurement> {
  const refused: AdmissionMeasurement = {
    clusterBytes: null,
    measuredAt: null,
    source: '',
    valid: false,
    complete: false,
  };
  const client = await pool.connect();
  try {
    await client.query('begin read only');
    await client.query("set local statement_timeout = '15s'");
    const result = await client.query(CLUSTER_DATABASE_TOTAL_SQL);
    await client.query('rollback');
    const row = result.rows[0];
    const bytes = typeof row?.cluster_bytes === 'bigint' ? Number(row.cluster_bytes) : Number(row?.cluster_bytes);
    const observed = row?.observed_at;
    const measuredAt = observed instanceof Date
      ? observed.toISOString()
      : new Date(String(observed ?? '')).toISOString();
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isFinite(Date.parse(measuredAt))) return refused;
    return {
      clusterBytes: bytes,
      measuredAt,
      databaseObservedAt: measuredAt,
      source: 'player-props-worker:pg_database',
      valid: true,
      complete: true,
    };
  } catch {
    await client.query('rollback').catch(() => undefined);
    return refused;
  } finally {
    client.release();
  }
}

export async function admitPropsInvocation(input: {
  env: NodeJS.ProcessEnv;
  now: string;
  invocationId: string;
  measureCluster: () => Promise<AdmissionMeasurement>;
  reservations?: StorageReservationStore;
}): Promise<PropsStorageDecision> {
  let reservations = input.reservations;
  if (!reservations) {
    const table = (input.env.STORAGE_RESERVATION_TABLE ?? '').trim();
    if (table !== STORAGE_RESERVATION_TABLE_NAME || input.invocationId.trim() === '') {
      return halt('storage reservation table is not configured');
    }
    try {
      reservations = createDynamoStorageReservationStore(new DynamoDBClient({}), table);
    } catch {
      return halt('storage reservation store is unavailable');
    }
  }

  let measured: AdmissionMeasurement;
  try {
    measured = await input.measureCluster();
  } catch {
    return halt('cluster measurement failed; refusing the write');
  }
  const admit = propsPublicationMode(input.env) === 's3_current_board' ? admitPropsS3Control : admitPropsCurrentOnly;
  return admit({
    now: admissionClock(input.now, measured.measuredAt),
    invocationId: input.invocationId,
    measurement: measured,
    reservations,
  });
}
