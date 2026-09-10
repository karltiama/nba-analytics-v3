/**
 * DynamoDB adapter for the live BDL token bucket.
 * Conditional version writes — lost races retry in acquireLiveBdlPermit.
 */

import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  BDL_LIVE_RATE_LIMIT_DEFAULTS,
  type BucketState,
  type LiveRateLimitConfig,
  type LiveRateLimitStore,
} from './bdl-live-rate-limit';

export type DynamoLiveRateLimitClient = {
  send: DynamoDBClient['send'];
};

function n(value: string | undefined, fallback: number): number {
  const parsed = value != null ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function createDynamoLiveRateLimitStore(
  config: LiveRateLimitConfig,
  client: DynamoLiveRateLimitClient = new DynamoDBClient({})
): LiveRateLimitStore {
  const table = config.tableName;
  if (!table) {
    throw new Error('Dynamo live rate-limit store requires tableName');
  }

  return {
    async loadBucket() {
      const res = await client.send(
        new GetItemCommand({
          TableName: table,
          Key: {
            pk: { S: BDL_LIVE_RATE_LIMIT_DEFAULTS.bucketPk },
            sk: { S: BDL_LIVE_RATE_LIMIT_DEFAULTS.bucketSk },
          },
          ConsistentRead: true,
        })
      );
      const item = res.Item;
      if (!item) return null;
      return {
        tokens: n(item.tokens?.N, 0),
        lastRefillMs: n(item.last_refill_ms?.N, 0),
        version: n(item.version?.N, 0),
      };
    },

    async saveBucket(next: BucketState, expectedVersion: number | null) {
      const expiresAt = Math.floor(Date.now() / 1000) + config.slotTtlSeconds;
      try {
        if (expectedVersion == null) {
          await client.send(
            new PutItemCommand({
              TableName: table,
              Item: {
                pk: { S: BDL_LIVE_RATE_LIMIT_DEFAULTS.bucketPk },
                sk: { S: BDL_LIVE_RATE_LIMIT_DEFAULTS.bucketSk },
                tokens: { N: String(next.tokens) },
                last_refill_ms: { N: String(next.lastRefillMs) },
                version: { N: String(next.version) },
                expires_at: { N: String(expiresAt) },
              },
              ConditionExpression: 'attribute_not_exists(pk)',
            })
          );
          return 'ok';
        }
        await client.send(
          new UpdateItemCommand({
            TableName: table,
            Key: {
              pk: { S: BDL_LIVE_RATE_LIMIT_DEFAULTS.bucketPk },
              sk: { S: BDL_LIVE_RATE_LIMIT_DEFAULTS.bucketSk },
            },
            UpdateExpression: 'SET tokens = :t, last_refill_ms = :r, version = :v, expires_at = :e',
            ConditionExpression: 'version = :expected',
            ExpressionAttributeValues: {
              ':t': { N: String(next.tokens) },
              ':r': { N: String(next.lastRefillMs) },
              ':v': { N: String(next.version) },
              ':e': { N: String(expiresAt) },
              ':expected': { N: String(expectedVersion) },
            },
          })
        );
        return 'ok';
      } catch (err) {
        const name = (err as { name?: string }).name ?? '';
        if (name === 'ConditionalCheckFailedException') return 'conflict';
        return 'unavailable';
      }
    },

    async getCooldownUntilMs() {
      const res = await client.send(
        new GetItemCommand({
          TableName: table,
          Key: {
            pk: { S: BDL_LIVE_RATE_LIMIT_DEFAULTS.bucketPk },
            sk: { S: BDL_LIVE_RATE_LIMIT_DEFAULTS.cooldownSk },
          },
          ConsistentRead: true,
        })
      );
      if (!res.Item?.until_ms?.N) return null;
      return n(res.Item.until_ms.N, 0);
    },

    async setCooldownUntilMs(untilMs: number, ttlSeconds: number) {
      const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
      await client.send(
        new PutItemCommand({
          TableName: table,
          Item: {
            pk: { S: BDL_LIVE_RATE_LIMIT_DEFAULTS.bucketPk },
            sk: { S: BDL_LIVE_RATE_LIMIT_DEFAULTS.cooldownSk },
            until_ms: { N: String(untilMs) },
            expires_at: { N: String(expiresAt) },
          },
        })
      );
    },
  };
}
