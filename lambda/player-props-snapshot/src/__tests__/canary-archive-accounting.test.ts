import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { resetObservationClockSchemaCacheForTests } from '../observation-clock';

const archive = vi.hoisted(() => ({
  calls: 0,
  result: {
    outcome: { ok: false, error: 'write_failed', message: 'S3 PutObject 403: AccessDenied', key: 'k' },
    rowsArchived: 0,
    archiveObjectCount: 0,
    archiveStatus: 'failed' as const,
    archiveError: 'S3 PutObject 403: AccessDenied',
    archiveKey: 'k',
    skipped: false,
  },
}));

vi.mock('../archive-game', () => ({
  archiveGameSnapshot: async () => {
    archive.calls += 1;
    return archive.result;
  },
}));

vi.mock('../fetch', () => ({
  fetchPlayerPropsForGame: async () => ({
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
    incomplete: false,
    observation: { requestStartedAt: new Date(), responseReceivedAt: new Date(), attempts: [] },
  }),
}));

import { handler } from '../../worker';

const COLS = ['observed_at', 'controller_enqueued_at', 'provider_updated_at', 'observation_clock'];

function pool() {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      if (sql.includes('information_schema.columns')) {
        return {
          rows: [
            ...COLS.map((column) => ({ table_schema: 'raw', table_name: 'player_prop_snapshots_v2', column_name: column })),
            ...COLS.map((column) => ({ table_schema: 'analytics', table_name: 'player_props_current', column_name: column })),
          ],
        };
      }
      if (sql.includes('season_phase')) return { rows: [{ game_id: '21717855', season: '2026', season_phase: 'REGULAR' }] };
      if (sql.includes('INSERT INTO raw.player_prop_pull_runs')) return { rows: [{ pull_run_id: 50 }] };
      if (sql.includes('INSERT INTO raw.player_prop_snapshots_v2')) return { rows: [], rowCount: 2 };
      if (sql.includes('player_provider_ids')) return { rows: [] };
      return { rows: [], rowCount: 1 };
    }),
  } as unknown as Pool;
  return { db, calls };
}

describe('canary archive failure accounting', () => {
  beforeEach(() => {
    resetObservationClockSchemaCacheForTests();
    archive.calls = 0;
    process.env.PLAYER_PROPS_CANARY_ONLY = '1';
    process.env.PLAYER_PROPS_CANARY_GAME_ID = '21717855';
    process.env.DATA_MODE = 'live_api';
    process.env.OFFSEASON_MODE = '0';
    process.env.CRON_DRY_RUN = '0';
    process.env.SUPABASE_DB_URL = 'postgresql://user:pass@localhost:5432/postgres';
    process.env.BALLDONTLIE_API_KEY = 'test-key';
    process.env.BDL_RATE_LIMIT_INTERVAL_MS = '13000';
    process.env.BDL_RATE_LIMIT_MAX_REQUESTS = '1';
    process.env.BDL_RATE_LIMIT_BURST = '1';
    process.env.BDL_RATE_LIMIT_MAX_RETRIES = '0';
    process.env.PLAYER_PROP_S3_ARCHIVE_ENABLED = 'true';
  });

  it('keeps the stored row count when the archive fails', async () => {
    const { db, calls } = pool();
    const dbMod = await import('../db');
    vi.spyOn(dbMod, 'getDbPool').mockReturnValue(db);
    await expect(handler({
      Records: [{ body: JSON.stringify({ runId: 0, gameId: '21717855', bdlGameId: 21717855, date: '2026-10-20' }) }],
    } as never)).rejects.toThrow(/archive failed/);
    const gameUpdate = calls.find((call) => call.sql.includes('UPDATE raw.player_prop_game_runs'));
    const pullUpdate = calls.find((call) => call.sql.includes('UPDATE raw.player_prop_pull_runs'));
    expect(gameUpdate?.values[2]).toBe('error');
    expect(gameUpdate?.values[4]).toBe(2);
    expect(pullUpdate?.values[2]).toBe(2);
    expect(pullUpdate?.values[3]).toBe('error');
    expect(String(pullUpdate?.values[4])).toContain('controllerClaim');
    expect(archive.calls).toBe(1);
  });
});
