import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import {
  CLUSTER_DATABASE_ROWS_SQL,
  CLUSTER_DATABASE_TOTAL_SQL,
  CLUSTER_MEASUREMENT_BEGIN_SQL,
  CLUSTER_MEASUREMENT_ROLLBACK_SQL,
  CLUSTER_MEASUREMENT_SCHEMA_VERSION,
  CLUSTER_MEASUREMENT_TIMEOUT_SQL,
  collectClusterMeasurement,
  publishClusterMeasurement,
  type ClusterMeasurementRecord,
} from '@/lib/ops/cluster-measurement';
import {
  CLUSTER_MEASUREMENT_STORE_READ_FAILURE,
  decideStoredStorageWrite,
} from '@/lib/ops/cluster-measurement-access';
import {
  CLUSTER_MEASUREMENT_ITEM_PK,
  CLUSTER_MEASUREMENT_ITEM_SK,
  CLUSTER_MEASUREMENT_TABLE_NAME,
  BDL_RATE_LIMIT_TABLE_NAME,
  createClusterMeasurementDynamoReader,
  createClusterMeasurementDynamoWriter,
  type ClusterMeasurementDynamoClient,
} from '@/lib/ops/cluster-measurement-dynamo';
import {
  createClusterMeasurementPgLeasor,
  type ClusterMeasurementPgClient,
  type ClusterMeasurementPgPool,
} from '@/lib/ops/cluster-measurement-pg';

const PHASE_B1_ROWS = [
  { datname: 'postgres', bytes: 463_572_115 },
  { datname: 'template1', bytes: 7_586_319 },
  { datname: 'template0', bytes: 7_504_399 },
];
const PHASE_B1_TOTAL = 478_662_833;
const NOW = '2026-11-18T20:00:00.000Z';
const FRESH = '2026-11-18T19:30:00.000Z';

const STATEMENTS = [
  CLUSTER_MEASUREMENT_BEGIN_SQL,
  CLUSTER_MEASUREMENT_TIMEOUT_SQL,
  CLUSTER_DATABASE_ROWS_SQL,
  CLUSTER_DATABASE_TOTAL_SQL,
  CLUSTER_MEASUREMENT_ROLLBACK_SQL,
];

function pgError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function fakePool(failOn?: (sql: string) => Error | null) {
  const client: ClusterMeasurementPgClient & {
    queries: string[];
    releases: Array<Error | undefined>;
  } = {
    queries: [],
    releases: [],
    async query(sql: string) {
      this.queries.push(sql);
      const failure = failOn?.(sql) ?? null;
      if (failure) throw failure;
      if (sql === CLUSTER_DATABASE_ROWS_SQL) return { rows: PHASE_B1_ROWS };
      if (sql === CLUSTER_DATABASE_TOTAL_SQL) return { rows: [{ cluster_bytes: PHASE_B1_TOTAL }] };
      return { rows: [] };
    },
    release(error?: Error) {
      this.releases.push(error);
    },
  };
  const pool = {
    connects: 0,
    queryCalls: 0,
    async connect() {
      this.connects += 1;
      return client;
    },
    async query() {
      this.queryCalls += 1;
      throw new Error('pool.query is not used for a measurement transaction');
    },
  };
  return { client, pool: pool as ClusterMeasurementPgPool & typeof pool };
}

function readerOf(record: ClusterMeasurementRecord | null, fail = false) {
  return {
    calls: 0,
    async get() {
      this.calls += 1;
      if (fail) throw new Error('postgresql://user:secret@db.example/postgres');
      return record;
    },
  };
}

function freshRecord(clusterBytes: number, measuredAt = FRESH): ClusterMeasurementRecord {
  return {
    schemaVersion: CLUSTER_MEASUREMENT_SCHEMA_VERSION,
    valid: true,
    clusterBytes,
    measuredAt,
    reason: null,
  };
}

