import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { SQSEvent } from 'aws-lambda';
import { PROPS_CURRENT_ONLY_PHYSICAL_GROWTH_BOUND_BYTES } from '../../../../lib/ops/storage-growth-bounds';
import { resetObservationClockSchemaCacheForTests } from '../observation-clock';
import {
  InMemoryArchiveStore,
  buildArchiveEnvelope,
  gzipEnvelope,
  gunzipEnvelope,
  s3UserMetadata,
  envelopeToObjectMeta,
  type PlayerPropArchiveRow,
} from '../player-prop-snapshot-archive';
import { currentOnlyArchiveKey } from '../archive-game';

const NOW = '2026-11-23T17:00:00.000Z';
const STARTED = new Date(NOW);

const mocks = vi.hoisted(() => ({ pool: null as unknown, fetchCalls: 0, failPut: false }));

vi.mock('../../storage-gate', () => ({
  admitPropsInvocation: async () => ({
    mode: 'current_only',
    reason: 'reserved',
    pressure: 'ok',
    boundBytes: 74_137_600,
    settle: async () => undefined,
    releaseUnobserved: async () => undefined,
  }),
  assertCurrentOnlyRowCount: () => undefined,
  measurePropsCluster: async () => ({ clusterBytes: 1, measuredAt: NOW, source: 'test', valid: true, complete: true }),
  PropsStorageRefusal: class PropsStorageRefusal extends Error {},
}));
vi.mock('../db', () => ({ getDbPool: () => mocks.pool }));
vi.mock('../metrics', () => ({ emitCoverageMetric: () => undefined }));
vi.mock('../prop-identity-boundary', () => ({
  classifyBdlPropPlayerIds: async (_pool: unknown, ids: string[]) => ({ servingIds: new Set(ids), quarantined: 0, resolverQueries: 0 }),
  filterRowsByServingProviderId: <T>(rows: T[]) => ({ keep: rows, skipped: [] }),
}));
vi.mock('../fetch', () => ({
  fetchPlayerPropsForGame: async (_key: string, _game: number, options: { onBeforeRequest?: () => Promise<void> }) => {
    if (options.onBeforeRequest) await options.onBeforeRequest();
    mocks.fetchCalls += 1;
    return {
      rows: [{
        id: 1, game_id: 101, player_id: 77, vendor: 'draftkings', prop_type: 'points', line_value: '10.5',
        market: { type: 'over_under', over_odds: -110, under_odds: -110 }, updated_at: NOW,
      }],
      observation: { requestStartedAt: STARTED, responseReceivedAt: new Date(NOW), attempts: [{}] },
    };
  },
}));

