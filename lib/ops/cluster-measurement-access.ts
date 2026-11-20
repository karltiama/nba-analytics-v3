/**
 * Fail-closed admission boundary for a future Lambda handler.
 * The handler passes a code-owned operation kind. This function does not read
 * a request, a queue body, or pg_database_size(current_database()).
 * It is not imported by a production handler.
 */

import { readClusterMeasurement, type ClusterMeasurementRecord } from '@/lib/ops/cluster-measurement';
import {
  decideLabeledStorageWrite,
  type StorageOperationLabel,
  type StoragePayloadEstimate,
  type StorageWriteDecision,
} from '@/lib/ops/storage-budget';

export type ClusterMeasurementReader = {
  get(): Promise<ClusterMeasurementRecord | null>;
};

export const CLUSTER_MEASUREMENT_STORE_READ_FAILURE = 'cluster measurement store read failed';

/**
 * A thrown store read denies every kind, including s3_archive.
 * A successful read of a missing or unusable record still allows only the
 * existing S3 exemption. There is no previous-measurement fallback.
 */
export async function decideStoredStorageWrite(input: {
  reader: ClusterMeasurementReader;
  kind: unknown;
  requestedCategory?: unknown;
  approved?: unknown;
  gameIds?: unknown;
  now: string;
  payload?: StoragePayloadEstimate;
}): Promise<StorageWriteDecision> {
  let record: ClusterMeasurementRecord | null;
  try {
    record = await input.reader.get();
  } catch {
    return {
      category: null,
      allowed: false,
      pressure: 'unmeasured',
      reason: CLUSTER_MEASUREMENT_STORE_READ_FAILURE,
    };
  }

  const measurement = readClusterMeasurement(record, input.now);
  const operation = {
    kind: input.kind,
    requestedCategory: input.requestedCategory,
    approved: input.approved,
    gameIds: input.gameIds,
  };
  return decideLabeledStorageWrite(operation as StorageOperationLabel, measurement, input.now, input.payload);
}