describe('postgres leased client', () => {
  it('runs every transaction statement on the one connected client', async () => {
    const { client, pool } = fakePool();
    const leasor = createClusterMeasurementPgLeasor(pool);
    const collected = await collectClusterMeasurement(await leasor.acquire());
    expect(collected).toMatchObject({ valid: true, clusterBytes: PHASE_B1_TOTAL });
    expect(pool.connects).toBe(1);
    expect(pool.queryCalls).toBe(0);
    expect(client.queries).toEqual(STATEMENTS);
    expect(client.releases).toEqual([undefined]);
  });

  it('returns a clean client and destroys a discarded client', async () => {
    const clean = fakePool();
    const cleanLease = await createClusterMeasurementPgLeasor(clean.pool).acquire();
    await cleanLease.session.query(CLUSTER_MEASUREMENT_BEGIN_SQL);
    await cleanLease.session.query(CLUSTER_MEASUREMENT_ROLLBACK_SQL);
    await cleanLease.release('clean');
    expect(clean.client.releases).toEqual([undefined]);

    const discarded = fakePool();
    const discardedLease = await createClusterMeasurementPgLeasor(discarded.pool).acquire();
    await discardedLease.session.query(CLUSTER_MEASUREMENT_BEGIN_SQL);
    await discardedLease.release('discard');
    expect(discarded.client.releases[0]).toBeInstanceOf(Error);
    expect(discarded.client.releases).toHaveLength(1);
  });

  it('discards a failed or disconnected BEGIN instead of returning it to the pool', async () => {
    const disconnected = fakePool((sql) =>
      sql === CLUSTER_MEASUREMENT_BEGIN_SQL ? pgError('connection terminated', 'ECONNRESET') : null
    );
    const disconnectedLease = await createClusterMeasurementPgLeasor(disconnected.pool).acquire();
    await expect(disconnectedLease.session.query(CLUSTER_MEASUREMENT_BEGIN_SQL)).rejects.toThrow(/connection terminated/);
    await disconnectedLease.release('clean');
    expect(disconnected.client.releases[0]).toBeInstanceOf(Error);

    const rejected = fakePool((sql) =>
      sql === CLUSTER_MEASUREMENT_BEGIN_SQL ? pgError('syntax error', '42601') : null
    );
    const collected = await collectClusterMeasurement(await createClusterMeasurementPgLeasor(rejected.pool).acquire());
    expect(collected.valid).toBe(false);
    expect(rejected.client.queries).toEqual([CLUSTER_MEASUREMENT_BEGIN_SQL]);
    expect(rejected.client.releases[0]).toBeInstanceOf(Error);
  });

  it('discards a connection or protocol failure even after ROLLBACK succeeds', async () => {
    const reset = fakePool((sql) =>
      sql === CLUSTER_MEASUREMENT_TIMEOUT_SQL ? pgError('connection terminated', 'ECONNRESET') : null
    );
    const resetCollected = await collectClusterMeasurement(await createClusterMeasurementPgLeasor(reset.pool).acquire());
    expect(resetCollected.valid).toBe(false);
    expect(resetCollected.clusterBytes).toBeNull();
    expect(reset.client.queries).toContain(CLUSTER_MEASUREMENT_ROLLBACK_SQL);
    expect(reset.client.releases[0]).toBeInstanceOf(Error);

    const protocol = fakePool((sql) =>
      sql === CLUSTER_MEASUREMENT_TIMEOUT_SQL ? pgError('protocol violation', '08P01') : null
    );
    const protocolLease = await createClusterMeasurementPgLeasor(protocol.pool).acquire();
    await protocolLease.session.query(CLUSTER_MEASUREMENT_BEGIN_SQL);
    await expect(protocolLease.session.query(CLUSTER_MEASUREMENT_TIMEOUT_SQL)).rejects.toThrow(/protocol violation/);
    await protocolLease.session.query(CLUSTER_MEASUREMENT_ROLLBACK_SQL);
    await protocolLease.release('clean');
    expect(protocol.client.releases[0]).toBeInstanceOf(Error);

    const ambiguous = fakePool((sql) =>
      sql === CLUSTER_MEASUREMENT_TIMEOUT_SQL ? new Error('socket closed before a server response') : null
    );
    const ambiguousLease = await createClusterMeasurementPgLeasor(ambiguous.pool).acquire();
    await ambiguousLease.session.query(CLUSTER_MEASUREMENT_BEGIN_SQL);
    await expect(ambiguousLease.session.query(CLUSTER_MEASUREMENT_TIMEOUT_SQL)).rejects.toThrow(/socket closed/);
    await ambiguousLease.session.query(CLUSTER_MEASUREMENT_ROLLBACK_SQL);
    await ambiguousLease.release('clean');
    expect(ambiguous.client.releases[0]).toBeInstanceOf(Error);
  });

  it('returns a client after an ordinary statement error only once ROLLBACK succeeds', async () => {
    const timedOut = fakePool((sql) =>
      sql === CLUSTER_MEASUREMENT_TIMEOUT_SQL ? pgError('canceling statement due to statement timeout', '57014') : null
    );
    const openLease = await createClusterMeasurementPgLeasor(timedOut.pool).acquire();
    await openLease.session.query(CLUSTER_MEASUREMENT_BEGIN_SQL);
    await expect(openLease.session.query(CLUSTER_MEASUREMENT_TIMEOUT_SQL)).rejects.toThrow(/statement timeout/);
    await openLease.release('clean');
    expect(timedOut.client.releases[0]).toBeInstanceOf(Error);

    const rolledBack = fakePool((sql) =>
      sql === CLUSTER_MEASUREMENT_TIMEOUT_SQL ? pgError('canceling statement due to statement timeout', '57014') : null
    );
    const collected = await collectClusterMeasurement(await createClusterMeasurementPgLeasor(rolledBack.pool).acquire());
    expect(collected.valid).toBe(false);
    expect(collected.clusterBytes).toBeNull();
    expect(rolledBack.client.queries).toContain(CLUSTER_MEASUREMENT_ROLLBACK_SQL);
    expect(rolledBack.client.releases).toEqual([undefined]);
  });

  it('discards when rollback fails and refuses a second release', async () => {
    const failed = fakePool((sql) =>
      sql === CLUSTER_MEASUREMENT_ROLLBACK_SQL ? pgError('rollback failed', '25P02') : null
    );
    const collected = await collectClusterMeasurement(await createClusterMeasurementPgLeasor(failed.pool).acquire());
    expect(collected.valid).toBe(false);
    expect(collected.clusterBytes).toBeNull();
    expect(failed.client.queries).toEqual(STATEMENTS);
    expect(failed.client.releases[0]).toBeInstanceOf(Error);

    const { client, pool } = fakePool();
    const lease = await createClusterMeasurementPgLeasor(pool).acquire();
    await lease.session.query(CLUSTER_MEASUREMENT_BEGIN_SQL);
    await lease.session.query(CLUSTER_MEASUREMENT_ROLLBACK_SQL);
    await lease.release('clean');
    await expect(lease.release('discard')).rejects.toThrow(/released twice/);
    await expect(lease.session.query(CLUSTER_MEASUREMENT_BEGIN_SQL)).rejects.toThrow(/already released/);
    expect(client.releases).toHaveLength(1);
    expect(client.queries).toEqual([CLUSTER_MEASUREMENT_BEGIN_SQL, CLUSTER_MEASUREMENT_ROLLBACK_SQL]);
  });
});

