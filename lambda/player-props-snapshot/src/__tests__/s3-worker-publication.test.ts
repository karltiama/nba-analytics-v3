import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { SQSEvent } from 'aws-lambda';
import { CLUSTER_HALT_BYTES } from '../../../../lib/ops/storage-budget';
import { MemoryStorageReservationStore } from '../../../../lib/ops/storage-admission';
import {
  PROPS_CURRENT_ONLY_PHYSICAL_GROWTH_BOUND_BYTES,
  PROPS_PULL_CONTROL_PHYSICAL_GROWTH_BOUND_BYTES,
} from '../../../../lib/ops/storage-growth-bounds';
import { pointerKey } from '../../../../lib/props/s3-current-board/pointer';
import { admitPropsCurrentOnly, admitPropsInvocation } from '../../storage-gate';
import { InMemoryPrototypeStore } from '../f39b/store';
import { InMemoryArchiveStore, buildPlayerPropSnapshotArchiveKey } from '../player-prop-snapshot-archive';
import { resetObservationClockSchemaCacheForTests } from '../observation-clock';
import { handler } from '../../worker';

const STARTED = new Date('2026-11-23T17:00:00.000Z');
const OBSERVED = new Date('2026-11-23T17:05:00.000Z');
const TIP = new Date('2026-11-23T23:00:00.000Z');

const mocks = vi.hoisted(() => ({
  pool: null as unknown,
  fetchCalls: 0,
  fetchError: '' as string,
  incomplete: false,
  empty: false,
  observedQueue: [] as Date[],
  order: [] as string[],
}));

vi.mock('../db', () => ({ getDbPool: () => mocks.pool }));
vi.mock('../metrics', () => ({ emitCoverageMetric: () => undefined }));
vi.mock('../prop-identity-boundary', () => ({
  classifyBdlPropPlayerIds: async (_pool: unknown, ids: string[]) => ({
    servingIds: new Set(ids),
    quarantined: 0,
    resolverQueries: 0,
  }),
  filterRowsByServingProviderId: <T>(rows: T[]) => ({ keep: rows, skipped: [] }),
}));
vi.mock('../fetch', () => ({
  fetchPlayerPropsForGame: async (
    _key: string,
    game: number,
    options: { onBeforeRequest?: () => Promise<void> }
  ) => {
    if (options.onBeforeRequest) await options.onBeforeRequest();
    mocks.order.push('fetch');
    mocks.fetchCalls += 1;
    if (mocks.fetchError) throw new Error(mocks.fetchError);
    const observed = mocks.observedQueue.shift() ?? OBSERVED;
    const row = {
      id: 1,
      game_id: game,
      player_id: 77,
      vendor: 'draftkings',
      prop_type: 'points',
      line_value: '10.5',
      market: { type: 'over_under', over_odds: -110, under_odds: -110 },
      updated_at: observed.toISOString(),
    };
    const observation = {
      requestStartedAt: STARTED,
      responseReceivedAt: observed,
      attempts: [{}],
    };
    if (mocks.empty) {
      return {
        rows: [],
        observation,
        pages: [{ httpStatus: 200, payload: { data: [], meta: { next_cursor: null } } }],
      };
    }
    const cursor = mocks.incomplete ? 9 : null;
    return {
      rows: [row],
      observation,
      pages: [{ httpStatus: 200, payload: { data: [row], meta: { next_cursor: cursor } } }],
    };
  },
}));

type RunState = {
  status: string;
  archiveStatus: string | null;
  archiveKey: string | null;
  rowsStored: number;
  rowsFetched: number;
  providerAttempts: number;
};

