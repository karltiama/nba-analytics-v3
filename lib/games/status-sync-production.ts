/**
 * Production game-status admission wiring.
 * Measures the full cluster in one read-only transaction, then holds capacity
 * in the existing DynamoDB reservation table. Does not open a pool at import.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

import { createLambdaPgPool } from '@/lib/runtime/lambda-pg-pool';
import { collectClusterMeasurement, type ClusterMeasurementLeasor } from '@/lib/ops/cluster-measurement';
import { createClusterMeasurementPgLeasor } from '@/lib/ops/cluster-measurement-pg';
import type { AdmissionMeasurement, StorageReservationStore } from '@/lib/ops/storage-admission';
import {
  createDynamoStorageReservationStore,
  STORAGE_RESERVATION_TABLE_NAME,
} from '@/lib/ops/storage-reservation-dynamo';

import type { LambdaGameStatusSyncDeps } from './status-sync-lambda';

export const GAME_STATUS_MEASUREMENT_SOURCE = 'game-status-sync:pg_database';

function unusableMeasurement(): AdmissionMeasurement {
  return {
    clusterBytes: null,
    measuredAt: null,
    source: GAME_STATUS_MEASUREMENT_SOURCE,
    valid: false,
    complete: false,
  };
}

export async function measureGameStatusCluster(
  leasor: ClusterMeasurementLeasor,
  now: string
): Promise<AdmissionMeasurement> {
  try {
    const lease = await leasor.acquire();
    const collected = await collectClusterMeasurement(lease);
    if (!collected.valid || collected.clusterBytes == null || !collected.databaseObservedAt) {
      return unusableMeasurement();
    }
    return {
      clusterBytes: collected.clusterBytes,
      measuredAt: now,
      databaseObservedAt: collected.databaseObservedAt,
      source: GAME_STATUS_MEASUREMENT_SOURCE,
      valid: true,
      complete: true,
    };
  } catch {
    return unusableMeasurement();
  }
}

/** Missing table, invocation id, or database URL refuses before a reservation call. */
export function wireProductionGameStatus(
  env: Record<string, string | undefined>,
  context?: { awsRequestId?: string }
): Pick<LambdaGameStatusSyncDeps, 'reservationRefusal' | 'measureCluster' | 'invocationId' | 'reservations'> {
  const table = (env.STORAGE_RESERVATION_TABLE ?? '').trim();
  const invocationId = context?.awsRequestId?.trim() ?? '';
  if (table !== STORAGE_RESERVATION_TABLE_NAME) {
    return { reservationRefusal: 'storage reservation table is not configured' };
  }
  if (invocationId === '') {
    return { reservationRefusal: 'invocation id is missing' };
  }
  if (!(env.SUPABASE_DB_URL ?? '').trim()) {
    return { reservationRefusal: 'missing SUPABASE_DB_URL' };
  }
  let reservations: StorageReservationStore;
  try {
    reservations = createDynamoStorageReservationStore(new DynamoDBClient({}), table);
  } catch {
    return { reservationRefusal: 'storage reservation table is not configured' };
  }
  return {
    invocationId,
    reservations,
    measureCluster: async () => {
      const pool = createLambdaPgPool(env);
      try {
        return await measureGameStatusCluster(createClusterMeasurementPgLeasor(pool), new Date().toISOString());
      } finally {
        await pool.end();
      }
    },
  };
}