describe('stored measurement admission', () => {
  it('denies every kind when the store read fails', async () => {
    const reader = readerOf(freshRecord(160), true);
    const ingestion = await decideStoredStorageWrite({
      reader,
      kind: 'current_season_ingestion',
      now: NOW,
      payload: { estimatedPayloadBytes: 1_000 },
    });
    const archive = await decideStoredStorageWrite({
      reader,
      kind: 's3_archive',
      now: NOW,
    });
    expect(ingestion).toMatchObject({ allowed: false, pressure: 'unmeasured' });
    expect(archive.allowed).toBe(false);
    expect(ingestion.reason).toBe(CLUSTER_MEASUREMENT_STORE_READ_FAILURE);
    expect(ingestion.reason).not.toContain('secret');
    expect(reader.calls).toBe(2);
  });

  it('denies missing, invalid, stale, future, and unknown measurements without a fallback', async () => {
    const missing = await decideStoredStorageWrite({
      reader: readerOf(null),
      kind: 'current_season_ingestion',
      now: NOW,
      payload: { estimatedPayloadBytes: 1_000 },
    });
    const invalid = await decideStoredStorageWrite({
      reader: readerOf({ ...freshRecord(160), valid: false, clusterBytes: null, measuredAt: null }),
      kind: 'current_season_ingestion',
      now: NOW,
      payload: { estimatedPayloadBytes: 1_000 },
    });
    const stale = await decideStoredStorageWrite({
      reader: readerOf(freshRecord(160, '2026-11-18T18:00:00.000Z')),
      kind: 'game_status',
      now: NOW,
    });
    const future = await decideStoredStorageWrite({
      reader: readerOf(freshRecord(160, '2026-11-18T21:00:00.000Z')),
      kind: 'game_status',
      now: NOW,
    });
    const unknown = await decideStoredStorageWrite({
      reader: readerOf(freshRecord(160)),
      kind: 'vacuum_full',
      now: NOW,
    });
    expect(missing.allowed).toBe(false);
    expect(invalid.allowed).toBe(false);
    expect(stale.allowed).toBe(false);
    expect(future.allowed).toBe(false);
    expect(unknown).toMatchObject({ allowed: false, category: null });
  });

  it('denies historical recovery and a fresh halt-sized current-season write, and keeps the S3 exemption', async () => {
    const small = readerOf(freshRecord(160));
    const allowed = await decideStoredStorageWrite({
      reader: small,
      kind: 'current_season_ingestion',
      requestedCategory: 'historical_raw_props',
      now: NOW,
      payload: { estimatedPayloadBytes: 2_000_000 },
    });
    const recovery = await decideStoredStorageWrite({
      reader: small,
      kind: 'historical_recovery',
      requestedCategory: 'current_season_box',
      approved: true,
      gameIds: ['2026-11-13'],
      now: NOW,
      payload: { estimatedPayloadBytes: 2_000_000 },
    });
    expect(allowed).toMatchObject({ allowed: true, category: 'current_season_box' });
    expect(recovery).toMatchObject({ allowed: false, category: 'optional_backfill' });

    const halt = readerOf(freshRecord(PHASE_B1_TOTAL));
    const season = await decideStoredStorageWrite({
      reader: halt,
      kind: 'current_season_ingestion',
      now: NOW,
      payload: { estimatedPayloadBytes: 2_000_000 },
    });
    const archive = await decideStoredStorageWrite({
      reader: halt,
      kind: 's3_archive',
      now: NOW,
    });
    expect(season).toMatchObject({ allowed: false, pressure: 'halt', category: 'current_season_box' });
    expect(PHASE_B1_TOTAL).toBe(478_662_833);
    expect(archive.allowed).toBe(true);
  });
});