function poolFor(options: { eligible?: boolean; failCompletes?: number; allowMarket?: boolean } = {}) {
  const runs = new Map<string, RunState>();
  let failCompletes = options.failCompletes ?? 0;
  const eligible = options.eligible !== false;
  const calls: string[] = [];
  const run = (pull: unknown, game: unknown): RunState => {
    const key = `${String(pull)}:${String(game)}`;
    const found = runs.get(key);
    if (found) return found;
    const created: RunState = {
      status: 'started',
      archiveStatus: 'pending',
      archiveKey: null,
      rowsStored: 0,
      rowsFetched: 0,
      providerAttempts: 0,
    };
    runs.set(key, created);
    return created;
  };
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push(sql);
    const writing = /^(insert|update|delete|truncate)\b/i.test(sql.trim());
    if (!options.allowMarket && writing && /player_prop_snapshots_v2|analytics\.player_props_current|analytics\.player_prop_current/.test(sql)) {
      throw new Error(`market write: ${sql.slice(0, 80)}`);
    }
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql.trim())) return { rows: [] };
    if (sql.includes('information_schema.columns')) {
      return {
        rows: ['observed_at', 'controller_enqueued_at', 'provider_updated_at', 'observation_clock'].flatMap((column) => [
          { table_schema: 'raw', table_name: 'player_prop_snapshots_v2', column_name: column },
          { table_schema: 'analytics', table_name: 'player_props_current', column_name: column },
        ]),
      };
    }
    if (sql.includes('AS eligible')) {
      mocks.order.push('gate');
      return { rows: [{ eligible }] };
    }
    if (sql.includes('rows_stored') && sql.includes('raw.player_prop_game_runs') && sql.includes('SELECT') && !sql.includes('count(*)')) {
      const state = run(values[0], values[1]);
      return {
        rows: [{
          status: state.status,
          archive_status: state.archiveStatus,
          archive_key: state.archiveKey,
          rows_stored: state.rowsStored,
          rows_fetched: state.rowsFetched,
          provider_attempts: state.providerAttempts,
        }],
      };
    }
    if (sql.includes('SELECT started_at')) return { rows: [{ started_at: STARTED }] };
    if (sql.includes('FROM analytics.games') && sql.includes('start_time')) {
      return { rows: [{ season: '2026', start_time: TIP, home_team_id: '1', away_team_id: '2' }] };
    }
    if (sql.includes('provider_attempts = provider_attempts + 1')) {
      const state = run(values[0], values[1]);
      state.providerAttempts += 1;
      return { rows: [{ provider_attempts: state.providerAttempts }], rowCount: 1 };
    }
    if (sql.includes('player_prop_daily_attempts')) return { rows: [{ attempts: 1 }], rowCount: 1 };
    if (sql.includes('UPDATE raw.player_prop_game_runs') && sql.includes('status = $3')) {
      if (failCompletes > 0) {
        failCompletes -= 1;
        throw new Error('game run bookkeeping failed');
      }
      const state = run(values[0], values[1]);
      state.status = String(values[2]);
      state.rowsFetched = Number(values[3]);
      state.rowsStored = Number(values[4]);
      if (values[8] != null) state.archiveStatus = String(values[8]);
      if (values[10] != null) state.archiveKey = String(values[10]);
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const client = { query, release: () => undefined };
  return {
    pool: { query, connect: async () => client } as unknown as Pool,
    calls,
    runs,
  };
}

function message(runId: number, gameId = '101'): SQSEvent {
  return {
    Records: [{
      messageId: `msg-${runId}-${gameId}`,
      body: JSON.stringify({ runId, gameId, bdlGameId: Number(gameId), date: '2026-11-23' }),
      attributes: { ApproximateReceiveCount: '1' },
    }],
  } as unknown as SQSEvent;
}

function archiveKey(runId: number, gameId = '101'): string {
  return buildPlayerPropSnapshotArchiveKey({
    rawPrefix: 'raw',
    season: 2026,
    gameDate: '2026-11-23',
    gameId,
    pullRunId: runId,
    snapshotAt: STARTED,
  });
}

function admitted() {
  return {
    mode: 'current_only' as const,
    reason: 'reserved',
    pressure: 'ok' as const,
    boundBytes: PROPS_PULL_CONTROL_PHYSICAL_GROWTH_BOUND_BYTES,
    settle: async () => undefined,
    releaseUnobserved: async () => undefined,
  };
}

