/**
 * Odds storage gate.
 * Policy comes from decideLabeledStorageWrite.
 * A reservation is one conditional DynamoDB item in nba-storage-admission.
 * This module does not create that table and does not publish a cluster measurement.
 * Missing, stale, or unconfigured inputs refuse the provider call and every odds write.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

import type { ClusterMeasurementReader } from '../../lib/ops/cluster-measurement-access';
import {
  CLUSTER_MEASUREMENT_TABLE_NAME,
  createClusterMeasurementDynamoReader,
} from '../../lib/ops/cluster-measurement-dynamo';
import type { ClusterMeasurementRecord } from '../../lib/ops/cluster-measurement';
import {
  decideLabeledStorageWrite,
  type StorageMeasurement,
  type StorageOperationKind,
  type StoragePressure,
} from '../../lib/ops/storage-budget';
import {
  admitPersistentWrite,
  type AdmissionMeasurement,
  type StorageAdmissionDecision,
  type StorageReservationStore,
} from '../../lib/ops/storage-admission';
import {
  createDynamoStorageReservationStore,
  STORAGE_RESERVATION_TABLE_NAME,
} from '../../lib/ops/storage-reservation-dynamo';
import { ODDS_PHYSICAL_GROWTH_BOUND_BYTES } from '../../lib/ops/storage-growth-bounds';

export const ODDS_STORAGE_WRITER = 'odds-pre-game-snapshot';

export const ODDS_NORMAL_TABLES = [
  'raw.odds_pull_runs',
  'raw.odds_snapshots',
  'analytics.game_odds_history',
  'analytics.game_odds_current',
  'analytics.game_line_movement_summary',
] as const;

export const ODDS_CURRENT_TABLES = [
  'analytics.game_odds_current',
  'analytics.game_line_movement_summary',
] as const;

export type OddsStorageMode = 'normal' | 'current_only' | 'halt';

export type OddsStorageDecision = {
  mode: OddsStorageMode;
  reason: string;
  pressure: StoragePressure;
  settle: () => Promise<void>;
};

const noopSettle = async (): Promise<void> => undefined;

function halt(reason: string, pressure: StoragePressure = 'unmeasured'): OddsStorageDecision {
  return { mode: 'halt', reason, pressure, settle: noopSettle };
}

export function planOddsStorage(
  measurement: StorageMeasurement,
  now: string
): { mode: OddsStorageMode; reason: string; pressure: StoragePressure } {
  const historical = decideLabeledStorageWrite({ kind: 'historical_raw_odds' }, measurement, now);
  if (historical.allowed) {
    return { mode: 'normal', reason: historical.reason, pressure: historical.pressure };
  }
  const current = decideLabeledStorageWrite({ kind: 'current_board' }, measurement, now);
  if (current.allowed) {
    return { mode: 'current_only', reason: current.reason, pressure: current.pressure };
  }
  return { mode: 'halt', reason: current.reason, pressure: current.pressure };
}

function measurementForPolicy(measurement: AdmissionMeasurement): StorageMeasurement {
  return {
    valid: measurement.valid,
    clusterBytes: measurement.clusterBytes,
    measuredAt: measurement.measuredAt,
  };
}

async function releaseAdmission(admission: StorageAdmissionDecision): Promise<void> {
  try {
    await admission.settle();
  } catch {
    // A failed settle leaves the hold. The next fresh measurement cannot drop an active hold.
  }
}

export async function admitOddsWrites(input: {
  now: string;
  invocationId: string;
  measurement: AdmissionMeasurement;
  reservations: StorageReservationStore;
}): Promise<OddsStorageDecision> {
  const invocationId = input.invocationId.trim();
  if (invocationId === '') return halt('odds storage admission has no invocation id');

  const planned = planOddsStorage(measurementForPolicy(input.measurement), input.now);
  if (planned.mode === 'halt') return halt(planned.reason, planned.pressure);

  const kind: StorageOperationKind = planned.mode === 'normal' ? 'historical_raw_odds' : 'current_board';
  const tables = planned.mode === 'normal' ? ODDS_NORMAL_TABLES : ODDS_CURRENT_TABLES;
  const admission = await admitPersistentWrite({
    writerId: ODDS_STORAGE_WRITER,
    kind,
    invocationId,
    now: input.now,
    measurement: input.measurement,
    physicalGrowthBoundBytes: ODDS_PHYSICAL_GROWTH_BOUND_BYTES,
    tables,
    reservations: input.reservations,
  });
  if (!admission.allowed || admission.alreadySettled) {
    return halt(admission.reason, admission.pressure);
  }

  try {
    const noted = await input.reservations.noteWriteIntent({
      invocationId,
      writerId: ODDS_STORAGE_WRITER,
      boundBytes: ODDS_PHYSICAL_GROWTH_BOUND_BYTES,
      intentAt: input.now,
      inWrite: true,
    });
    if (!noted.ok) {
      await releaseAdmission(admission);
      return halt(noted.reason, admission.pressure);
    }
  } catch {
    await releaseAdmission(admission);
    return halt('reservation service failed; refusing the write', 'unmeasured');
  }

  return {
    mode: planned.mode,
    reason: admission.reason,
    pressure: admission.pressure,
    settle: async () => {
      await admission.settle();
    },
  };
}

/** A measurement taken during this call is newer than the clock captured before it. That is fresh, not future-dated. */
function admissionClock(requested: string, measuredAt: string | null): string {
  const requestedMs = Date.parse(requested);
  const measuredMs = measuredAt == null ? Number.NaN : Date.parse(measuredAt);
  if (Number.isFinite(requestedMs) && Number.isFinite(measuredMs) && measuredMs > requestedMs) {
    return new Date(measuredMs).toISOString();
  }
  return requested;
}