describe('dynamo measurement item', () => {
  function fakeDynamo() {
    let stored: Record<string, unknown> | undefined;
    let failPut = false;
    const names: string[] = [];
    const client: ClusterMeasurementDynamoClient = {
      async send(command) {
        names.push(command.constructor.name);
        if (command instanceof GetItemCommand) {
          if (command.input.ConsistentRead !== true) throw new Error('measurement read must be consistent');
          if (command.input.TableName !== CLUSTER_MEASUREMENT_TABLE_NAME) throw new Error('unexpected table');
          return { Item: stored as never };
        }
        if (command instanceof PutItemCommand) {
          if (failPut) throw new Error('dynamo put failed');
          if (command.input.Item != null && 'expires_at' in command.input.Item) {
            throw new Error('measurement item must not carry a TTL');
          }
          stored = command.input.Item as Record<string, unknown>;
          return {};
        }
        throw new Error(`unexpected ${(command as { constructor: { name: string } }).constructor.name}`);
      },
    };
    return {
      client,
      names,
      failNextPut() {
        failPut = true;
      },
      stored: () => stored,
    };
  }

  it('round-trips one compact item and does not stamp a TTL', async () => {
    const fake = fakeDynamo();
    const writer = createClusterMeasurementDynamoWriter(fake.client, CLUSTER_MEASUREMENT_TABLE_NAME);
    await writer.put(freshRecord(PHASE_B1_TOTAL));
    const record = await writer.get();
    expect(record).toMatchObject(freshRecord(PHASE_B1_TOTAL));
    expect(fake.stored()).toMatchObject({
      pk: { S: CLUSTER_MEASUREMENT_ITEM_PK },
      sk: { S: CLUSTER_MEASUREMENT_ITEM_SK },
      schema_version: { N: '1' },
      valid: { BOOL: true },
      cluster_bytes: { N: String(PHASE_B1_TOTAL) },
      measured_at: { S: FRESH },
    });
    expect(fake.stored()).not.toHaveProperty('expires_at');
    expect(fake.names).toEqual(['PutItemCommand', 'GetItemCommand']);

    await writer.put({
      schemaVersion: 1,
      valid: false,
      clusterBytes: null,
      measuredAt: null,
      reason: 'rollback failed',
    });
    expect(await writer.get()).toMatchObject({ valid: false, clusterBytes: null, measuredAt: null });
    expect(fake.stored()).not.toHaveProperty('cluster_bytes');
    expect(fake.stored()).not.toHaveProperty('expires_at');
  });

  it('does not fabricate a valid measurement when the write fails', async () => {
    const fake = fakeDynamo();
    const writer = createClusterMeasurementDynamoWriter(fake.client, CLUSTER_MEASUREMENT_TABLE_NAME);
    const reader = createClusterMeasurementDynamoReader(fake.client, CLUSTER_MEASUREMENT_TABLE_NAME);
    await writer.put(freshRecord(PHASE_B1_TOTAL, '2026-11-18T18:00:00.000Z'));
    fake.failNextPut();
    await expect(
      writer.put(freshRecord(PHASE_B1_TOTAL, NOW))
    ).rejects.toThrow(/dynamo put failed/);
    expect((await reader.get())?.measuredAt).toBe('2026-11-18T18:00:00.000Z');

    const { pool } = fakePool();
    await expect(
      publishClusterMeasurement({
        leasor: createClusterMeasurementPgLeasor(pool),
        store: writer,
        now: NOW,
      })
    ).rejects.toThrow(/dynamo put failed/);
    expect((await reader.get())?.measuredAt).toBe('2026-11-18T18:00:00.000Z');
    expect((await reader.get())?.clusterBytes).toBe(PHASE_B1_TOTAL);
    const decision = await decideStoredStorageWrite({
      reader,
      kind: 'current_season_ingestion',
      now: '2026-11-18T18:30:00.000Z',
      payload: { estimatedPayloadBytes: 1_000 },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.pressure).toBe('halt');
  });

  it('requires a table name and does not send when the name is blank', async () => {
    const fake = fakeDynamo();
    expect(() => createClusterMeasurementDynamoReader(fake.client, '  ')).toThrow(/table name is required/);
    expect(() => createClusterMeasurementDynamoReader(fake.client, BDL_RATE_LIMIT_TABLE_NAME)).toThrow(/dedicated table/);
    expect(fake.names).toEqual([]);
  });
});

describe('dedicated measurement table', () => {
  const infra = join(process.cwd(), 'infra');
  const measurementTf = readFileSync(join(infra, 'storage-measurement.tf'), 'utf8');
  const rateLimitTf = readFileSync(join(infra, 'bdl-rate-limit.tf'), 'utf8');

  function block(source: string, resource: string): string {
    const start = source.indexOf(`resource "${resource}"`);
    expect(start).toBeGreaterThanOrEqual(0);
    const next = source.indexOf('\nresource "', start + 1);
    return source.slice(start, next === -1 ? source.length : next);
  }

  it('points the adapter at the dedicated table and keeps the rate-limit table unchanged', () => {
    expect(CLUSTER_MEASUREMENT_TABLE_NAME).toBe('nba-storage-cluster-measurement');
    expect(CLUSTER_MEASUREMENT_TABLE_NAME).not.toBe(BDL_RATE_LIMIT_TABLE_NAME);
    expect(measurementTf).toContain('default     = "nba-storage-cluster-measurement"');
    expect(measurementTf).toContain('billing_mode = "PAY_PER_REQUEST"');
    expect(measurementTf).toContain('hash_key     = "pk"');
    expect(measurementTf).toContain('range_key    = "sk"');
    expect(measurementTf).not.toMatch(/\bttl\b|\bstream_enabled\b|global_secondary_index/);
    expect(rateLimitTf).toContain('default     = "nba-bdl-rate-limit"');
    expect(rateLimitTf).toContain('hash_key     = "pk"');
    expect(rateLimitTf).toContain('range_key    = "sk"');
    expect(rateLimitTf).toContain('Resource = aws_dynamodb_table.bdl_rate_limit.arn');
    expect(rateLimitTf).toContain('"dynamodb:GetItem"');
    expect(rateLimitTf).toContain('"dynamodb:PutItem"');
    expect(rateLimitTf).toContain('"dynamodb:UpdateItem"');
    expect(rateLimitTf).not.toContain('nba-storage-cluster-measurement');
    expect(rateLimitTf).not.toContain('storage_cluster_measurement');
  });

  it('grants the nightly role a read and the publisher role writes only on the measurement table', () => {
    const publisher = block(measurementTf, 'aws_iam_role_policy" "storage_measurement_publisher');
    const nightly = block(measurementTf, 'aws_iam_role_policy" "nightly_storage_measurement_read');
    expect(publisher).toContain('"dynamodb:GetItem"');
    expect(publisher).toContain('"dynamodb:PutItem"');
    expect(publisher).not.toMatch(/dynamodb:(UpdateItem|DeleteItem|Scan|Query)/);
    expect(publisher).toContain('aws_dynamodb_table.storage_cluster_measurement.arn');
    expect(publisher).not.toContain('bdl_rate_limit');
    expect(nightly).toContain('aws_iam_role.lambda_nightly_bdl_execution.id');
    expect(nightly).toContain('"dynamodb:GetItem"');
    expect(nightly).not.toMatch(/dynamodb:(PutItem|UpdateItem|DeleteItem|Scan|Query)/);
    expect(nightly).toContain('aws_dynamodb_table.storage_cluster_measurement.arn');
    expect(measurementTf).not.toMatch(/dynamodb:(UpdateItem|DeleteItem|Scan|Query)/);

    const writers = readdirSync(infra)
      .filter((name) => name.endsWith('.tf'))
      .filter((name) => /dynamodb:(PutItem|UpdateItem|DeleteItem)/.test(readFileSync(join(infra, name), 'utf8')));
    expect(writers.sort()).toEqual(['bdl-rate-limit.tf', 'storage-measurement.tf']);
  });

  it('still denies unknown, stale, missing, halt, and historical-recovery writes', async () => {
    const missing = await decideStoredStorageWrite({
      reader: { async get() { return null; } },
      kind: 'current_season_ingestion',
      now: NOW,
      payload: { estimatedPayloadBytes: 1_000 },
    });
    const stale = await decideStoredStorageWrite({
      reader: {
        async get() {
          return freshRecord(160, '2026-11-18T18:00:00.000Z');
        },
      },
      kind: 'current_season_ingestion',
      now: NOW,
      payload: { estimatedPayloadBytes: 1_000 },
    });
    const unknown = await decideStoredStorageWrite({
      reader: { async get() { return freshRecord(160); } },
      kind: 'vacuum_full',
      now: NOW,
    });
    const halt = await decideStoredStorageWrite({
      reader: { async get() { return freshRecord(PHASE_B1_TOTAL); } },
      kind: 'current_season_ingestion',
      now: NOW,
      payload: { estimatedPayloadBytes: 2_000_000 },
    });
    const recovery = await decideStoredStorageWrite({
      reader: { async get() { return freshRecord(160); } },
      kind: 'historical_recovery',
      requestedCategory: 'current_season_box',
      approved: true,
      gameIds: ['2026-11-13'],
      now: NOW,
      payload: { estimatedPayloadBytes: 2_000_000 },
    });
    expect(missing.allowed).toBe(false);
    expect(stale.allowed).toBe(false);
    expect(unknown).toMatchObject({ allowed: false, category: null });
    expect(halt).toMatchObject({ allowed: false, pressure: 'halt' });
    expect(PHASE_B1_TOTAL).toBe(478_662_833);
    expect(recovery).toMatchObject({ allowed: false, category: 'optional_backfill' });
  });
});
