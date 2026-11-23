import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { SQSEvent } from 'aws-lambda';
import { CLUSTER_HALT_BYTES } from '../../../../lib/ops/storage-budget';
import { MemoryStorageReservationStore } from '../../../../lib/ops/storage-admission';
import {
  PROPS_CURRENT_ONLY_PHYSICAL_GROWTH_BOUND_BYTES,
  PROPS_MAX_ROWS_PER_GAME,
  conservativePhysicalBound,
  PROPS_CURRENT_ONLY_MEASURED_WORST_BYTES,
  PROPS_CURRENT_ONLY_RELATION_COUNT,
} from '../../../../lib/ops/storage-growth-bounds';
import {
  admitPropsCurrentOnly,
  assertCurrentOnlyRowCount,
  PropsStorageRefusal,
} from '../../storage-gate';
import { completePreferredLines, promoteCurrentOnlyProps, type PreferredLine } from '../bulk-writers';
import { InMemoryArchiveStore } from '../player-prop-snapshot-archive';
import { resetObservationClockSchemaCacheForTests } from '../observation-clock';

const NOW = '2026-11-23T17:00:00.000Z';

function measurement(clusterBytes: number) {
  return {
    clusterBytes,
    measuredAt: NOW,
    databaseObservedAt: NOW,
    source: 'test',
    valid: true,
    complete: true,
  };
}

function preferred(partial: Partial<PreferredLine> & Pick<PreferredLine, 'over_odds' | 'under_odds'>): PreferredLine {
  return {
    game_id: '101',
    player_id: '77',
    vendor: 'draftkings',
    prop_type: 'points',
    line_value: 10.5,
    market_type: 'over_under',
    snapshot_at: new Date(NOW),
    ...partial,
  };
}

describe('props current-only admission', () => {
  it('reserves the measured current-board envelope plus pull control, once', () => {
    expect(PROPS_CURRENT_ONLY_PHYSICAL_GROWTH_BOUND_BYTES).toBe(
      conservativePhysicalBound(PROPS_CURRENT_ONLY_MEASURED_WORST_BYTES, PROPS_CURRENT_ONLY_RELATION_COUNT)
    );
    expect(PROPS_CURRENT_ONLY_PHYSICAL_GROWTH_BOUND_BYTES).toBeGreaterThan(37_052_416);
  });

  it('admits one bounded write and settles the active hold', async () => {
    const reservations = new MemoryStorageReservationStore();
    const cluster = CLUSTER_HALT_BYTES - PROPS_CURRENT_ONLY_PHYSICAL_GROWTH_BOUND_BYTES - 1;
    const decision = await admitPropsCurrentOnly({
      now: NOW,
      invocationId: 'msg-1',
      measurement: measurement(cluster),
      reservations,
    });
    expect(decision.mode).toBe('current_only');
    await decision.settle();
    const again = await admitPropsCurrentOnly({
      now: NOW,
      invocationId: 'msg-1',
      measurement: measurement(cluster),
      reservations,
    });
    expect(again.mode).toBe('halt');
  });

  it('refuses at the 450 MB halt and when another hold already consumes the room', async () => {
    const full = new MemoryStorageReservationStore();
    const halted = await admitPropsCurrentOnly({
      now: NOW,
      invocationId: 'at-ceiling',
      measurement: measurement(CLUSTER_HALT_BYTES),
      reservations: full,
    });
    expect(halted.mode).toBe('halt');

    const reservations = new MemoryStorageReservationStore();
    const cluster = CLUSTER_HALT_BYTES - PROPS_CURRENT_ONLY_PHYSICAL_GROWTH_BOUND_BYTES - 1;
    const first = await admitPropsCurrentOnly({
      now: NOW,
      invocationId: 'worker-a',
      measurement: measurement(cluster),
      reservations,
    });
    const second = await admitPropsCurrentOnly({
      now: NOW,
      invocationId: 'worker-b',
      measurement: measurement(cluster),
      reservations,
    });
    expect(first.mode).toBe('current_only');
    expect(second.mode).toBe('halt');
    expect(second.reason).toMatch(/no room/);
  });

  it('refuses an unmeasured cluster and a payload above the row envelope', async () => {
    const reservations = new MemoryStorageReservationStore();
    const missing = await admitPropsCurrentOnly({
      now: NOW,
      invocationId: 'missing',
      measurement: { clusterBytes: null, measuredAt: null, source: '', valid: false, complete: false },
      reservations,
    });
    expect(missing.mode).toBe('halt');
    expect(() => assertCurrentOnlyRowCount(PROPS_MAX_ROWS_PER_GAME + 1)).toThrow(PropsStorageRefusal);
    expect(() => assertCurrentOnlyRowCount(PROPS_MAX_ROWS_PER_GAME)).not.toThrow();
  });

  it('keeps only complete preferred markets', () => {
    const lines = completePreferredLines([
      preferred({ over_odds: -110, under_odds: -110 }),
      preferred({ player_id: '78', over_odds: -120, under_odds: null }),
    ]);
    expect(lines.map((line) => line.player_id)).toEqual(['77']);
  });

  it('rolls back a failed current write and never inserts raw or deletes', async () => {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes('INSERT INTO analytics.player_prop_current')) throw new Error('current insert failed');
      if (sql.includes('AS eligible')) return { rows: [{ eligible: true }] };
      return { rows: [], rowCount: 1 };
    });
    const client = { query, release: () => undefined };
    const pool = { connect: async () => client } as unknown as Pool;
    await expect(
      promoteCurrentOnlyProps(pool, {
        gameId: '101',
        rows: [],
        preferred: [preferred({ over_odds: -110, under_odds: -110 })],
        snapshotAt: new Date(NOW),
        clocks: { observedAt: new Date(NOW), controllerEnqueuedAt: new Date(NOW) },
      })
    ).rejects.toThrow(/current insert failed/);
    expect(calls.some((sql) => sql.trim() === 'ROLLBACK')).toBe(true);
    expect(calls.some((sql) => sql.includes('COMMIT'))).toBe(false);
    expect(calls.some((sql) => /DELETE|TRUNCATE|player_prop_snapshots_v2/i.test(sql))).toBe(false);
  });
});

