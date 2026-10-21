import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { SQSEvent } from 'aws-lambda';
import { resetObservationClockSchemaCacheForTests } from '../observation-clock';

const TIP = new Date('2026-10-21T23:00:00.000Z');

const mocks = vi.hoisted(() => ({
  pool: null as unknown,
  fetchCalls: 0,
  archive: null as null | (() => Promise<unknown>),
  metrics: [] as Array<{ dims: Record<string, string>; values: Record<string, number> }>,
}));

vi.mock('../db', () => ({ getDbPool: () => mocks.pool }));
vi.mock('../metrics', () => ({
  emitCoverageMetric: (_ns: string, dims: Record<string, string>, values: Record<string, number>) =>
    void mocks.metrics.push({ dims, values }),
}));
vi.mock('../prop-identity-boundary', () => ({
  classifyBdlPropPlayerIds: async (_pool: unknown, ids: string[]) => ({
    servingIds: new Set(ids),
    quarantined: 0,
    resolverQueries: 0,
  }),
  filterRowsByServingProviderId: <T>(rows: T[]) => ({ keep: rows, skipped: [] }),
}));
vi.mock('../fetch', () => ({
  fetchPlayerPropsForGame: async (_key: string, _game: number, options: { onBeforeRequest?: () => Promise<void> }) => {
    if (options.onBeforeRequest) await options.onBeforeRequest();
    mocks.fetchCalls += 1;
    return {
      rows: [
        {
          id: 1,
          game_id: 21717922,
          player_id: 77,
          vendor: 'draftkings',
          prop_type: 'points',
          line_value: '10.5',
          market: { type: 'over_under', over_odds: -110, under_odds: -110 },
          updated_at: '2026-10-21T19:00:00.000Z',
        },
      ],
      observation: {
        requestStartedAt: new Date('2026-10-21T19:51:49.000Z'),
        responseReceivedAt: new Date('2026-10-21T19:51:49.799Z'),
        attempts: [{}],
      },
    };
  },
}));
vi.mock('../archive-game', async () => {
  const actual = await vi.importActual<typeof import('../archive-game')>('../archive-game');
  return {
    ...actual,
    archiveGameSnapshot: (args: unknown) =>
      mocks.archive ? mocks.archive() : actual.archiveGameSnapshot(args as never),
  };
});

const COLS = ['observed_at', 'controller_enqueued_at', 'provider_updated_at', 'observation_clock'];

