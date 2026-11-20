/**
 * Production scoreboard admission wiring.
 * Measures the full cluster with the existing read-only collector, then holds
 * capacity in the existing DynamoDB reservation table. Does not construct a
 * client or a pool at import time, and does not open a second reservation ledger.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

import { createLambdaPgPool } from '@/lib/runtime/lambda-pg-pool';
import {
  collectClusterMeasurement,
  type ClusterMeasurementLeasor,
} from '@/lib/ops/cluster-measurement';
import { createClusterMeasurementPgLeasor } from '@/lib/ops/cluster-measurement-pg';
import {
  type AdmissionMeasurement,
  type StorageReservationStore,
} from '@/lib/ops/storage-admission';
import {
  createDynamoStorageReservationStore,
  STORAGE_RESERVATION_TABLE_NAME,
} from '@/lib/ops/storage-reservation-dynamo';

import type { ScoreboardLambdaDeps } from './lambda';

export const SCOREBOARD_MEASUREMENT_SOURCE = 'scoreboard-collector:pg_database';

function unusableMeasurement(): AdmissionMeasurement {
  return {
    clusterBytes: null,
    measuredAt: null,
    source: SCOREBOARD_MEASUREMENT_SOURCE,
    valid: false,
    complete: false,
  };
}

/** One read-only full-cluster measurement. `measuredAt` is the time this call collected it. */
export async function measureScoreboardCluster(
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
      source: SCOREBOARD_MEASUREMENT_SOURCE,
      valid: true,
      complete: true,
    };
  } catch {
    return unusableMeasurement();
  }
}

/**
 * Dependencies for one production invocation.
 * A missing table, a missing invocation id, or the rate-limit table refuses
 * before a client is asked to reserve. The database pool is created only when
 * a measurement runs.
 */
export function wireProductionScoreboard(
  env: Record<string, string | undefined>,
  context?: { awsRequestId?: string }
): ScoreboardLambdaDeps {
  const table = (env.STORAGE_RESERVATION_TABLE ?? '').trim();
  const invocationId = context?.awsRequestId?.trim() ?? '';
  if (table !== STORAGE_RESERVATION_TABLE_NAME) {
    return { env, reservationRefusal: 'storage reservation table is not configured' };
  }
  if (invocationId === '') {
    return { env, reservationRefusal: 'invocation id is missing' };
  }
  if (!(env.SUPABASE_DB_URL ?? '').trim()) {
    return { env, reservationRefusal: 'missing SUPABASE_DB_URL' };
  }
  let reservations: StorageReservationStore;
  try {
    reservations = createDynamoStorageReservationStore(new DynamoDBClient({}), table);
  } catch {
    return { env, reservationRefusal: 'storage reservation table is not configured' };
  }
  return {
    env,
    invocationId,
    reservations,
    measureCluster: async () => {
      const pool = createLambdaPgPool(env);
      try {
        return await measureScoreboardCluster(
          createClusterMeasurementPgLeasor(pool),
          new Date().toISOString()
        );
      } finally {
        await pool.end();
      }
    },
  };
}