const handlerMocks = vi.hoisted(() => ({
  pool: null as unknown,
  fetchCalls: 0,
}));

vi.mock('../db', () => ({ getDbPool: () => handlerMocks.pool }));
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
  fetchPlayerPropsForGame: async (_key: string, _game: number, options: { onBeforeRequest?: () => Promise<void> }) => {
    if (options.onBeforeRequest) await options.onBeforeRequest();
    handlerMocks.fetchCalls += 1;
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
          updated_at: NOW,
        },
      ],
      observation: {
        requestStartedAt: new Date(NOW),
        responseReceivedAt: new Date(NOW),
        attempts: [{}],
      },
    };
  },
}));

function handlerPool(status = 'started') {
  const calls: string[] = [];
  let gameStatus = status;
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
    if (sql.includes('SELECT status, archive_status, archive_key, rows_stored')) {
      return {
        rows: [{
          status: gameStatus,
          archive_status: gameStatus === 'success' ? 'archived' : 'pending',
          archive_key: gameStatus === 'success' ? 'raw/kept.json.gz' : null,
          rows_stored: gameStatus === 'success' ? 1 : 0,
        }],
      };
    }
    if (sql.includes('player_prop_daily_attempts')) return { rows: [{ attempts: 1 }], rowCount: 1 };
    if (sql.includes('provider_attempts = provider_attempts + 1')) return { rows: [{ provider_attempts: 1 }], rowCount: 1 };
    if (sql.includes('AS eligible')) return { rows: [{ eligible: true }] };
    if (sql.includes('SELECT started_at')) return { rows: [{ started_at: new Date(NOW) }] };
    if (sql.includes('INSERT INTO analytics.player_props_current') || sql.includes('INSERT INTO analytics.player_prop_current')) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM analytics.games')) {
      return { rows: [{ season: '2026', start_time: new Date('2026-11-23T23:00:00.000Z'), home_team_id: '1', away_team_id: '2' }] };
    }
    if (sql.includes('UPDATE raw.player_prop_game_runs') && sql.includes('status = $3')) {
      gameStatus = String(values[2]);
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const client = { query, release: () => undefined };
  return { pool: { query, connect: async () => client } as unknown as Pool, calls, status: () => gameStatus };
}

const event = {
  Records: [{ messageId: 'msg-1', body: JSON.stringify({ runId: 7, gameId: '101', bdlGameId: 101, date: '2026-11-23' }) }],
} as unknown as SQSEvent;

