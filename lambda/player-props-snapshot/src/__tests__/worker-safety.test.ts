import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { SQSEvent } from 'aws-lambda';
import { resetObservationClockSchemaCacheForTests } from '../observation-clock';
import { PLAYER_PROPS_MAX_HTTP_ATTEMPTS } from '../attempt-budget';

const mocks = vi.hoisted(() => ({
  pool: null as unknown,
  fetchCalls: 0,
  fetchError: null as Error | null,
}));

vi.mock('../db', () => ({ getDbPool: () => mocks.pool }));
vi.mock('../metrics', () => ({ emitCoverageMetric: () => {} }));
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
    if (mocks.fetchError) throw mocks.fetchError;
    return {
      rows: [
        {
          id: 1,
          game_id: 101,
          player_id: 77,
          vendor: 'draftkings',
          prop_type: 'points',
          line_value: '10.5',
          market: { type: 'over_under', over_odds: -110, under_odds: -110 },
          updated_at: '2026-10-21T20:00:00.000Z',
        },
      ],
      observation: {
        requestStartedAt: new Date('2026-10-21T22:00:00.000Z'),
        responseReceivedAt: new Date('2026-10-21T22:00:01.000Z'),
        attempts: [{}],
      },
    };
  },
}));

const COLS = ['observed_at', 'controller_enqueued_at', 'provider_updated_at', 'observation_clock'];

