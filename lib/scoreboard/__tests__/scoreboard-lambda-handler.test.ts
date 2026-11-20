import { afterEach, describe, expect, it, vi } from 'vitest';

import { InMemoryAcqArchiveStore } from '@/lib/acquisition/archive';
import { createMemoryAcqLedgerWriter } from '@/lib/acquisition/ledger-pg';
import { MemoryStorageReservationStore } from '@/lib/ops/storage-admission';
import { handler, runLambdaScoreboard } from '@/lib/scoreboard/lambda';
import { createMemoryScoreboardStore } from '@/lib/scoreboard/store';

const { wiringCalls } = vi.hoisted(() => ({
  wiringCalls: [] as Array<[Record<string, string | undefined>, { awsRequestId?: string } | undefined]>,
}));

vi.mock('@/lib/scoreboard/production-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/scoreboard/production-storage')>();
  return {
    ...actual,
    wireProductionScoreboard(
      env: Record<string, string | undefined>,
      context?: { awsRequestId?: string }
    ) {
      wiringCalls.push([env, context]);
      return actual.wireProductionScoreboard(env, context);
    },
  };
});

const LIVE = {
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
  LIVE_INGESTION_ENABLED: '1',
  SCOREBOARD_COLLECT_PRESEASON: '1',
  SCOREBOARD_TARGET_SEASON: '2026',
  BALLDONTLIE_API_KEY: 'test-not-a-real-key',
  NBA_DATA_BUCKET: 'scoreboard-hotfix-unused',
  NBA_RAW_PREFIX: 'raw',
  BDL_RATE_LIMIT_BACKEND: 'memory',
  BDL_RATE_LIMIT_MAX_RETRIES: '0',
  SUPABASE_DB_URL: 'postgresql://scoreboard-hotfix:unused@127.0.0.1:1/none',
  DB_CONNECTION_TIMEOUT_MS: '300',
};

const snapshot = { ...process.env };

function useEnv(values: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, values);
}

afterEach(() => {
  wiringCalls.length = 0;
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, snapshot);
});

function callbackThatWouldWrite(writes: string[]) {
  const store = createMemoryScoreboardStore();
  const record = store.recordGamesRequest.bind(store);
  store.recordGamesRequest = async (...args) => {
    writes.push('record');
    return record(...args);
  };
  const upsert = store.upsertGames.bind(store);
  store.upsertGames = async (...args) => {
    writes.push('upsert');
    return upsert(...args);
  };
  return Object.assign(() => undefined, {
    env: { ...LIVE, STORAGE_RESERVATION_TABLE: 'nba-storage-admission' },
    invocationId: 'callback-id',
    store,
    archiveStore: new InMemoryAcqArchiveStore(),
    ledger: createMemoryAcqLedgerWriter(),
    reservations: new MemoryStorageReservationStore(),
    measureCluster: async () => ({
      clusterBytes: 399_110_321,
      measuredAt: new Date().toISOString(),
      source: 'callback',
      valid: true,
      complete: true,
    }),
  });
}

describe('scoreboard Lambda handler AWS invocation', () => {
  it('ignores a truthy callback and passes the AWS request id to production wiring', async () => {
    const writes: string[] = [];
    const callback = callbackThatWouldWrite(writes);
    useEnv(LIVE);
    const event = { source: 'aws.lambda' };

    const withCallback = await handler(event, { awsRequestId: 'aws-request-1' }, callback);
    const withoutCallback = await handler(event, { awsRequestId: 'aws-request-1' });

    expect(withCallback).toMatchObject({
      status: 'failed',
      reason: 'storage reservation table is not configured',
      bdlRequests: 0,
    });
    expect(withoutCallback.reason).toBe(withCallback.reason);
    expect(writes).toEqual([]);
    expect(wiringCalls).toHaveLength(2);
    expect(wiringCalls[0]?.[0]).toBe(process.env);
    expect(wiringCalls[0]?.[1]).toEqual({ awsRequestId: 'aws-request-1' });
    expect(wiringCalls[1]?.[1]).toEqual({ awsRequestId: 'aws-request-1' });
    expect(wiringCalls.every((call) => call.length === 2)).toBe(true);
  });

  it('fails closed before a PostgreSQL write when the request id or reservation table is missing', async () => {
    const writes: string[] = [];
    const callback = callbackThatWouldWrite(writes);
    useEnv({ ...LIVE, STORAGE_RESERVATION_TABLE: 'nba-storage-admission' });

    const missingId = await handler({ source: 'aws.lambda' }, {}, callback);
    expect(missingId).toMatchObject({ status: 'failed', reason: 'invocation id is missing', bdlRequests: 0 });

    useEnv(LIVE);
    const missingTable = await handler({ source: 'aws.lambda' }, { awsRequestId: 'aws-request-1' }, callback);
    expect(missingTable.reason).toBe('storage reservation table is not configured');
    expect(writes).toEqual([]);
  });

  it('keeps injected admission behavior on runLambdaScoreboard', async () => {
    const reservations = new MemoryStorageReservationStore();
    const result = await runLambdaScoreboard({
      env: LIVE,
      invocationId: 'injected-1',
      reservations,
      measureCluster: async () => ({
        clusterBytes: null,
        measuredAt: null,
        source: 'test',
        valid: false,
        complete: false,
      }),
    });
    expect(result.status).toBe('failed');
    expect(result.reason).not.toBe('storage admission is not configured');
    expect(reservations.snapshot().protectedBytes).toBe(0);
    expect(wiringCalls).toEqual([]);
  });
});