describe('s3 current-board worker publication', () => {
  beforeEach(() => {
    resetObservationClockSchemaCacheForTests();
    mocks.pool = null;
    mocks.fetchCalls = 0;
    mocks.fetchError = '';
    mocks.incomplete = false;
    mocks.empty = false;
    mocks.observedQueue = [];
    mocks.order = [];
    vi.stubEnv('DATA_MODE', 'live_api');
    vi.stubEnv('OFFSEASON_MODE', '0');
    vi.stubEnv('CRON_DRY_RUN', '0');
    vi.stubEnv('SUPABASE_DB_URL', 'postgres://nobody@127.0.0.1:1/none');
    vi.stubEnv('BALLDONTLIE_API_KEY', 'test-key');
    vi.stubEnv('BDL_RATE_LIMIT_INTERVAL_MS', '13000');
    vi.stubEnv('BDL_RATE_LIMIT_MAX_REQUESTS', '1');
    vi.stubEnv('BDL_RATE_LIMIT_BURST', '1');
    vi.stubEnv('BDL_RATE_LIMIT_MAX_RETRIES', '0');
    vi.stubEnv('PROPS_PUBLICATION_MODE', '');
    vi.stubEnv('PLAYER_PROP_S3_ARCHIVE_ENABLED', 'false');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('publishes one complete game without market-table writes', async () => {
    vi.stubEnv('PROPS_PUBLICATION_MODE', 's3_current_board');
    const db = poolFor();
    mocks.pool = db.pool;
    const store = new InMemoryPrototypeStore();
    const result = await handler(message(7), undefined, { admit: async () => admitted(), currentBoardStore: store });
    const body = JSON.parse(result.body);
    expect(body.successCount).toBe(1);
    expect(body.promotedCount).toBe(0);
    expect(mocks.fetchCalls).toBe(1);
    expect(mocks.order.indexOf('gate')).toBeLessThan(mocks.order.indexOf('fetch'));
    const pointer = await store.get(pointerKey('101'));
    expect(pointer).not.toBeNull();
    const parsed = JSON.parse(pointer!.body.toString('utf8')) as { archiveKey: string; pullRunId: number; observedAt: string };
    expect(parsed.pullRunId).toBe(7);
    expect(parsed.observedAt).toBe(OBSERVED.toISOString());
    expect(parsed.archiveKey).toBe(archiveKey(7));
    const archived = await store.get(parsed.archiveKey);
    const manifest = await store.get(`${parsed.archiveKey}.publication.json`);
    expect(archived).not.toBeNull();
    expect(manifest).not.toBeNull();
    expect(db.calls.some((sql) => /^(insert|update|delete)\b/i.test(sql.trim()) && /player_prop_snapshots_v2|analytics\.player_props_current|analytics\.player_prop_current/.test(sql))).toBe(false);
    const source = readFileSync(new URL('../s3-worker-publication.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/promoteCurrentOnlyProps|CURRENT_PROPS_SOURCE|player_prop_snapshots_v2/);
  });

  it('rejects an open cursor and a failed page before any object is written', async () => {
    vi.stubEnv('PROPS_PUBLICATION_MODE', 's3_current_board');
    const store = new InMemoryPrototypeStore();
    mocks.pool = poolFor().pool;
    mocks.incomplete = true;
    await expect(handler(message(7), undefined, { admit: async () => admitted(), currentBoardStore: store })).rejects.toThrow(/incomplete_pagination/);
    expect(store.objects.size).toBe(0);

    mocks.incomplete = false;
    mocks.fetchError = 'BDL /odds/player_props game 101: exceeded 10 pages';
    mocks.pool = poolFor().pool;
    await expect(handler(message(8), undefined, { admit: async () => admitted(), currentBoardStore: store })).rejects.toThrow(/exceeded 10 pages/);
    expect(store.objects.size).toBe(0);
  });

  it('does not acknowledge an archive failure, a pointer failure, or a bookkeeping failure', async () => {
    vi.stubEnv('PROPS_PUBLICATION_MODE', 's3_current_board');
    const store = new InMemoryPrototypeStore();
    store.failPuts = 1;
    mocks.pool = poolFor().pool;
    await expect(handler(message(7), undefined, { admit: async () => admitted(), currentBoardStore: store })).rejects.toThrow(/write_failed/);
    expect(await store.get(pointerKey('101'))).toBeNull();

    store.failPuts = 0;
    store.failPointerPuts = 1;
    const db = poolFor();
    mocks.pool = db.pool;
    mocks.fetchCalls = 0;
    await expect(handler(message(7), undefined, { admit: async () => admitted(), currentBoardStore: store })).rejects.toThrow(/pointer_write_failed/);
    expect(await store.get(archiveKey(7))).not.toBeNull();
    expect(await store.get(pointerKey('101'))).toBeNull();

    const retry = await handler(message(7), undefined, { admit: async () => admitted(), currentBoardStore: store });
    expect(JSON.parse(retry.body).successCount).toBe(1);
    expect(mocks.fetchCalls).toBe(1);
    expect(JSON.parse((await store.get(pointerKey('101')))!.body.toString('utf8')).pullRunId).toBe(7);

    const book = poolFor({ failCompletes: 1 });
    mocks.pool = book.pool;
    const second = new InMemoryPrototypeStore();
    await expect(handler(message(9), undefined, { admit: async () => admitted(), currentBoardStore: second })).rejects.toThrow(/bookkeeping failed/);
    expect(await second.get(pointerKey('101'))).not.toBeNull();
    const again = await handler(message(9), undefined, { admit: async () => admitted(), currentBoardStore: second });
    expect(JSON.parse(again.body).successCount).toBe(1);
  });

  it('reuses a stored archive on a duplicate and does not move the pointer backward', async () => {
    vi.stubEnv('PROPS_PUBLICATION_MODE', 's3_current_board');
    const db = poolFor();
    mocks.pool = db.pool;
    const store = new InMemoryPrototypeStore();
    const deps = { admit: async () => admitted(), currentBoardStore: store };
    await handler(message(7), undefined, deps);
    const etag = (await store.get(pointerKey('101')))!.etag;
    mocks.fetchCalls = 0;
    const duplicate = await handler(message(7), undefined, deps);
    expect(JSON.parse(duplicate.body).successCount).toBe(1);
    expect(mocks.fetchCalls).toBe(0);
    expect((await store.get(pointerKey('101')))!.etag).toBe(etag);

    mocks.observedQueue = [new Date('2026-11-23T18:00:00.000Z'), new Date('2026-11-23T17:00:00.000Z')];
    await handler(message(8), undefined, deps);
    await handler(message(6), undefined, deps);
    const pointer = JSON.parse((await store.get(pointerKey('101')))!.body.toString('utf8')) as { pullRunId: number };
    expect(pointer.pullRunId).toBe(8);
    expect(await store.get(archiveKey(6))).not.toBeNull();
  });

  it('lets the newer of two overlapping publications keep the pointer', async () => {
    vi.stubEnv('PROPS_PUBLICATION_MODE', 's3_current_board');
    mocks.pool = poolFor().pool;
    const store = new InMemoryPrototypeStore();
    store.holdPointerPuts = 1;
    mocks.observedQueue = [new Date('2026-11-23T18:00:00.000Z'), new Date('2026-11-23T17:00:00.000Z')];
    const deps = { admit: async () => admitted(), currentBoardStore: store };
    const pending = Promise.all([handler(message(8), undefined, deps), handler(message(6), undefined, deps)]);
    const started = Date.now();
    while (store.waitingPointerPuts() < 1) {
      if (Date.now() - started > 2000) throw new Error('pointer hold was not reached');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    store.releasePointerPuts();
    const results = await pending;
    expect(results.every((result) => JSON.parse(result.body).successCount === 1)).toBe(true);
    const pointer = JSON.parse((await store.get(pointerKey('101')))!.body.toString('utf8')) as { observedAt: string };
    expect(pointer.observedAt).toBe('2026-11-23T18:00:00.000Z');
  });

  it('does not fetch a Final or unopened game, an empty board, or a refused admission', async () => {
    vi.stubEnv('PROPS_PUBLICATION_MODE', 's3_current_board');
    const store = new InMemoryPrototypeStore();
    mocks.pool = poolFor({ eligible: false }).pool;
    const skipped = await handler(message(7), undefined, { admit: async () => admitted(), currentBoardStore: store });
    expect(JSON.parse(skipped.body).postTipSkipped).toBe(1);
    expect(mocks.fetchCalls).toBe(0);
    expect(store.objects.size).toBe(0);

    mocks.empty = true;
    mocks.pool = poolFor().pool;
    await expect(handler(message(8), undefined, { admit: async () => admitted(), currentBoardStore: store })).rejects.toThrow(/empty_snapshot/);
    expect(store.objects.size).toBe(0);

    mocks.empty = false;
    mocks.pool = poolFor().pool;
    const beforeAdmission = mocks.fetchCalls;
    const admitCalls = { n: 0 };
    await expect(handler(message(9), undefined, {
      currentBoardStore: store,
      admit: async () => {
        admitCalls.n += 1;
        return { mode: 'halt' as const, reason: 'no room', pressure: 'halt' as const, boundBytes: 1, settle: async () => undefined, releaseUnobserved: async () => undefined };
      },
    })).rejects.toThrow(/no room/);
    expect(admitCalls.n).toBe(1);
    expect(mocks.fetchCalls).toBe(beforeAdmission);
  });

  it('fails closed when the mode or the bucket is missing or unknown', async () => {
    vi.stubEnv('PROPS_PUBLICATION_MODE', 's3');
    await expect(handler(message(7))).rejects.toThrow(/invalid PROPS_PUBLICATION_MODE/);

    vi.stubEnv('PROPS_PUBLICATION_MODE', 's3_current_board');
    mocks.pool = poolFor().pool;
    await expect(handler(message(7), undefined, { admit: async () => admitted() })).rejects.toThrow(/bucket is not configured/);
    expect(mocks.fetchCalls).toBe(0);
  });

  it('keeps the unset mode on the PostgreSQL current tables', async () => {
    const db = poolFor({ allowMarket: true });
    mocks.pool = db.pool;
    vi.stubEnv('PLAYER_PROP_S3_ARCHIVE_ENABLED', 'true');
    vi.stubEnv('NBA_DATA_BUCKET', 'test-bucket');
    const store = new InMemoryArchiveStore();
    const result = await handler(message(7), undefined, { admit: async () => admitted(), archiveStore: store });
    expect(JSON.parse(result.body).promotedCount).toBe(1);
    expect(db.calls.some((sql) => sql.includes('INSERT INTO analytics.player_props_current'))).toBe(true);
    expect(db.calls.some((sql) => sql.includes('INSERT INTO raw.player_prop_snapshots_v2'))).toBe(false);
  });

  it('reserves the measured control-write bound instead of the market publication', async () => {
    const cluster = CLUSTER_HALT_BYTES - PROPS_CURRENT_ONLY_PHYSICAL_GROWTH_BOUND_BYTES;
    const measurement = {
      clusterBytes: cluster,
      measuredAt: OBSERVED.toISOString(),
      databaseObservedAt: OBSERVED.toISOString(),
      source: 'test',
      valid: true,
      complete: true,
    };
    const s3 = await admitPropsInvocation({
      env: { PROPS_PUBLICATION_MODE: 's3_current_board' },
      now: OBSERVED.toISOString(),
      invocationId: 's3-1',
      measureCluster: async () => measurement,
      reservations: new MemoryStorageReservationStore(),
    });
    expect(s3.mode).toBe('current_only');
    expect(s3.boundBytes).toBe(PROPS_PULL_CONTROL_PHYSICAL_GROWTH_BOUND_BYTES);
    expect(s3.boundBytes).toBeLessThan(PROPS_CURRENT_ONLY_PHYSICAL_GROWTH_BOUND_BYTES);
    const market = await admitPropsCurrentOnly({
      now: OBSERVED.toISOString(),
      invocationId: 'market-1',
      measurement,
      reservations: new MemoryStorageReservationStore(),
    });
    expect(market.mode).toBe('halt');
    await expect(admitPropsInvocation({
      env: { PROPS_PUBLICATION_MODE: 'somewhere' },
      now: OBSERVED.toISOString(),
      invocationId: 'bad',
      measureCluster: async () => measurement,
      reservations: new MemoryStorageReservationStore(),
    })).rejects.toThrow(/invalid PROPS_PUBLICATION_MODE/);
  });

  it('leaves a conflicting archive in place', async () => {
    vi.stubEnv('PROPS_PUBLICATION_MODE', 's3_current_board');
    const store = new InMemoryPrototypeStore();
    const key = archiveKey(7);
    await store.put(key, Buffer.from('not-an-archive'), {}, { kind: 'if-none-match', etag: '*' });
    mocks.pool = poolFor().pool;
    await expect(handler(message(7), undefined, { admit: async () => admitted(), currentBoardStore: store })).rejects.toThrow(/not a readable envelope/);
    expect(mocks.fetchCalls).toBe(0);
    expect((await store.get(key))!.body.toString('utf8')).toBe('not-an-archive');
    expect(await store.get(pointerKey('101'))).toBeNull();
  });

  it('releases the reservation when a real GetObject denial happens before the provider fetch', async () => {
    vi.stubEnv('PROPS_PUBLICATION_MODE', 's3_current_board');
    const db = poolFor();
    mocks.pool = db.pool;
    const settled = vi.fn(async () => undefined);
    const released = vi.fn(async () => undefined);
    const store = {
      async get(): Promise<null> {
        const error = new Error('not authorized to perform: s3:GetObject') as Error & {
          $metadata: { httpStatusCode: number };
        };
        error.name = 'AccessDenied';
        error.$metadata = { httpStatusCode: 403 };
        throw error;
      },
      async put(): Promise<never> {
        throw new Error('unused');
      },
      async putIfAbsent(): Promise<never> {
        throw new Error('unused');
      },
    };
    await expect(handler(message(12), undefined, {
      admit: async () => ({ ...admitted(), settle: settled, releaseUnobserved: released }),
      currentBoardStore: store,
    })).rejects.toThrow(/s3 get failed/);
    expect(mocks.fetchCalls).toBe(0);
    expect(settled).not.toHaveBeenCalled();
    expect(released).toHaveBeenCalledOnce();
    expect(db.calls.some((sql) => sql.includes('INSERT INTO analytics.player_props_current'))).toBe(false);
    expect(db.calls.some((sql) => sql.includes('INSERT INTO raw.player_prop_snapshots_v2'))).toBe(false);
  });
});