function scriptedPool(attemptsLeft = PLAYER_PROPS_MAX_HTTP_ATTEMPTS, initialStatus = 'started') {
  let status: string | null = initialStatus;
  let attempts = PLAYER_PROPS_MAX_HTTP_ATTEMPTS - attemptsLeft;
  const calls: string[] = [];
  const query = vi.fn(async (sql: string) => {
    calls.push(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return { rows: [] };
    if (sql.includes('information_schema.columns')) {
      return {
        rows: [
          ...COLS.map((c) => ({ table_schema: 'raw', table_name: 'player_prop_snapshots_v2', column_name: c })),
          ...COLS.map((c) => ({ table_schema: 'analytics', table_name: 'player_props_current', column_name: c })),
        ],
      };
    }
    if (sql.includes('SELECT status FROM raw.player_prop_game_runs')) {
      return { rows: status ? [{ status }] : [] };
    }
    if (sql.includes('player_prop_daily_attempts')) {
      return { rows: [{ attempts: 1 }], rowCount: 1 };
    }
    if (sql.includes('provider_attempts = provider_attempts + 1')) {
      if (attempts >= PLAYER_PROPS_MAX_HTTP_ATTEMPTS) return { rows: [], rowCount: 0 };
      attempts += 1;
      return { rows: [{ provider_attempts: attempts }], rowCount: 1 };
    }
    if (sql.includes('AS eligible')) return { rows: [{ eligible: true }] };
    if (sql.includes('SELECT started_at')) return { rows: [{ started_at: new Date('2026-10-21T21:00:00.000Z') }] };
    if (sql.includes('FROM analytics.games')) {
      return { rows: [{ season: '2026', start_time: new Date('2026-10-21T23:30:00.000Z'), home_team_id: '1', away_team_id: '2' }] };
    }
    if (sql.includes('UPDATE raw.player_prop_game_runs') && sql.includes('status = $3')) {
      status = 'error';
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const client = { query, release: () => {} };
  return {
    pool: { query, connect: async () => client } as unknown as Pool,
    calls,
    attempts: () => attempts,
    status: () => status,
  };
}

const event = {
  Records: [{ body: JSON.stringify({ runId: 7, gameId: '101', bdlGameId: 101, date: '2026-10-21', universe: 'near_tip' }) }],
} as unknown as SQSEvent;

const safeLimiter = {
  BDL_RATE_LIMIT_INTERVAL_MS: '13000',
  BDL_RATE_LIMIT_MAX_REQUESTS: '1',
  BDL_RATE_LIMIT_BURST: '1',
  BDL_RATE_LIMIT_MAX_RETRIES: '0',
};

describe('player-props worker safety (mocked provider, no network)', () => {
  beforeEach(() => {
    resetObservationClockSchemaCacheForTests();
    mocks.fetchCalls = 0;
    mocks.fetchError = null;
    vi.stubEnv('DATA_MODE', 'live_api');
    vi.stubEnv('OFFSEASON_MODE', '0');
    vi.stubEnv('CRON_DRY_RUN', '0');
    vi.stubEnv('SUPABASE_DB_URL', 'postgres://nobody@127.0.0.1:1/none');
    vi.stubEnv('BALLDONTLIE_API_KEY', 'test-key');
    vi.stubEnv('PLAYER_PROP_S3_ARCHIVE_ENABLED', 'false');
    for (const [key, value] of Object.entries(safeLimiter)) vi.stubEnv(key, value);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    ['500ms interval', { BDL_RATE_LIMIT_INTERVAL_MS: '500' }],
    ['burst above 1', { BDL_RATE_LIMIT_BURST: '2' }],
    ['retries above 0', { BDL_RATE_LIMIT_MAX_RETRIES: '1' }],
    ['missing interval', { BDL_RATE_LIMIT_INTERVAL_MS: '' }],
  ])('refuses %s before any provider call', async (_name, override) => {
    const db = scriptedPool();
    mocks.pool = db.pool;
    for (const [key, value] of Object.entries(override)) vi.stubEnv(key, value);
    const { handler } = await import('../../worker');
    await expect(handler(event)).rejects.toThrow(/props limiter refused/);
    expect(mocks.fetchCalls).toBe(0);
    expect(db.calls.some((sql) => sql.includes('INSERT INTO analytics.player_props_current'))).toBe(false);
    expect(db.calls.some((sql) => sql.includes('DELETE FROM analytics.player_prop_current'))).toBe(false);
  });

  it('a frozen worker reports no ingestion and does not fetch', async () => {
    const db = scriptedPool();
    mocks.pool = db.pool;
    vi.stubEnv('DATA_MODE', 'replay');
    vi.stubEnv('OFFSEASON_MODE', '1');
    vi.stubEnv('CRON_DRY_RUN', '1');
    const { handler } = await import('../../worker');
    const body = JSON.parse((await handler(event)).body);
    expect(body).toMatchObject({ skipped: true, ingested: false });
    expect(mocks.fetchCalls).toBe(0);
  });

  it('a provider 429 stores no current rows and keeps the attempt on the game run', async () => {
    const db = scriptedPool();
    mocks.pool = db.pool;
    mocks.fetchError = new Error('BDL 429 after 1 attempts');
    const { handler } = await import('../../worker');
    await expect(handler(event)).rejects.toThrow(/429/);
    expect(mocks.fetchCalls).toBe(1);
    expect(db.attempts()).toBe(1);
    expect(db.calls.some((sql) => sql.includes('INSERT INTO analytics.player_props_current'))).toBe(false);
    expect(db.calls.some((sql) => sql.includes('INSERT INTO raw.player_prop_snapshots_v2'))).toBe(false);
  });

  it('a later SQS receive stops when the cumulative attempt budget is already spent', async () => {
    const db = scriptedPool(0);
    mocks.pool = db.pool;
    const { handler } = await import('../../worker');
    await expect(handler(event)).rejects.toThrow(/attempt budget exhausted/);
    expect(mocks.fetchCalls).toBe(0);
    expect(db.attempts()).toBe(PLAYER_PROPS_MAX_HTTP_ATTEMPTS);
    expect(db.calls.some((sql) => sql.includes('INSERT INTO analytics.player_props_current'))).toBe(false);
  });

  it('repeated delivery of a successful run does not fetch or report a new ingestion', async () => {
    const db = scriptedPool(PLAYER_PROPS_MAX_HTTP_ATTEMPTS, 'success');
    mocks.pool = db.pool;
    const { handler } = await import('../../worker');
    const body = JSON.parse((await handler(event)).body);
    expect(body.ingested).toBe(false);
    expect(mocks.fetchCalls).toBe(0);
    expect(db.calls.some((sql) => sql.includes('provider_attempts'))).toBe(false);
  });
});
