import { describe, expect, it } from 'vitest';

import { InMemoryAcqArchiveStore } from '@/lib/acquisition/archive';
import { createMemoryAcqLedgerWriter } from '@/lib/acquisition/ledger-pg';
import { runLambdaGameStatusSync } from '@/lib/games/status-sync-lambda';
import { createFixtureFetchPage, createMemoryGameStore, type ProviderGame } from '@/lib/games/status-sync';
import { MemoryStorageReservationStore, type StorageAdmissionConfig } from '@/lib/ops/storage-admission';
import { CLUSTER_HALT_BYTES } from '@/lib/ops/storage-budget';
import {
  GAME_STATUS_PHYSICAL_GROWTH_BOUND_BYTES,
  SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES,
} from '@/lib/ops/storage-growth-bounds';
import { runLambdaScoreboard } from '@/lib/scoreboard/lambda';
import { createMemoryScoreboardStore } from '@/lib/scoreboard/store';

const LIVE_SCOREBOARD = {
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
  LIVE_INGESTION_ENABLED: '1',
  SCOREBOARD_COLLECT_PRESEASON: '1',
  SCOREBOARD_TARGET_SEASON: '2026',
  BALLDONTLIE_API_KEY: 'test-not-a-real-key',
  NBA_RAW_PREFIX: 'raw',
  BDL_RATE_LIMIT_BACKEND: 'memory',
};

const LIVE_STATUS = {
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
  LIVE_INGESTION_ENABLED: 'true',
  STATUS_SYNC_TARGET_SEASON: '2026',
  BALLDONTLIE_API_KEY: 'test-not-a-real-key',
  NBA_DATA_BUCKET: 'not-contacted',
};

function tight(invocationId: string, store = new MemoryStorageReservationStore()): StorageAdmissionConfig {
  return {
    now: '2026-11-19T16:00:00.000Z',
    invocationId,
    measurement: {
      clusterBytes: CLUSTER_HALT_BYTES - GAME_STATUS_PHYSICAL_GROWTH_BOUND_BYTES - 1,
      measuredAt: '2026-11-19T15:30:00.000Z',
      source: 'publisher',
      valid: true,
      complete: true,
    },
    physicalGrowthBoundBytes: 1,
    reservations: store,
  };
}

const game: ProviderGame = {
  id: 21717860,
  season: 2026,
  status: 'Scheduled',
  datetime: '2026-10-22T23:00:00.000Z',
  date: '2026-10-22',
  home_team_score: 0,
  visitor_team_score: 0,
  home_team: { id: 13 },
  visitor_team: { id: 14 },
};

describe('scoreboard and game-status write boundaries', () => {
  it('denies scoreboard before any store or ledger call when admission is missing or halted', async () => {
    const calls: string[] = [];
    const store = createMemoryScoreboardStore();
    const loadGames = store.loadGames.bind(store);
    store.loadGames = async (...args) => {
      calls.push('load');
      return loadGames(...args);
    };
    const ledger = createMemoryAcqLedgerWriter();
    const insert = ledger.insertRow.bind(ledger);
    ledger.insertRow = async (row) => {
      calls.push('ledger');
      return insert(row);
    };
    const fetch = async () => {
      calls.push('fetch');
      return { status: 200, ok: false, acquisition: { requestIds: [], archiveStatuses: [], s3Keys: [], blockedReason: 'stop' } };
    };
    const deps = {
      env: LIVE_SCOREBOARD,
      now: new Date('2026-10-10T00:06:00.000Z'),
      store,
      archiveStore: new InMemoryAcqArchiveStore(),
      ledger,
      fetch: { games: fetch, liveBox: fetch },
    };
    const missing = await runLambdaScoreboard(deps);
    const halted = await runLambdaScoreboard({
      ...deps,
      storage: {
        ...tight('halted'),
        measurement: { ...tight('halted').measurement, clusterBytes: CLUSTER_HALT_BYTES },
      },
    });
    expect(missing.reason).toContain('not configured');
    expect(halted.reason).toContain('450,000,000');
    expect(calls).toEqual([]);
    expect(ledger.rows.size).toBe(0);
  });

  it('denies game-status before fetch or upsert, including an in-flight reservation', async () => {
    const calls: string[] = [];
    const store = createMemoryGameStore();
    const upsert = store.upsert.bind(store);
    store.upsert = (row) => {
      calls.push('upsert');
      return upsert(row);
    };
    const fetchPage = () => {
      calls.push('fetch');
      return createFixtureFetchPage([game])('unused');
    };
    const base = {
      env: LIVE_STATUS,
      now: new Date('2026-09-11T04:00:00.000Z'),
      manualCanary: true,
      dryRun: false,
      startDate: '2026-10-22',
      endDate: '2026-10-22',
      store,
    };
    const missing = await runLambdaGameStatusSync({ ...base, fetchPage });
    expect(missing.reason).toContain('not configured');
    expect(missing.wroteDb).toBe(false);
    expect(calls).toEqual([]);

    const reservations = new MemoryStorageReservationStore();
    const throwing = createMemoryGameStore();
    throwing.upsert = () => {
      calls.push('upsert');
      throw new Error('writer interrupted');
    };
    await expect(
      runLambdaGameStatusSync({
        ...base,
        store: throwing,
        fetchPage,
        storage: tight('interrupted', reservations),
      })
    ).rejects.toThrow('writer interrupted');
    expect(calls).toEqual(['fetch', 'upsert']);
    expect(reservations.snapshot().active.interrupted?.boundBytes).toBe(GAME_STATUS_PHYSICAL_GROWTH_BOUND_BYTES);
    expect(reservations.snapshot().active.interrupted?.inWrite).toBe(true);

    calls.length = 0;
    const blocked = await runLambdaGameStatusSync({
      ...base,
      fetchPage,
      storage: tight('second', reservations),
    });
    expect(blocked.reason).toContain('no room');
    expect(blocked.wroteDb).toBe(false);
    expect(calls).toEqual([]);

    calls.length = 0;
    const slipped = await runLambdaGameStatusSync({
      ...base,
      fetchPage,
      storage: {
        ...tight('slipped'),
        measurement: {
          ...tight('slipped').measurement,
          clusterBytes: CLUSTER_HALT_BYTES - 100,
        },
        physicalGrowthBoundBytes: 1,
      },
    });
    expect(slipped.wroteDb).toBe(false);
    expect(slipped.reason).toContain('no room');
    expect(calls).toEqual([]);
    expect(SCOREBOARD_PHYSICAL_GROWTH_BOUND_BYTES).toBeGreaterThan(1);
  });
});