function poolFor(options: { failRaw?: boolean } = {}) {
  let status = 'started';
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return { rows: [] };
    if (sql.includes('information_schema.columns')) {
      return {
        rows: [
          ...COLS.map((c) => ({ table_schema: 'raw', table_name: 'player_prop_snapshots_v2', column_name: c })),
          ...COLS.map((c) => ({ table_schema: 'analytics', table_name: 'player_props_current', column_name: c })),
        ],
      };
    }
    if (sql.includes('provider_attempts = provider_attempts + 1')) {
      return { rows: [{ provider_attempts: 1 }], rowCount: 1 };
    }
    if (sql.includes('AS eligible')) return { rows: [{ eligible: true }] };
    if (sql.includes('SELECT status FROM raw.player_prop_game_runs')) {
      return { rows: [{ status }] };
    }
    if (sql.includes('SELECT started_at')) return { rows: [{ started_at: new Date('2026-10-21T19:51:47.684Z') }] };
    if (sql.includes('FROM analytics.games')) {
      return { rows: [{ season: '2026', start_time: TIP, home_team_id: '1', away_team_id: '2' }] };
    }
    if (sql.includes('INSERT INTO raw.player_prop_snapshots_v2')) {
      if (options.failRaw) throw new Error('raw insert failed');
      return { rows: [], rowCount: 2 };
    }
    if (sql.includes('UPDATE raw.player_prop_game_runs') && sql.includes('status = $3')) {
      status = String(values[2]);
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const client = { query, release: () => {} };
  return {
    pool: { query, connect: async () => client } as unknown as Pool,
    calls,
    status: () => status,
  };
}

function completion(calls: Array<{ sql: string; values: unknown[] }>) {
  return calls.filter((call) => call.sql.includes('UPDATE raw.player_prop_game_runs') && call.sql.includes('status = $3'));
}

const event = {
  Records: [
    {
      body: JSON.stringify({
        runId: 579,
        gameId: '21717922',
        bdlGameId: 21717922,
        date: '2026-10-21',
        universe: 'broad',
      }),
    },
  ],
} as unknown as SQSEvent;

describe('optional archive does not invalidate a stored game', () => {
  beforeEach(() => {
    resetObservationClockSchemaCacheForTests();
    mocks.fetchCalls = 0;
    mocks.archive = null;
    mocks.metrics = [];
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
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('records a successful archive without a second provider call', async () => {
    const db = poolFor();
    mocks.pool = db.pool;
    mocks.archive = async () => ({
      outcome: { ok: true, result: 'written', key: 'raw/pull=579', rowCount: 2, checksum: 'abc' },
      rowsArchived: 2,
      archiveObjectCount: 1,
      archiveStatus: 'archived',
      archiveError: null,
      archiveKey: 'raw/pull=579',
      skipped: false,
    });
    const { handler } = await import('../../worker');
    const body = JSON.parse((await handler(event)).body);
    expect(body).toMatchObject({ success: true, ingested: true, failCount: 0 });
    const saved = completion(db.calls).at(-1);
    expect(saved?.values[2]).toBe('success');
    expect(saved?.values[3]).toBe(1);
    expect(saved?.values[4]).toBe(2);
    expect(saved?.values[8]).toBe('archived');
    expect(mocks.fetchCalls).toBe(1);
    const batch = mocks.metrics.find((metric) => metric.dims.Component === 'WorkerBatch');
    expect(batch?.values.ArchiveFailed).toBe(0);
    expect(batch?.values.GamesFailed).toBe(0);
  });

  it('keeps fetched and stored counts when HeadObject fails and does not refetch', async () => {
    const db = poolFor();
    mocks.pool = db.pool;
    mocks.archive = async () => ({
      outcome: { ok: false, error: 'write_failed', message: 's3 head failed: Unknown: UnknownError http=403', key: 'k' },
      rowsArchived: 0,
      archiveObjectCount: 0,
      archiveStatus: 'failed',
      archiveError: 's3 head failed: Unknown: UnknownError http=403',
      archiveKey: 'k',
      skipped: false,
    });
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((message: unknown) => void errors.push(String(message)));
    const { handler } = await import('../../worker');
    const first = JSON.parse((await handler(event)).body);
    expect(first).toMatchObject({ success: true, ingested: true, failCount: 0 });
    const saved = completion(db.calls).at(-1);
    expect(saved?.values[2]).toBe('success');
    expect(saved?.values[3]).toBe(1);
    expect(saved?.values[4]).toBe(2);
    expect(saved?.values[5]).toBeNull();
    expect(saved?.values[8]).toBe('failed');
    expect(saved?.values[9]).toMatch(/http=403/);
    expect(db.status()).toBe('success');
    const logged = errors.map((line) => JSON.parse(line)).find((line) => line.event === 'player_prop_archive_failed');
    expect(logged).toMatchObject({
      pullRunId: 579,
      gameId: '21717922',
      rowsFetched: 1,
      rowsStored: 2,
      archiveStatus: 'failed',
    });
    const batch = mocks.metrics.find((metric) => metric.dims.Component === 'WorkerBatch');
    expect(batch?.values.ArchiveFailed).toBe(1);
    expect(batch?.values.ArchiveGap).toBe(1);
    expect(batch?.values.GamesFailed).toBe(0);

    const second = JSON.parse((await handler(event)).body);
    expect(second.ingested).toBe(false);
    expect(mocks.fetchCalls).toBe(1);
  });

  it('stays pending and still succeeds when archival is disabled', async () => {
    const db = poolFor();
    mocks.pool = db.pool;
    vi.stubEnv('PLAYER_PROP_S3_ARCHIVE_ENABLED', 'false');
    const { handler } = await import('../../worker');
    const body = JSON.parse((await handler(event)).body);
    expect(body.success).toBe(true);
    const saved = completion(db.calls).at(-1);
    expect(saved?.values[2]).toBe('success');
    expect(saved?.values[3]).toBe(1);
    expect(saved?.values[4]).toBe(2);
    expect(saved?.values[8]).toBe('pending');
    expect(mocks.fetchCalls).toBe(1);
  });

  it('a raw insert failure still fails the invocation for SQS retry', async () => {
    const db = poolFor({ failRaw: true });
    mocks.pool = db.pool;
    const { handler } = await import('../../worker');
    await expect(handler(event)).rejects.toThrow(/raw insert failed/);
    const saved = completion(db.calls).at(-1);
    expect(saved?.values[2]).toBe('error');
    expect(saved?.values[3]).toBe(0);
    expect(saved?.values[4]).toBe(0);
    expect(mocks.fetchCalls).toBe(1);
    const batch = mocks.metrics.find((metric) => metric.dims.Component === 'WorkerBatch');
    expect(batch?.values.GamesFailed).toBe(1);
  });
});
