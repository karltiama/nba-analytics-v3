import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { SQSEvent } from 'aws-lambda';
import { resetObservationClockSchemaCacheForTests } from '../../src/observation-clock';

const TIP = new Date('2026-10-21T23:30:00.000Z');
const at = (minutesBeforeTip: number) => new Date(TIP.getTime() - minutesBeforeTip * 60_000);

const mocks = vi.hoisted(() => ({
  pool: null as unknown,
  fetchResult: null as unknown,
  fetchCalls: 0,
}));

vi.mock('../../src/db', () => ({ getDbPool: () => mocks.pool }));
vi.mock('../../src/metrics', () => ({ emitCoverageMetric: () => {} }));
vi.mock('../../src/prop-identity-boundary', () => ({
  classifyBdlPropPlayerIds: async (_pool: unknown, ids: string[]) => ({
    servingIds: new Set(ids),
    quarantined: 0,
    resolverQueries: 0,
  }),
  filterRowsByServingProviderId: <T>(rows: T[]) => ({ keep: rows, skipped: [] }),
}));
vi.mock('../../src/fetch', () => ({
  fetchPlayerPropsForGame: async () => {
    mocks.fetchCalls += 1;
    return mocks.fetchResult;
  },
}));

const PROVIDER_ROWS = [
  {
    id: 1,
    game_id: 12345,
    player_id: 77,
    vendor: 'draftkings',
    prop_type: 'points',
    line_value: '27.5',
    market: { type: 'over_under', over_odds: -110, under_odds: -110 },
    updated_at: at(120).toISOString(),
  },
];

const COLS = ['observed_at', 'controller_enqueued_at', 'provider_updated_at', 'observation_clock'];

function workerPool(schemaPresent: boolean, gameRunStatus: string | null = null) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const pool = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      if (sql.includes('SELECT status FROM raw.player_prop_game_runs')) {
        return { rows: gameRunStatus ? [{ status: gameRunStatus }] : [] };
      }
      if (sql.includes('information_schema.columns')) {
        return {
          rows: schemaPresent
            ? [
                ...COLS.map((c) => ({ table_schema: 'raw', table_name: 'player_prop_snapshots_v2', column_name: c })),
                ...COLS.map((c) => ({ table_schema: 'analytics', table_name: 'player_props_current', column_name: c })),
              ]
            : [],
        };
      }
      if (sql.includes('SELECT started_at FROM raw.player_prop_game_runs')) return { rows: [{ started_at: at(10) }] };
      if (sql.includes('FROM analytics.games')) {
        return { rows: [{ season: '2026', start_time: TIP, home_team_id: '1', away_team_id: '2' }] };
      }
      return { rows: [], rowCount: 1 };
    }),
  } as unknown as Pool;
  return { pool, calls };
}

describe('player-props worker observation clock (mocked I/O, no network)', () => {
  const event = {
    Records: [
      { body: JSON.stringify({ runId: 42, gameId: '1', bdlGameId: 12345, date: '2026-10-21', universe: 'near_tip' }) },
    ],
  } as unknown as SQSEvent;

  beforeEach(() => {
    resetObservationClockSchemaCacheForTests();
    mocks.fetchCalls = 0;
    vi.stubEnv('DATA_MODE', 'live_api');
    vi.stubEnv('OFFSEASON_MODE', '0');
    vi.stubEnv('CRON_DRY_RUN', '0');
    vi.stubEnv('SUPABASE_DB_URL', 'postgres://nobody@127.0.0.1:1/none');
    vi.stubEnv('BALLDONTLIE_API_KEY', 'test-key');
    vi.stubEnv('PLAYER_PROP_S3_ARCHIVE_ENABLED', 'false');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('queued T-10, observed T+2: controller time stays in legacy columns, observed_at is post-tip', async () => {
    const { pool, calls } = workerPool(true);
    mocks.pool = pool;
    mocks.fetchResult = {
      rows: PROVIDER_ROWS,
      observation: { requestStartedAt: at(9), responseReceivedAt: at(-2), attempts: [{}, {}] },
    };
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m: unknown) => void logs.push(String(m)));
    const { handler } = await import('../../worker');
    await handler(event);
    spy.mockRestore();

    const raw = calls.find((c) => c.sql.includes('INSERT INTO raw.player_prop_snapshots_v2'));
    expect(raw).toBeDefined();
    expect(raw!.values[12]).toEqual(at(10));
    expect(raw!.values[15]).toEqual(at(-2));
    expect(raw!.values[16]).toEqual(at(10));
    expect(raw!.values[17]).toEqual(at(120));
    expect(raw!.values[18]).toBe('RESPONSE_RECEIVED');
    const current = calls.find((c) => c.sql.includes('INSERT INTO analytics.player_props_current'));
    expect(current!.values[12]).toEqual(at(10));
    expect(current!.values[13]).toEqual(at(-2));

    const observation = logs
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .find((l) => l?.event === 'player_prop_observation');
    expect(observation.pre_tip).toBe(false);
    expect(observation.intended_t_minus_seconds).toBe(600);
    expect(observation.actual_t_minus_seconds).toBe(-120);
    expect(observation.attempts).toBe(2);
  });

  it('P0B: redelivery of an already-successful game run makes no provider call and no write', async () => {
    const { pool, calls } = workerPool(true, 'success');
    mocks.pool = pool;
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { handler } = await import('../../worker');
    await handler(event);
    spy.mockRestore();
    expect(mocks.fetchCalls).toBe(0);
    expect(calls.some((c) => c.sql.includes('INSERT') || c.sql.includes('UPDATE'))).toBe(false);
  });

  it('P0B: a game run still "started" (prior attempt died) is processed normally', async () => {
    const { pool } = workerPool(true, 'started');
    mocks.pool = pool;
    mocks.fetchResult = {
      rows: PROVIDER_ROWS,
      observation: { requestStartedAt: at(9), responseReceivedAt: at(8), attempts: [{}] },
    };
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { handler } = await import('../../worker');
    await handler(event);
    spy.mockRestore();
    expect(mocks.fetchCalls).toBe(1);
  });

  it('missing schema fails closed before any provider call or write', async () => {
    const { pool, calls } = workerPool(false);
    mocks.pool = pool;
    const { handler } = await import('../../worker');
    await expect(handler(event)).rejects.toThrow(/schema missing/);
    expect(mocks.fetchCalls).toBe(0);
    expect(calls.some((c) => c.sql.includes('INSERT') || c.sql.includes('UPDATE'))).toBe(false);
  });
});
