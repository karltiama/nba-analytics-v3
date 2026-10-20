import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { resetObservationClockSchemaCacheForTests } from '../observation-clock';

const mocks = vi.hoisted(() => ({
  fetchResult: null as unknown,
  fetchError: null as Error | null,
}));

vi.mock('../archive-game', () => ({
  archiveGameSnapshot: async () => ({
    rowsArchived: 0,
    archiveObjectCount: 0,
    archiveStatus: 'pending',
    archiveError: null,
    archiveKey: null,
  }),
}));

vi.mock('../fetch', () => ({
  fetchPlayerPropsForGame: async () => {
    if (mocks.fetchError) throw mocks.fetchError;
    return mocks.fetchResult;
  },
}));

import { handler } from '../../worker';

const COLS = ['observed_at', 'controller_enqueued_at', 'provider_updated_at', 'observation_clock'];
const env = {
  PLAYER_PROPS_CANARY_ONLY: '1',
  PLAYER_PROPS_CANARY_GAME_ID: '21717855',
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
  SUPABASE_DB_URL: 'postgresql://user:pass@localhost:5432/postgres',
  BALLDONTLIE_API_KEY: 'test-key',
  BDL_RATE_LIMIT_INTERVAL_MS: '13000',
  BDL_RATE_LIMIT_MAX_REQUESTS: '1',
  BDL_RATE_LIMIT_BURST: '1',
  BDL_RATE_LIMIT_MAX_RETRIES: '0',
  PLAYER_PROP_S3_ARCHIVE_ENABLED: 'false',
};

function event(body: unknown) {
  return { Records: [{ body: JSON.stringify(body) }] };
}

const approved = { runId: 0, gameId: '21717855', bdlGameId: 21717855, date: '2026-10-20' };

function pool() {
  const calls: string[] = [];
  const db = {
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes('information_schema.columns')) {
        return {
          rows: [
            ...COLS.map((column) => ({ table_schema: 'raw', table_name: 'player_prop_snapshots_v2', column_name: column })),
            ...COLS.map((column) => ({ table_schema: 'analytics', table_name: 'player_props_current', column_name: column })),
          ],
        };
      }
      if (sql.includes('season_phase')) {
        return { rows: [{ game_id: '21717855', season: '2026', season_phase: 'REGULAR' }] };
      }
      if (sql.includes('INSERT INTO raw.player_prop_pull_runs')) return { rows: [{ pull_run_id: 50 }] };
      if (sql.includes('INSERT INTO raw.player_prop_snapshots_v2')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    }),
  } as unknown as Pool;
  return { db, calls };
}

describe('player props canary worker', () => {
  beforeEach(() => {
    resetObservationClockSchemaCacheForTests();
    mocks.fetchError = null;
    mocks.fetchResult = {
      rows: [],
      incomplete: false,
      observation: { requestStartedAt: new Date(), responseReceivedAt: new Date(), attempts: [] },
    };
    for (const [key, value] of Object.entries(env)) process.env[key] = value;
  });

  it('does not clear current markets when the provider returns no rows', async () => {
    const { db, calls } = pool();
    vi.doUnmock('../db');
    const dbMod = await import('../db');
    vi.spyOn(dbMod, 'getDbPool').mockReturnValue(db);
    const result = await handler(event(approved) as never);
    const body = JSON.parse((result as { body: string }).body);
    expect(body.providerEmpty).toBe(true);
    expect(calls.some((sql) => sql.includes('DELETE FROM analytics.player_prop_current'))).toBe(false);
    expect(calls.some((sql) => sql.includes('INSERT INTO analytics.player_props_current'))).toBe(false);
  });

  it('stores incomplete raw rows without replacing the current snapshot', async () => {
    mocks.fetchResult = {
      rows: [{
        id: 1,
        game_id: 21717855,
        player_id: 77,
        vendor: 'draftkings',
        prop_type: 'points',
        line_value: '27.5',
        market: { type: 'over_under', over_odds: -110, under_odds: -110 },
        updated_at: '2026-10-20T18:00:00.000Z',
      }],
      incomplete: true,
      observation: { requestStartedAt: new Date(), responseReceivedAt: new Date(), attempts: [] },
    };
    const { db, calls } = pool();
    const dbMod = await import('../db');
    vi.spyOn(dbMod, 'getDbPool').mockReturnValue(db);
    await expect(handler(event(approved) as never)).rejects.toThrow(/INCOMPLETE/);
    expect(calls.some((sql) => sql.includes('DELETE FROM analytics.player_prop_current'))).toBe(false);
    expect(calls.some((sql) => sql.includes('INSERT INTO analytics.player_props_current'))).toBe(false);
    expect(calls.some((sql) => sql.includes('INCOMPLETE') || sql.includes('player_prop_pull_runs'))).toBe(true);
  });

  it('rejects a second game before any provider call', async () => {
    mocks.fetchError = new Error('provider should not be called');
    await expect(handler(event({ ...approved, gameId: '21717856', bdlGameId: 21717856 }) as never)).rejects.toThrow(
      /exactly one/
    );
  });
});
