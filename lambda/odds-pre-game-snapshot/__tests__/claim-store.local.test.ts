import { CreateTableCommand, DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDynamoOddsClaim, ODDS_CLAIM_LEASE_MS, ODDS_CLAIM_PK } from '../overlap-claim';
import { SIX_HOUR_REFRESH_MS, oddsClaimSortKey } from '../refresh-slot';

const endpoint = process.env.DYNAMODB_LOCAL_ENDPOINT ?? '';
const localEndpoint = /^http:\/\/(127\.0.0.1|localhost):\d+$/.test(endpoint);
if (endpoint && !localEndpoint) {
  throw new Error('DYNAMODB_LOCAL_ENDPOINT must point at localhost');
}

const tableName = 'odds-claim-gate6d4d';
const client = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: endpoint || 'http://127.0.0.1:9',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

async function item(sk: string) {
  const stored = await client.send(new GetItemCommand({
    TableName: tableName,
    Key: { pk: { S: ODDS_CLAIM_PK }, sk: { S: sk } },
    ConsistentRead: true,
  }));
  return stored.Item ?? null;
}

describe.skipIf(!localEndpoint)('DynamoDB Local claim store', () => {
  const claim = createDynamoOddsClaim({ tableName, client });

  beforeAll(async () => {
    try {
      await client.send(new CreateTableCommand({
        TableName: tableName,
        AttributeDefinitions: [
          { AttributeName: 'pk', AttributeType: 'S' },
          { AttributeName: 'sk', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
        BillingMode: 'PAY_PER_REQUEST',
      }));
    } catch (err) {
      if ((err as { name?: string }).name !== 'ResourceInUseException') throw err;
    }
  });

  afterAll(() => {
    client.destroy();
  });

  it('creates the first claim when the item is absent', async () => {
    const nowMs = Date.parse('2026-10-20T14:22:59.555Z');
    const sk = oddsClaimSortKey({ day: '2026-10-20', date: '2026-10-20', windowId: 'two_hour', nowMs });
    const decision = await claim.claim({
      day: '2026-10-20',
      date: '2026-10-20',
      windowId: 'two_hour',
      nowMs,
      owner: 'first',
    });
    const stored = await item(sk);
    expect(decision).toEqual({ ok: true });
    expect(stored?.owner).toEqual({ S: 'first' });
    expect(stored?.lease_until_ms).toEqual({ N: String(nowMs + ODDS_CLAIM_LEASE_MS) });
    expect(stored?.completed_at).toBeUndefined();
  });

  it('skips a second claim while the lease is active', async () => {
    const nowMs = Date.parse('2026-10-20T14:22:59.555Z');
    const during = await claim.claim({
      day: '2026-10-20',
      date: '2026-10-20',
      windowId: 'two_hour',
      nowMs: nowMs + 1_000,
      owner: 'second',
    });
    const stored = await item(oddsClaimSortKey({
      day: '2026-10-20',
      date: '2026-10-20',
      windowId: 'two_hour',
      nowMs: Date.parse('2026-10-20T14:22:59.555Z'),
    }));
    expect(during).toEqual({ ok: false, reason: 'skipped' });
    expect(stored?.owner).toEqual({ S: 'first' });
  });

  it('keeps a completed window closed after the lease expires', async () => {
    const nowMs = 10_000;
    const request = { day: '2026-10-20', date: '2026-10-20', windowId: 't60', nowMs, owner: 'closer' };
    expect((await claim.claim(request)).ok).toBe(true);
    await claim.complete(request);
    const again = await claim.claim({ ...request, nowMs: nowMs + ODDS_CLAIM_LEASE_MS + 1, owner: 'later' });
    const stored = await item(oddsClaimSortKey({ day: '2026-10-20', date: '2026-10-20', windowId: 't60', nowMs }));
    expect(again).toEqual({ ok: false, reason: 'skipped' });
    expect(stored?.completed_at).toEqual({ N: String(nowMs) });
    expect(stored?.owner).toEqual({ S: 'closer' });
  });

  it('replaces an expired incomplete lease', async () => {
    const short = createDynamoOddsClaim({ tableName, client, leaseMs: 1_000 });
    const nowMs = 50_000;
    expect((await short.claim({ day: '2026-10-20', date: '2026-10-20', windowId: 't15', nowMs, owner: 'crashed' })).ok).toBe(true);
    const recovered = await short.claim({ day: '2026-10-20', date: '2026-10-20', windowId: 't15', nowMs: nowMs + 1_001, owner: 'recovered' });
    const stored = await item(oddsClaimSortKey({ day: '2026-10-20', date: '2026-10-20', windowId: 't15', nowMs }));
    expect(recovered).toEqual({ ok: true });
    expect(stored?.owner).toEqual({ S: 'recovered' });
    expect(stored?.completed_at).toBeUndefined();
  });

  it('acquires the next refresh slot after the completed slot', async () => {
    const nowMs = Date.parse('2026-10-21T13:00:00.000Z');
    const request = { day: '2026-10-21', date: '2026-10-21', windowId: 'six_hour', nowMs, owner: 'first' };
    expect((await claim.claim(request)).ok).toBe(true);
    await claim.complete(request);
    const same = await claim.claim({ ...request, nowMs: nowMs + 15 * 60 * 1000, owner: 'second' });
    const nextMs = nowMs + SIX_HOUR_REFRESH_MS;
    const next = await claim.claim({ ...request, nowMs: nextMs, owner: 'third' });
    const stored = await item(oddsClaimSortKey({ ...request, nowMs: nextMs }));
    expect(same).toEqual({ ok: false, reason: 'skipped' });
    expect(next).toEqual({ ok: true });
    expect(stored?.owner).toEqual({ S: 'third' });
    expect(stored?.completed_at).toBeUndefined();
  });

  it('lets only one of two concurrent claims own the window', async () => {
    const nowMs = 80_000;
    const results = await Promise.all([
      claim.claim({ day: '2026-10-20', date: '2026-10-20', windowId: 'six_hour', nowMs, owner: 'a' }),
      claim.claim({ day: '2026-10-20', date: '2026-10-20', windowId: 'six_hour', nowMs, owner: 'b' }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.reason === 'skipped')).toHaveLength(1);
    const stored = await item(oddsClaimSortKey({ day: '2026-10-20', date: '2026-10-20', windowId: 'six_hour', nowMs }));
    expect(['a', 'b']).toContain(stored?.owner?.S);
  });
});