function measurementFromRecord(record: ClusterMeasurementRecord | null): AdmissionMeasurement {
  if (record == null || record.valid !== true || record.clusterBytes == null || record.measuredAt == null) {
    return {
      clusterBytes: record?.clusterBytes ?? null,
      measuredAt: record?.measuredAt ?? null,
      source: '',
      valid: false,
      complete: false,
    };
  }
  return {
    clusterBytes: record.clusterBytes,
    measuredAt: record.measuredAt,
    source: CLUSTER_MEASUREMENT_TABLE_NAME,
    valid: true,
    complete: true,
  };
}

export async function admitOddsInvocation(input: {
  env: NodeJS.ProcessEnv;
  now: string;
  invocationId: string;
  reader?: ClusterMeasurementReader;
  reservations?: StorageReservationStore;
  /** Direct cluster read. Used when the reservation store is configured. */
  measureCluster?: () => Promise<AdmissionMeasurement>;
}): Promise<OddsStorageDecision> {
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

  if (input.measureCluster) {
    let measured: AdmissionMeasurement;
    try {
      measured = await input.measureCluster();
    } catch {
      return halt('cluster measurement failed; refusing the write');
    }
    return admitOddsWrites({
      now: admissionClock(input.now, measured.measuredAt),
      invocationId: input.invocationId,
      measurement: measured,
      reservations,
    });
  }

  const configured = input.env.STORAGE_MEASUREMENT_TABLE_NAME;
  const measurementTable = typeof configured === 'string' && configured.trim() !== ''
    ? configured.trim()
    : CLUSTER_MEASUREMENT_TABLE_NAME;
  let reader = input.reader;
  if (!reader) {
    try {
      reader = createClusterMeasurementDynamoReader(new DynamoDBClient({}), measurementTable);
    } catch {
      return halt('cluster measurement store is unavailable');
    }
  }

  let record: ClusterMeasurementRecord | null;
  try {
    record = await reader.get();
  } catch {
    return halt('cluster measurement store read failed');
  }

  return admitOddsWrites({
    now: input.now,
    invocationId: input.invocationId,
    measurement: measurementFromRecord(record),
    reservations,
  });
}