function poolFor(initial: {
  status?: string;
  archiveStatus?: string | null;
  archiveKey?: string | null;
  rowsStored?: number;
  rowsFetched?: number;
  providerAttempts?: number;
  failInserts?: number;
  eligible?: boolean;
} = {}) {
  let status = initial.status ?? 'started';
  let archiveStatus = initial.archiveStatus ?? 'pending';
  let archiveKey = initial.archiveKey ?? null;
  let rowsStored = initial.rowsStored ?? 0;
  let rowsFetched = initial.rowsFetched ?? 0;
  let providerAttempts = initial.providerAttempts ?? 0;
  let insertFailures = initial.failInserts ?? 0;
  const eligible = initial.eligible !== false;
  const calls: string[] = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return { rows: [] };
    if (sql.includes('information_schema.columns')) {
      return {
        rows: ['observed_at', 'controller_enqueued_at', 'provider_updated_at', 'observation_clock'].flatMap((column) => [
          { table_schema: 'raw', table_name: 'player_prop_snapshots_v2', column_name: column },
          { table_schema: 'analytics', table_name: 'player_props_current', column_name: column },
        ]),
      };
    }
    if (sql.includes('rows_stored') && sql.includes('raw.player_prop_game_runs') && sql.includes('SELECT')) {
      return { rows: [{ status, archive_status: archiveStatus, archive_key: archiveKey, rows_stored: rowsStored, rows_fetched: rowsFetched, provider_attempts: providerAttempts }] };
    }
    if (sql.includes('player_prop_daily_attempts')) return { rows: [{ attempts: 1 }], rowCount: 1 };
    if (sql.includes('provider_attempts = provider_attempts + 1')) return { rows: [{ provider_attempts: 1 }], rowCount: 1 };
    if (sql.includes('AS eligible')) return { rows: [{ eligible }] };
    if (sql.includes('SELECT started_at')) return { rows: [{ started_at: STARTED }] };
    if (sql.includes('INSERT INTO analytics.player_props_current') || sql.includes('INSERT INTO analytics.player_prop_current')) {
      if (insertFailures > 0) {
        insertFailures -= 1;
        throw new Error('current insert failed');
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM analytics.games')) {
      return { rows: [{ season: '2026', start_time: new Date('2026-11-23T23:00:00.000Z'), home_team_id: '1', away_team_id: '2' }] };
    }
    if (sql.includes('UPDATE raw.player_prop_game_runs') && sql.includes('status = $3')) {
      status = String(values[2]);
      rowsFetched = Number(values[3]);
      rowsStored = Number(values[4]);
      archiveStatus = values[8] == null ? archiveStatus : String(values[8]);
      archiveKey = values[10] == null ? archiveKey : String(values[10]);
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const client = { query, release: () => undefined };
  return { pool: { query, connect: async () => client } as unknown as Pool, calls, state: () => ({ status, archiveStatus, archiveKey }) };
}

const event = {
  Records: [{ messageId: 'msg-1', body: JSON.stringify({ runId: 7, gameId: '101', bdlGameId: 101, date: '2026-11-23' }), attributes: { ApproximateReceiveCount: '1' } }],
} as unknown as SQSEvent;

function archiveKey(): string {
  return currentOnlyArchiveKey({
    rawPrefix: 'raw', season: 2026, seasonText: '2026', gameDate: '2026-11-23', gameId: '101', pullRunId: 7, snapshotAt: STARTED,
  });
}

describe('current-only archive durability', () => {
  beforeEach(() => {
    resetObservationClockSchemaCacheForTests();
    mocks.fetchCalls = 0;
    mocks.failPut = false;
    vi.stubEnv('DATA_MODE', 'live_api');
    vi.stubEnv('OFFSEASON_MODE', '0');
    vi.stubEnv('CRON_DRY_RUN', '0');
    vi.stubEnv('SUPABASE_DB_URL', 'postgres://nobody@127.0.0.1:1/none');
    vi.stubEnv('BALLDONTLIE_API_KEY', 'test-key');
    vi.stubEnv('PLAYER_PROP_S3_ARCHIVE_ENABLED', 'true');
    vi.stubEnv('NBA_DATA_BUCKET', 'test-bucket');
    vi.stubEnv('NBA_RAW_PREFIX', 'raw');
    vi.stubEnv('BDL_RATE_LIMIT_INTERVAL_MS', '13000');
    vi.stubEnv('BDL_RATE_LIMIT_MAX_REQUESTS', '1');
    vi.stubEnv('BDL_RATE_LIMIT_BURST', '1');
    vi.stubEnv('BDL_RATE_LIMIT_MAX_RETRIES', '0');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('keeps the 74,137,600-byte reservation and does not enable partial batch responses', () => {
    expect(PROPS_CURRENT_ONLY_PHYSICAL_GROWTH_BOUND_BYTES).toBe(74_137_600);
    const tf = readFileSync(new URL('../../../../infra/lambda.tf', import.meta.url), 'utf8');
    const queue = tf.slice(tf.indexOf('resource "aws_lambda_event_source_mapping" "player_props_worker_queue"'), tf.indexOf('resource "aws_lambda_function" "player_props_controller"'));
    expect(queue).toContain('batch_size                         = 1');
    expect(queue).not.toContain('ReportBatchItemFailures');
  });

  it('archives and verifies the observation before publishing current markets', async () => {
    const store = new InMemoryArchiveStore();
    const db = poolFor();
    mocks.pool = db.pool;
    const { handler } = await import('../../worker');
    const body = JSON.parse((await handler(event, undefined, { archiveStore: store })).body);
    expect(body).toMatchObject({ success: true, ingested: true });
    expect(db.calls.some((sql) => sql.includes('INSERT INTO raw.player_prop_snapshots_v2'))).toBe(false);
    expect(db.calls.some((sql) => sql.includes('INSERT INTO analytics.player_props_current'))).toBe(true);
    expect(db.calls.indexOf(db.calls.find((sql) => sql.includes('INSERT INTO analytics.player_props_current')) as string)).toBeGreaterThan(-1);
    const stored = store.objects.get(archiveKey());
    expect(stored).toBeTruthy();
    const envelope = gunzipEnvelope(stored!.body);
    expect(envelope.observed_at).toBe(new Date(NOW).toISOString());
    expect(envelope.controller_enqueued_at).toBe(STARTED.toISOString());
    expect(envelope.observation_clock).toBe('RESPONSE_RECEIVED');
    expect(envelope.checksum).toBe(stored!.metadata.checksum);
    expect(db.state().status).toBe('success');
    expect(db.state().archiveStatus).toBe('archived');
  });

  it('does not publish or acknowledge when the archive put fails', async () => {
    const store = new InMemoryArchiveStore();
    store.putIfAbsent = async () => { throw new Error('s3 put failed'); };
    const db = poolFor();
    mocks.pool = db.pool;
    const { handler } = await import('../../worker');
    await expect(handler(event, undefined, { archiveStore: store })).rejects.toThrow(/s3 put failed/);
    expect(db.calls.some((sql) => sql.includes('INSERT INTO analytics.player_props_current'))).toBe(false);
    expect(db.state().status).toBe('error');
  });

  it('rolls the database back after a durable archive and resumes from that object', async () => {
    const store = new InMemoryArchiveStore();
    const db = poolFor({ failInserts: 1 });
    mocks.pool = db.pool;
    const { handler } = await import('../../worker');
    await expect(handler(event, undefined, { archiveStore: store })).rejects.toThrow(/current insert failed/);
    expect(db.calls.some((sql) => sql.trim() === 'ROLLBACK')).toBe(true);
    expect(db.state().status).toBe('error');
    expect(store.objects.has(archiveKey())).toBe(true);
    const firstFetches = mocks.fetchCalls;
    const body = JSON.parse((await handler(event, undefined, { archiveStore: store })).body);
    expect(body).toMatchObject({ success: true, ingested: true });
    expect(mocks.fetchCalls).toBe(firstFetches);
    expect(store.objects.size).toBe(1);
    expect(db.state().status).toBe('success');
  });

  it('does not overwrite a conflicting archive object or publish it', async () => {
    const store = new InMemoryArchiveStore();
    const key = archiveKey();
    const other: PlayerPropArchiveRow[] = [];
    const envelope = buildArchiveEnvelope({
      season: 2026, pullRunId: 7, gameId: '101', sourceGameId: 101, gameDate: '2026-11-23',
      snapshotAt: STARTED, gameStartTime: new Date('2026-11-23T23:00:00.000Z'), rows: other,
      observation: { observedAt: STARTED, controllerEnqueuedAt: STARTED },
    });
    envelope.checksum = 'not-the-body';
    await store.putIfAbsent(key, gzipEnvelope(envelope), { ...s3UserMetadata(envelopeToObjectMeta(envelope)), checksum: 'not-the-body' });
    const before = Buffer.from(store.objects.get(key)!.body);
    const db = poolFor();
    mocks.pool = db.pool;
    const { handler } = await import('../../worker');
    await expect(handler(event, undefined, { archiveStore: store })).rejects.toThrow(/checksum/);
    expect(mocks.fetchCalls).toBe(0);
    expect(db.calls.some((sql) => sql.includes('INSERT INTO analytics.player_props_current'))).toBe(false);
    expect(Buffer.compare(store.objects.get(key)!.body, before)).toBe(0);
    expect(db.state().status).not.toBe('success');
  });

  it('does not acknowledge a successful game run that is missing archive evidence', async () => {
    const db = poolFor({ status: 'success', rowsStored: 2, archiveStatus: 'failed', archiveKey: null });
    mocks.pool = db.pool;
    const { handler } = await import('../../worker');
    await expect(handler(event, undefined, { archiveStore: new InMemoryArchiveStore() })).rejects.toThrow(/missing durable archive evidence/);
    expect(mocks.fetchCalls).toBe(0);
    expect(db.calls.some((sql) => sql.includes('UPDATE raw.player_prop_game_runs'))).toBe(false);
  });

  it('reuses a matching archive without fetching again', async () => {
    const store = new InMemoryArchiveStore();
    const envelope = buildArchiveEnvelope({
      season: 2026, pullRunId: 7, gameId: '101', sourceGameId: 101, gameDate: '2026-11-23',
      snapshotAt: STARTED, gameStartTime: new Date('2026-11-23T23:00:00.000Z'),
      rows: [{
        game_id: '101', source_game_id: 101, player_id: '77', source_player_id: 77, player_name: null,
        team_id: null, opponent_id: null, sportsbook: 'draftkings', prop_type: 'points', market_type: 'over_under',
        side: 'over', line_value: 10.5, odds_american: -110, odds_decimal: 1.91, implied_probability: 0.524,
        snapshot_at: STARTED.toISOString(), game_start_time: '2026-11-23T23:00:00.000Z', source: 'balldontlie',
        pull_run_id: 7, game_run_id: '7:101', provider_updated_at: null, raw_json: null,
      }],
      observation: { observedAt: STARTED, controllerEnqueuedAt: STARTED },
    });
    await store.putIfAbsent(archiveKey(), gzipEnvelope(envelope), s3UserMetadata(envelopeToObjectMeta(envelope)));
    const db = poolFor();
    mocks.pool = db.pool;
    const { handler } = await import('../../worker');
    const body = JSON.parse((await handler(event, undefined, { archiveStore: store })).body);
    expect(body).toMatchObject({ success: true, ingested: true });
    expect(mocks.fetchCalls).toBe(0);
    expect(store.objects.size).toBe(1);
  });

  it('rejects a self-consistent archive for a different game and does not overwrite it', async () => {
    const store = new InMemoryArchiveStore();
    const envelope = buildArchiveEnvelope({
      season: 2026, pullRunId: 8, gameId: '999', sourceGameId: 999, gameDate: '2026-11-22',
      snapshotAt: STARTED, gameStartTime: new Date('2026-11-23T23:00:00.000Z'), rows: [],
      observation: { observedAt: STARTED, controllerEnqueuedAt: STARTED },
    });
    const key = archiveKey();
    await store.putIfAbsent(key, gzipEnvelope(envelope), s3UserMetadata(envelopeToObjectMeta(envelope)));
    const before = Buffer.from(store.objects.get(key)!.body);
    const db = poolFor();
    mocks.pool = db.pool;
    const { handler } = await import('../../worker');
    await expect(handler(event, undefined, { archiveStore: store })).rejects.toThrow(/does not match this delivery/);
    expect(mocks.fetchCalls).toBe(0);
    expect(db.calls.some((sql) => sql.includes('INSERT INTO analytics.player_props_current'))).toBe(false);
    expect(Buffer.compare(store.objects.get(key)!.body, before)).toBe(0);
  });

  it('does not acknowledge a recorded success when the archived object is missing', async () => {
    const db = poolFor({ status: 'success', archiveStatus: 'archived', archiveKey: archiveKey(), rowsStored: 1, rowsFetched: 1, providerAttempts: 1 });
    mocks.pool = db.pool;
    const { handler } = await import('../../worker');
    await expect(handler(event, undefined, { archiveStore: new InMemoryArchiveStore() })).rejects.toThrow(/absent/);
    expect(mocks.fetchCalls).toBe(0);
    expect(db.calls.some((sql) => sql.includes('UPDATE raw.player_prop_game_runs'))).toBe(false);
  });

  it('acknowledges a pre-tip skip with no fetch and no archive', async () => {
    const store = new InMemoryArchiveStore();
    const db = poolFor({ eligible: false });
    mocks.pool = db.pool;
    const { handler } = await import('../../worker');
    const first = JSON.parse((await handler(event, undefined, { archiveStore: store })).body);
    expect(first).toMatchObject({ success: true, ingested: false });
    expect(mocks.fetchCalls).toBe(0);
    expect(store.objects.size).toBe(0);
    expect(db.state().status).toBe('success');
    const second = JSON.parse((await handler(event, undefined, { archiveStore: store })).body);
    expect(second).toMatchObject({ success: true, ingested: false });
    expect(mocks.fetchCalls).toBe(0);
  });

  it('does not acknowledge an unverified zero-row success', async () => {
    const db = poolFor({ status: 'success', rowsStored: 0, rowsFetched: 0, providerAttempts: 1, archiveStatus: 'pending', archiveKey: null });
    mocks.pool = db.pool;
    const { handler } = await import('../../worker');
    await expect(handler(event, undefined, { archiveStore: new InMemoryArchiveStore() })).rejects.toThrow(/missing durable archive evidence/);
    expect(mocks.fetchCalls).toBe(0);
    expect(db.calls.some((sql) => sql.includes('UPDATE raw.player_prop_game_runs'))).toBe(false);
  });

  it('refuses a current-only run when the archive flag is off', async () => {
    vi.stubEnv('PLAYER_PROP_S3_ARCHIVE_ENABLED', 'false');
    const db = poolFor();
    mocks.pool = db.pool;
    const { handler } = await import('../../worker');
    await expect(handler(event, undefined, { archiveStore: new InMemoryArchiveStore() })).rejects.toThrow(/archive is disabled/);
    expect(db.calls.some((sql) => sql.includes('INSERT INTO analytics.player_props_current'))).toBe(false);
    expect(db.state().status).toBe('error');
  });
});
