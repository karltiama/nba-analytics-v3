/**
 * One DynamoDB item, updated with a version condition.
 * A failed condition retries against the stored ledger. Active holds are not expired.
 * This module does not construct a client or send a request at import time.
 */

import { GetItemCommand, UpdateItemCommand, type AttributeValue } from '@aws-sdk/client-dynamodb';

import { BDL_RATE_LIMIT_TABLE_NAME, CLUSTER_MEASUREMENT_TABLE_NAME } from '@/lib/ops/cluster-measurement-dynamo';
import {
  assessStrandedRecovery,
  emptyReservationLedger,
  transitionReservation,
  type ReservationLedger,
  type StorageReservationStore,
  type StrandedReleaseInput,
} from '@/lib/ops/storage-admission';

export const STORAGE_RESERVATION_TABLE_NAME = 'nba-storage-admission';
export const STORAGE_RESERVATION_PK = 'storage-admission';
export const STORAGE_RESERVATION_SK = 'reservations';
export const STORAGE_RESERVATION_CONDITION = 'attribute_not_exists(ledger_version) OR ledger_version = :seen';

export type StorageReservationDynamoClient = {
  send(command: GetItemCommand | UpdateItemCommand): Promise<{ Item?: Record<string, AttributeValue> } | undefined>;
};

type StoredLedger = { version: number; ledger: ReservationLedger };

function requireTable(tableName: string): string {
  const table = tableName.trim();
  if (table === '' || table === BDL_RATE_LIMIT_TABLE_NAME || table === CLUSTER_MEASUREMENT_TABLE_NAME) {
    throw new Error('storage reservations require the dedicated admission table');
  }
  return table;
}

function key(tableName: string) {
  return {
    TableName: tableName,
    Key: {
      pk: { S: STORAGE_RESERVATION_PK },
      sk: { S: STORAGE_RESERVATION_SK },
    },
  };
}

function isConditionFailure(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

function ledgerFromItem(item: Record<string, AttributeValue> | undefined): StoredLedger {
  if (item == null) return { version: 0, ledger: emptyReservationLedger() };
  const versionRaw = item.ledger_version?.N;
  const version = typeof versionRaw === 'string' && /^\d+$/.test(versionRaw) ? Number(versionRaw) : 0;
  const text = item.ledger_json?.S;
  if (typeof text !== 'string') return { version, ledger: emptyReservationLedger() };
  try {
    const parsed = JSON.parse(text) as ReservationLedger;
    if (parsed == null || typeof parsed !== 'object' || typeof parsed.protectedBytes !== 'number') {
      return { version, ledger: emptyReservationLedger() };
    }
    return {
      version,
      ledger: {
        protectedBytes: parsed.protectedBytes,
        active: parsed.active ?? {},
        settled: parsed.settled ?? {},
      },
    };
  } catch {
    return { version, ledger: emptyReservationLedger() };
  }
}

export function createDynamoStorageReservationStore(
  client: StorageReservationDynamoClient,
  tableName: string
): StorageReservationStore {
  const table = requireTable(tableName);

  async function read(): Promise<StoredLedger> {
    const response = await client.send(new GetItemCommand({ ...key(table), ConsistentRead: true }));
    return ledgerFromItem(response?.Item);
  }

  async function compareAndSwap(seen: number, ledger: ReservationLedger): Promise<boolean> {
    try {
      await client.send(
        new UpdateItemCommand({
          ...key(table),
          ConditionExpression: STORAGE_RESERVATION_CONDITION,
          UpdateExpression: 'SET ledger_json = :ledger, ledger_version = :next',
          ExpressionAttributeValues: {
            ':seen': { N: String(seen) },
            ':next': { N: String(seen + 1) },
            ':ledger': { S: JSON.stringify(ledger) },
          },
        })
      );
      return true;
    } catch (error) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  }

  return {
    async reserve(input) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const current = await read();
        const reconciled = transitionReservation(current.ledger, {
          type: 'reconcile',
          measurementAt: input.measurementAt,
          databaseObservedAt: input.databaseObservedAt,
        });
        if (!reconciled.ok) return { ok: false, reason: reconciled.reason, protectedBytes: current.ledger.protectedBytes };
        const reserved = transitionReservation(reconciled.ledger, {
          type: 'reserve',
          invocationId: input.invocationId,
          writerId: input.writerId,
          operation: input.operation,
          boundBytes: input.boundBytes,
          roomBytes: input.roomBytes,
          intentAt: input.measurementAt,
        });
        if (!reserved.ok) return { ok: false, reason: reserved.reason, protectedBytes: reconciled.ledger.protectedBytes };
        if (!reconciled.changed && !reserved.changed) {
          return {
            ok: true,
            protectedBytes: reserved.ledger.protectedBytes,
            idempotent: true,
            settled: reserved.settled === true,
          };
        }
        const wrote = await compareAndSwap(current.version, reserved.ledger);
        if (wrote) {
          return {
            ok: true,
            protectedBytes: reserved.ledger.protectedBytes,
            idempotent: reserved.idempotent,
            settled: reserved.settled === true,
          };
        }
      }
      return { ok: false, reason: 'reservation service could not commit a conditional update', protectedBytes: 0 };
    },

    async settle(input) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const current = await read();
        const settled = transitionReservation(current.ledger, { type: 'settle', ...input });
        if (!settled.ok) throw new Error(settled.reason);
        if (!settled.changed) return;
        const wrote = await compareAndSwap(current.version, settled.ledger);
        if (wrote) return;
      }
      throw new Error('reservation service could not settle a conditional update');
    },

    async noteWriteIntent(input) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const current = await read();
        const noted = transitionReservation(current.ledger, { type: 'intent', ...input });
        if (!noted.ok) return { ok: false, reason: noted.reason };
        if (!noted.changed) return { ok: true, version: current.version };
        const wrote = await compareAndSwap(current.version, noted.ledger);
        if (wrote) return { ok: true, version: current.version + 1 };
      }
      return { ok: false, reason: 'reservation service could not commit a conditional update' };
    },

    async releaseStranded(input: StrandedReleaseInput) {
      const assessed = assessStrandedRecovery(input);
      if (!assessed.ok) return { ok: false, reason: assessed.reason, protectedBytes: 0 };
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const current = await read();
        if (current.version !== input.expectedVersion) {
          return {
            ok: false,
            reason: 'ledger version does not match this reservation',
            protectedBytes: current.ledger.protectedBytes,
          };
        }
        const released = transitionReservation(current.ledger, {
          type: 'release',
          invocationId: input.invocationId,
          writerId: input.writerId,
          boundBytes: input.boundBytes,
          inactiveAt: input.inactiveAt,
          measurementAt: input.measurement.measuredAt ?? '',
          confirmSessionEnded: input.confirmSessionEnded,
          databaseSnapshotAt: input.databaseSnapshotAt,
        });
        if (!released.ok) return { ok: false, reason: released.reason, protectedBytes: current.ledger.protectedBytes };
        if (!released.changed) {
          return { ok: true, version: current.version, protectedBytes: released.ledger.protectedBytes };
        }
        const wrote = await compareAndSwap(current.version, released.ledger);
        if (wrote) {
          return { ok: true, version: current.version + 1, protectedBytes: released.ledger.protectedBytes };
        }
      }
      return { ok: false, reason: 'reservation service could not commit a conditional update', protectedBytes: 0 };
    },
  };
}
