/**
 * Compact measurement item for `nba-storage-cluster-measurement`.
 * String `pk` and `sk`. The item key is pk `storage-cluster-measurement`,
 * sk `current`. This is not the BallDontLie rate-limit table.
 *
 * `expires_at` is omitted. The table has no TTL. Readers enforce the
 * 60-minute age limit. The client is required. This module does not construct
 * DynamoDBClient, read credentials, or send a request at import time.
 * No production publisher calls the writer.
 */

import { GetItemCommand, PutItemCommand, type AttributeValue } from '@aws-sdk/client-dynamodb';

import {
  CLUSTER_MEASUREMENT_SCHEMA_VERSION,
  type ClusterMeasurementRecord,
  type ClusterMeasurementStore,
} from '@/lib/ops/cluster-measurement';
import type { ClusterMeasurementReader } from '@/lib/ops/cluster-measurement-access';

export const CLUSTER_MEASUREMENT_ITEM_PK = 'storage-cluster-measurement';
export const CLUSTER_MEASUREMENT_ITEM_SK = 'current';
export const CLUSTER_MEASUREMENT_TABLE_NAME = 'nba-storage-cluster-measurement';
export const BDL_RATE_LIMIT_TABLE_NAME = 'nba-bdl-rate-limit';

export type ClusterMeasurementDynamoClient = {
  send(command: GetItemCommand | PutItemCommand): Promise<{ Item?: Record<string, AttributeValue> } | undefined>;
};

type DynamoItem = Record<string, AttributeValue>;

function requireTableName(tableName: string): string {
  if (typeof tableName !== 'string' || tableName.trim() === '') {
    throw new Error('cluster measurement table name is required');
  }
  if (tableName.trim() === BDL_RATE_LIMIT_TABLE_NAME) {
    throw new Error('cluster measurement must use the dedicated table');
  }
  return tableName;
}

function key(tableName: string) {
  return {
    TableName: tableName,
    Key: {
      pk: { S: CLUSTER_MEASUREMENT_ITEM_PK },
      sk: { S: CLUSTER_MEASUREMENT_ITEM_SK },
    },
  };
}

function integerAttribute(value: unknown): number | null {
  if (value == null || typeof value !== 'object' || !('N' in value)) return null;
  const raw = (value as { N?: unknown }).N;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return null;
  return parsed;
}

function recordFromItem(item: DynamoItem | undefined): ClusterMeasurementRecord | null {
  if (item == null) return null;
  const schemaVersion = integerAttribute(item.schema_version);
  const clusterBytes = integerAttribute(item.cluster_bytes);
  const measuredAt = item.measured_at?.S;
  const reason = item.reason?.S;
  return {
    schemaVersion: schemaVersion ?? 0,
    valid: item.valid?.BOOL === true && schemaVersion === CLUSTER_MEASUREMENT_SCHEMA_VERSION,
    clusterBytes,
    measuredAt: typeof measuredAt === 'string' ? measuredAt : null,
    reason: typeof reason === 'string' ? reason : null,
  };
}

function itemFromRecord(record: ClusterMeasurementRecord): DynamoItem {
  const item: DynamoItem = {
    pk: { S: CLUSTER_MEASUREMENT_ITEM_PK },
    sk: { S: CLUSTER_MEASUREMENT_ITEM_SK },
    schema_version: { N: String(record.schemaVersion) },
    valid: { BOOL: record.valid === true },
  };
  if (typeof record.clusterBytes === 'number' && Number.isSafeInteger(record.clusterBytes) && record.clusterBytes >= 0) {
    item.cluster_bytes = { N: String(record.clusterBytes) };
  }
  if (typeof record.measuredAt === 'string') item.measured_at = { S: record.measuredAt };
  if (typeof record.reason === 'string') item.reason = { S: record.reason };
  return item;
}

async function readItem(client: ClusterMeasurementDynamoClient, tableName: string): Promise<ClusterMeasurementRecord | null> {
  const response = await client.send(
    new GetItemCommand({
      ...key(tableName),
      ConsistentRead: true,
    })
  );
  return recordFromItem(response?.Item);
}

export function createClusterMeasurementDynamoReader(
  client: ClusterMeasurementDynamoClient,
  tableName: string
): ClusterMeasurementReader {
  const table = requireTableName(tableName);
  return {
    get: () => readItem(client, table),
  };
}

/**
 * Writer for a future publisher only. Handlers receive the reader.
 * PutItem replaces the item. A failed send rejects and does not return a record.
 */
export function createClusterMeasurementDynamoWriter(
  client: ClusterMeasurementDynamoClient,
  tableName: string
): ClusterMeasurementStore {
  const table = requireTableName(tableName);
  return {
    get: () => readItem(client, table),
    async put(record: ClusterMeasurementRecord) {
      await client.send(
        new PutItemCommand({
          TableName: table,
          Item: itemFromRecord(record),
        })
      );
    },
  };
}
