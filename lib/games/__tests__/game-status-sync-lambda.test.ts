import { describe, expect, it } from 'vitest';
import {
  handler,
  parseManualStatusSyncCanaryEvent,
  runLambdaGameStatusSync,
  STATUS_SYNC_MANUAL_CANARY_CONFIRM,
} from '@/lib/games/status-sync-lambda';
import { createFixtureFetchPage, createMemoryGameStore, type ProviderGame } from '@/lib/games/status-sync';

describe('game-status-sync Lambda freeze + env contract', () => {
  it('production-like freeze: no BDL and no writes', async () => {
    const prev = { ...process.env };
    process.env.DATA_MODE = 'replay';
    process.env.OFFSEASON_MODE = '1';
    process.env.CRON_DRY_RUN = '1';
    process.env.LIVE_INGESTION_ENABLED = 'false';
    try {
      const result = await handler();
      expect(result.status).toBe('skipped');
      expect(result.bdlHttp).toBe(0);
      expect(result.wroteDb).toBe(false);
      expect(result.skipped).toBe(true);
    } finally {
      process.env.DATA_MODE = prev.DATA_MODE;
      process.env.OFFSEASON_MODE = prev.OFFSEASON_MODE;
      process.env.CRON_DRY_RUN = prev.CRON_DRY_RUN;
      process.env.LIVE_INGESTION_ENABLED = prev.LIVE_INGESTION_ENABLED;
    }
  });

  it('does not connect when frozen even if store/fetch would throw', async () => {
    const result = await runLambdaGameStatusSync({
      env: {
        DATA_MODE: 'replay',
        OFFSEASON_MODE: '1',
        CRON_DRY_RUN: '1',
        LIVE_INGESTION_ENABLED: 'false',
      },
      fetchPage: async () => {
        throw new Error('BDL must not run');
      },
      store: {
        getById: async () => {
          throw new Error('DB must not run');
        },
        upsert: async () => {
          throw new Error('DB must not run');
        },
      },
    });
    expect(result.status).toBe('skipped');
    expect(result.bdlHttp).toBe(0);
  });

  it('thawed missing API key fails closed when fetch is not injected', async () => {
    const result = await runLambdaGameStatusSync({
      env: {
        DATA_MODE: 'live_api',
        OFFSEASON_MODE: '0',
        CRON_DRY_RUN: '0',
        LIVE_INGESTION_ENABLED: 'true',
        STATUS_SYNC_TARGET_SEASON: '2026',
        SUPABASE_DB_URL: 'postgresql://example/postgres',
      },
      store: createMemoryGameStore(),
    });
    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(/missing BALLDONTLIE_API_KEY/);
    expect(result.bdlHttp).toBe(0);
  });

  it('manual canary parse requires confirm + 2026 window and rejects EventBridge/Scheduler', () => {
    expect(
      parseManualStatusSyncCanaryEvent({
        manualCanary: true,
        confirm: STATUS_SYNC_MANUAL_CANARY_CONFIRM,
        startDate: '2026-10-22',
        endDate: '2026-10-22',
      })
    ).toEqual({ startDate: '2026-10-22', endDate: '2026-10-22' });
    expect(
      parseManualStatusSyncCanaryEvent({
        source: 'aws.events',
        'detail-type': 'Scheduled Event',
        manualCanary: true,
        confirm: STATUS_SYNC_MANUAL_CANARY_CONFIRM,
        startDate: '2026-10-22',
        endDate: '2026-10-22',
      })
    ).toBeNull();
    expect(
      parseManualStatusSyncCanaryEvent({
        source: 'aws.scheduler',
        manualCanary: true,
        confirm: STATUS_SYNC_MANUAL_CANARY_CONFIRM,
        startDate: '2026-10-22',
        endDate: '2026-10-22',
      })
    ).toBeNull();
    expect(
      parseManualStatusSyncCanaryEvent({
        manualCanary: true,
        confirm: 'yes',
        startDate: '2026-10-22',
        endDate: '2026-10-22',
      })
    ).toBeNull();
    expect(
      parseManualStatusSyncCanaryEvent({
        manualCanary: true,
        confirm: STATUS_SYNC_MANUAL_CANARY_CONFIRM,
        startDate: '2025-10-22',
        endDate: '2025-10-22',
      })
    ).toBeNull();
    expect(parseManualStatusSyncCanaryEvent(undefined)).toBeNull();
  });

  it('frozen handler still skips EventBridge-shaped events', async () => {
    const prev = { ...process.env };
    process.env.DATA_MODE = 'replay';
    process.env.OFFSEASON_MODE = '1';
    process.env.CRON_DRY_RUN = '1';
    process.env.LIVE_INGESTION_ENABLED = 'false';
    try {
      const result = await handler({
        source: 'aws.events',
        'detail-type': 'Scheduled Event',
        manualCanary: true,
        confirm: STATUS_SYNC_MANUAL_CANARY_CONFIRM,
        startDate: '2026-10-22',
        endDate: '2026-10-22',
      });
      expect(result.status).toBe('skipped');
      expect(result.bdlHttp).toBe(0);
      expect(result.wroteDb).toBe(false);
    } finally {
      process.env.DATA_MODE = prev.DATA_MODE;
      process.env.OFFSEASON_MODE = prev.OFFSEASON_MODE;
      process.env.CRON_DRY_RUN = prev.CRON_DRY_RUN;
      process.env.LIVE_INGESTION_ENABLED = prev.LIVE_INGESTION_ENABLED;
    }
  });

  it('explicit canary path writes while freeze env remains set', async () => {
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
    const store = createMemoryGameStore([
      {
        gameId: '21717860',
        season: '2026',
        status: '2026-10-22T23:00:00Z',
        startTime: '2026-10-22T23:00:00.000Z',
        homeTeamId: '13',
        awayTeamId: '14',
        homeScore: 0,
        awayScore: 0,
        venue: null,
      },
    ]);
    const result = await runLambdaGameStatusSync({
      env: {
        DATA_MODE: 'replay',
        OFFSEASON_MODE: '1',
        CRON_DRY_RUN: '1',
        LIVE_INGESTION_ENABLED: 'false',
        STATUS_SYNC_TARGET_SEASON: '2026',
      },
      now: new Date('2026-09-11T04:00:00.000Z'),
      manualCanary: true,
      dryRun: false,
      startDate: '2026-10-22',
      endDate: '2026-10-22',
      store,
      fetchPage: createFixtureFetchPage([game]),
    });
    expect(result.status).toBe('success');
    expect(result.skipped).toBe(false);
    expect(result.wroteDb).toBe(true);
    expect(result.startDate).toBe('2026-10-22');
    expect(result.endDate).toBe('2026-10-22');
    expect(store.rows.get('21717860')?.status).toBe('Scheduled');
  });
});