describe('props worker current-only handler', () => {
  beforeEach(() => {
    resetObservationClockSchemaCacheForTests();
    handlerMocks.fetchCalls = 0;
    vi.stubEnv('DATA_MODE', 'live_api');
    vi.stubEnv('OFFSEASON_MODE', '0');
    vi.stubEnv('CRON_DRY_RUN', '0');
    vi.stubEnv('SUPABASE_DB_URL', 'postgres://nobody@127.0.0.1:1/none');
    vi.stubEnv('BALLDONTLIE_API_KEY', 'test-key');
    vi.stubEnv('PLAYER_PROP_S3_ARCHIVE_ENABLED', 'true');
    vi.stubEnv('NBA_DATA_BUCKET', 'test-bucket');
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

  it('does not fetch or write when admission refuses, and does not report success', async () => {
    const db = handlerPool();
    handlerMocks.pool = db.pool;
    const { handler } = await import('../../worker');
    const settled = vi.fn(async () => undefined);
    await expect(
      handler(event, undefined, {
        admit: async () => ({ mode: 'halt', reason: 'reserved capacity leaves no room for this write', pressure: 'restrict', boundBytes: 1, settle: settled }),
      })
    ).rejects.toThrow(PropsStorageRefusal);
    expect(handlerMocks.fetchCalls).toBe(0);
    expect(db.status()).toBe('started');
    expect(db.calls.some((sql) => sql.includes('INSERT') || sql.includes('DELETE'))).toBe(false);
    expect(settled).not.toHaveBeenCalled();
  });

  it('writes current markets, skips raw, and settles after a bounded success', async () => {
    const db = handlerPool();
    handlerMocks.pool = db.pool;
    const settled = vi.fn(async () => undefined);
    const seen: string[] = [];
    const { handler } = await import('../../worker');
    const retried = {
      Records: [{ ...event.Records[0], attributes: { ApproximateReceiveCount: '2' } }],
    } as unknown as SQSEvent;
    const body = JSON.parse(
      (
        await handler(retried, undefined, {
          archiveStore: new InMemoryArchiveStore(),
          admit: async (input) => {
            seen.push(input.invocationId);
            return { mode: 'current_only', reason: 'reserved', pressure: 'ok', boundBytes: 1, settle: settled };
          },
        })
      ).body
    );
    expect(body).toMatchObject({ success: true, ingested: true, failCount: 0 });
    expect(db.calls.some((sql) => sql.includes('INSERT INTO analytics.player_props_current'))).toBe(true);
    expect(db.calls.some((sql) => sql.includes('INSERT INTO analytics.player_prop_current'))).toBe(true);
    expect(db.calls.some((sql) => sql.includes('INSERT INTO raw.player_prop_snapshots_v2'))).toBe(false);
    expect(db.calls.some((sql) => sql.includes('DELETE'))).toBe(false);
    expect(seen).toEqual(['msg-1#2']);
    expect(settled).toHaveBeenCalledOnce();
  });

  it('does not fetch again when the same successful message is redelivered', async () => {
    const db = handlerPool('success');
    handlerMocks.pool = db.pool;
    const admit = vi.fn();
    const { handler } = await import('../../worker');
    const body = JSON.parse((await handler(event, undefined, { admit })).body);
    expect(body.ingested).toBe(false);
    expect(handlerMocks.fetchCalls).toBe(0);
    expect(admit).not.toHaveBeenCalled();
  });

  it('does not acknowledge the message when the archive cannot be stored', async () => {
    const db = handlerPool();
    handlerMocks.pool = db.pool;
    vi.stubEnv('PLAYER_PROP_S3_ARCHIVE_ENABLED', 'true');
    vi.stubEnv('NBA_DATA_BUCKET', '');
    const settled = vi.fn(async () => undefined);
    const { handler } = await import('../../worker');
    await expect(
      handler(event, undefined, {
        admit: async () => ({ mode: 'current_only', reason: 'reserved', pressure: 'ok', boundBytes: 1, settle: settled }),
      })
    ).rejects.toThrow(/NBA_DATA_BUCKET/);
    expect(db.calls.some((sql) => sql.includes('INSERT INTO analytics.player_props_current'))).toBe(false);
    expect(db.status()).toBe('error');
    expect(settled).toHaveBeenCalledOnce();
  });
});
