import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { describe, expect, it } from 'vitest';
import {
  acquireLiveBdlPermit,
  readLiveRateLimitConfig,
  type BucketState,
} from '@/lib/balldontlie/live-rate-limit';
import { createDynamoLiveRateLimitStore } from '@/lib/balldontlie/live-rate-limit';

type AttrMap = Record<string, { S?: string; N?: string }>;

function liveConfig() {
  return readLiveRateLimitConfig({
    DATA_MODE: 'live_api',
    OFFSEASON_MODE: '0',
    CRON_DRY_RUN: '0',
    BDL_RATE_LIMIT_BACKEND: 'dynamodb',
    BDL_RATE_LIMIT_TABLE: 'nba-bdl-rate-limit',
    BDL_RATE_LIMIT_ALLOW_FAST: '1',
    BDL_RATE_LIMIT_INTERVAL_MS: '10',
    BDL_RATE_LIMIT_BURST: '1',
    BDL_RATE_LIMIT_ACQUIRE_TIMEOUT_MS: '2000',
  });
}

function makeFakeDynamo() {
  const items = new Map<string, AttrMap>();
  let forceConflict = 0;
  let unavailable = false;
  const keyOf = (pk: string, sk: string) => `${pk}#${sk}`;

  return {
    forceConflictNext(n: number) {
      forceConflict = n;
    },
    setUnavailable(v: boolean) {
      unavailable = v;
    },
    snapshot(): Map<string, AttrMap> {
      return items;
    },
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      if (unavailable) {
        const err = new Error('UnrecognizedClientException');
        err.name = 'UnrecognizedClientException';
        throw err;
      }
      const name = command.constructor.name;
      const input = command.input as {
        Key?: { pk?: { S?: string }; sk?: { S?: string } };
        Item?: AttrMap;
        ConditionExpression?: string;
        UpdateExpression?: string;
        ExpressionAttributeValues?: AttrMap;
      };
      const pk = input.Key?.pk?.S ?? input.Item?.pk?.S ?? 'bdl';
      const sk = input.Key?.sk?.S ?? input.Item?.sk?.S ?? '';
      const k = keyOf(pk, sk);

      if (name === 'GetItemCommand') {
        const item = items.get(k);
        return { Item: item };
      }
      if (name === 'PutItemCommand') {
        if (input.ConditionExpression === 'attribute_not_exists(pk)' && items.has(k)) {
          throw new ConditionalCheckFailedException({ message: 'exists', $metadata: {} });
        }
        items.set(k, { ...(input.Item as AttrMap) });
        return {};
      }
      if (name === 'UpdateItemCommand') {
        if (forceConflict > 0) {
          forceConflict -= 1;
          throw new ConditionalCheckFailedException({ message: 'version', $metadata: {} });
        }
        const current = items.get(k);
        const expected = input.ExpressionAttributeValues?.[':expected']?.N;
        if (!current || current.version?.N !== expected) {
          throw new ConditionalCheckFailedException({ message: 'version', $metadata: {} });
        }
        const next: AttrMap = {
          ...current,
          tokens: input.ExpressionAttributeValues?.[':t'] ?? current.tokens,
          last_refill_ms: input.ExpressionAttributeValues?.[':r'] ?? current.last_refill_ms,
          version: input.ExpressionAttributeValues?.[':v'] ?? current.version,
          expires_at: input.ExpressionAttributeValues?.[':e'] ?? current.expires_at,
        };
        items.set(k, next);
        return {};
      }
      throw new Error(`unexpected command ${name}`);
    },
  };
}

describe('DynamoDB conditional writes', () => {
  it('first writer creates the bucket; loser retries and still gets one permit total per token', async () => {
    const fake = makeFakeDynamo();
    const config = liveConfig();
    const storeA = createDynamoLiveRateLimitStore(config, fake as never);
    const storeB = createDynamoLiveRateLimitStore(config, fake as never);
    let now = 5_000;
    const results = await Promise.all([
      acquireLiveBdlPermit({
        store: storeA,
        config,
        nowMs: () => now,
        sleepFn: async (ms) => {
          now += ms;
        },
      }),
      acquireLiveBdlPermit({
        store: storeB,
        config,
        nowMs: () => now,
        sleepFn: async (ms) => {
          now += ms;
        },
      }),
    ]);
    expect(results.every((r) => r.granted)).toBe(true);
    const bucket = (await storeA.loadBucket()) as BucketState;
    expect(bucket.version).toBe(2);
    expect(bucket.tokens).toBeLessThan(1);
  });

  it('ConditionalCheckFailedException is treated as a retryable conflict, not a bypass', async () => {
    const fake = makeFakeDynamo();
    const config = liveConfig();
    const store = createDynamoLiveRateLimitStore(config, fake as never);
    await acquireLiveBdlPermit({
      store,
      config,
      nowMs: () => 1_000,
      sleepFn: async () => undefined,
    });
    fake.forceConflictNext(1);
    let now = 1_000;
    await expect(
      acquireLiveBdlPermit({
        store,
        config,
        nowMs: () => now,
        sleepFn: async (ms) => {
          now += Math.max(ms, 10);
        },
      })
    ).resolves.toMatchObject({ granted: true });
  });

  it('non-conditional Dynamo errors fail closed as unavailable', async () => {
    const fake = makeFakeDynamo();
    fake.setUnavailable(true);
    const config = liveConfig();
    const store = createDynamoLiveRateLimitStore(config, fake as never);
    await expect(
      acquireLiveBdlPermit({
        store,
        config,
        nowMs: () => 1,
        sleepFn: async () => undefined,
      })
    ).rejects.toMatchObject({ code: 'coordination' });
  });
});
