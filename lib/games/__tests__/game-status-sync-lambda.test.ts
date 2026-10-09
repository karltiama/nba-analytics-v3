import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryAcqArchiveStore } from '@/lib/acquisition';
import { createMemoryAcqLedgerWriter } from '@/lib/acquisition/ledger-pg';
import { resetDefaultMemoryLiveRateLimitStore } from '@/lib/balldontlie/live-rate-limit';
import {
  classifyManualStatusSyncCanaryEvent,
  handler,
  manualCanarySeasonBounds,
  parseManualStatusSyncCanaryEvent,
  runLambdaGameStatusSync,
  STATUS_SYNC_MANUAL_CANARY_CONFIRM,
  STATUS_SYNC_MANUAL_CANARY_MAX_DAYS,
} from '@/lib/games/status-sync-lambda';
import { createFixtureFetchPage, createMemoryGameStore, type ProviderGame } from '@/lib/games/status-sync';

/** Deployed game-status-sync freeze env (Terraform last merge), with a memory limiter for tests. */
const DEPLOYED_FROZEN_ENV: Record<string, string> = {
  DATA_MODE: 'replay',
  OFFSEASON_MODE: '1',
  CRON_DRY_RUN: '1',
  LIVE_INGESTION_ENABLED: '0',
  STATUS_SYNC_TARGET_SEASON: '2026',
  NBA_RAW_PREFIX: 'raw',
  BALLDONTLIE_API_KEY: 'test-not-a-real-key',
  BDL_RATE_LIMIT_BACKEND: 'memory',
  BDL_RATE_LIMIT_ALLOW_FAST: '1',
  BDL_RATE_LIMIT_INTERVAL_MS: '1',
  BDL_RATE_LIMIT_MAX_REQUESTS: '1000',
  BDL_RATE_LIMIT_BURST: '1000',
  BDL_RATE_LIMIT_MAX_RETRIES: '0',
};

afterEach(() => {
  vi.unstubAllGlobals();
  resetDefaultMemoryLiveRateLimitStore();
});

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

  it('thawed production path requires NBA_DATA_BUCKET before any BDL or DB work', async () => {
    const result = await runLambdaGameStatusSync({
      env: {
        DATA_MODE: 'live_api',
        OFFSEASON_MODE: '0',
        CRON_DRY_RUN: '0',
        LIVE_INGESTION_ENABLED: 'true',
        STATUS_SYNC_TARGET_SEASON: '2026',
        BALLDONTLIE_API_KEY: 'test-not-a-real-key',
        SUPABASE_DB_URL: 'postgresql://unused.example/postgres',
      },
      store: createMemoryGameStore(),
    });
    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(/missing NBA_DATA_BUCKET/);
    expect(result.bdlHttp).toBe(0);
    expect(result.wroteDb).toBe(false);
  });

  it('manual canary parse requires confirm + season window and rejects EventBridge/Scheduler', () => {
    const canary = (startDate: string, endDate: string) => ({
      manualCanary: true,
      confirm: STATUS_SYNC_MANUAL_CANARY_CONFIRM,
      startDate,
      endDate,
    });
    expect(parseManualStatusSyncCanaryEvent(canary('2026-10-22', '2026-10-22'), 2026)).toEqual({
      startDate: '2026-10-22',
      endDate: '2026-10-22',
    });
    expect(
      parseManualStatusSyncCanaryEvent({ source: 'aws.events', 'detail-type': 'Scheduled Event', ...canary('2026-10-22', '2026-10-22') }, 2026)
    ).toBeNull();
    expect(parseManualStatusSyncCanaryEvent({ source: 'aws.scheduler', ...canary('2026-10-22', '2026-10-22') }, 2026)).toBeNull();
    expect(parseManualStatusSyncCanaryEvent({ ...canary('2026-10-22', '2026-10-22'), confirm: 'yes' }, 2026)).toBeNull();
    expect(parseManualStatusSyncCanaryEvent(canary('2025-10-22', '2025-10-22'), 2026)).toBeNull();
    expect(parseManualStatusSyncCanaryEvent(undefined, 2026)).toBeNull();
  });

  it('manual canary window is defined by the target NBA season, not the calendar year', () => {
    const decide = (s: string, e: string, season: number | null = 2026) =>
      classifyManualStatusSyncCanaryEvent(
        { manualCanary: true, confirm: STATUS_SYNC_MANUAL_CANARY_CONFIRM, startDate: s, endDate: e },
        season
      );
    expect(manualCanarySeasonBounds(2026)).toEqual({ first: '2026-10-20', last: '2027-06-30' });
    expect(STATUS_SYNC_MANUAL_CANARY_MAX_DAYS).toBe(31);

    expect(decide('2027-01-01', '2027-01-31')).toEqual({ kind: 'canary', startDate: '2027-01-01', endDate: '2027-01-31' });
    expect(decide('2026-12-15', '2027-01-14').kind).toBe('canary');
    expect(decide('2027-06-01', '2027-06-30').kind).toBe('canary');
    expect(decide('2026-10-20', '2026-10-20').kind).toBe('canary');

    // Previous season, preseason of this season, and the next season.
    expect(decide('2026-04-01', '2026-04-10').kind).toBe('invalid');
    expect(decide('2026-10-19', '2026-10-21').kind).toBe('invalid');
    expect(decide('2027-06-30', '2027-07-01').kind).toBe('invalid');
    expect(decide('2027-10-20', '2027-10-22').kind).toBe('invalid');

    // Malformed, impossible, reversed, and oversized windows.
    expect(decide('2027-02-30', '2027-03-01').kind).toBe('invalid');
    expect(decide('2027-1-01', '2027-01-02').kind).toBe('invalid');
    expect(decide('2027-01-10', '2027-01-09').kind).toBe('invalid');
    expect(decide('2027-01-01', '2027-02-01')).toEqual({
      kind: 'invalid',
      reason: 'manual canary window exceeds 31 days',
    });

    // No usable target season, or a season with no known opening night.
    expect(decide('2027-01-01', '2027-01-02', null).kind).toBe('invalid');
    expect(decide('2028-01-01', '2028-01-02', 2027).kind).toBe('invalid');

    // Not a canary at all: never reaches validation.
    expect(classifyManualStatusSyncCanaryEvent({ startDate: '2027-01-01' }, 2026)).toEqual({ kind: 'none' });
  });

  it('handler fails closed on an invalid canary instead of falling through to the scheduled path', async () => {
    const prev = { ...process.env };
    process.env.DATA_MODE = 'live_api';
    process.env.OFFSEASON_MODE = '0';
    process.env.CRON_DRY_RUN = '0';
    process.env.LIVE_INGESTION_ENABLED = 'true';
    process.env.STATUS_SYNC_TARGET_SEASON = '2026';
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      for (const event of [
        { manualCanary: true, confirm: STATUS_SYNC_MANUAL_CANARY_CONFIRM, startDate: '2027-01-01', endDate: '2027-02-15' },
        { manualCanary: true, confirm: STATUS_SYNC_MANUAL_CANARY_CONFIRM, startDate: '2027-10-20', endDate: '2027-10-21' },
        { manualCanary: true, confirm: 'wrong', startDate: '2027-01-01', endDate: '2027-01-02' },
      ]) {
        const result = await handler(event);
        expect(result.status).toBe('failed');
        expect(result.bdlHttp).toBe(0);
        expect(result.wroteDb).toBe(false);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      for (const k of ['DATA_MODE', 'OFFSEASON_MODE', 'CRON_DRY_RUN', 'LIVE_INGESTION_ENABLED', 'STATUS_SYNC_TARGET_SEASON']) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  });

  it('runLambdaGameStatusSync rejects a canary window outside the target season before any provider call', async () => {
    const result = await runLambdaGameStatusSync({
      env: { ...DEPLOYED_FROZEN_ENV },
      manualCanary: true,
      dryRun: false,
      startDate: '2027-07-01',
      endDate: '2027-07-02',
      fetchPage: async () => {
        throw new Error('BDL must not run');
      },
      store: createMemoryGameStore([], { seasonPhase: true }),
    });
    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(/within season 2026/);
    expect(result.bdlHttp).toBe(0);
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

  it('canary under the deployed freeze env: one archived BDL request, then writes and REGULAR labels', async () => {
    const order: string[] = [];
    const urls: string[] = [];
    const providerGames = [
      { id: 501, date: '2026-10-20', datetime: '2026-10-20T23:30:00.000Z' },
      { id: 502, date: '2026-10-22', datetime: '2026-10-23T01:30:00.000Z' },
    ].map((g) => ({ ...g, season: 2026, status: g.datetime, home_team_score: 0, visitor_team_score: 0, home_team: { id: 1 }, visitor_team: { id: 2 } }));
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(String(url));
      order.push('http');
      return new Response(JSON.stringify({ data: providerGames, meta: { next_cursor: null, per_page: 100 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const archive = new InMemoryAcqArchiveStore();
    const put = archive.putIfAbsent.bind(archive);
    archive.putIfAbsent = async (input) => {
      order.push('archive');
      return put(input);
    };
    const ledger = createMemoryAcqLedgerWriter();
    const store = createMemoryGameStore([], { seasonPhase: true });
    const upsert = store.upsert.bind(store);
    store.upsert = (row) => {
      order.push('upsert');
      return upsert(row);
    };

    const result = await runLambdaGameStatusSync({
      env: { ...DEPLOYED_FROZEN_ENV },
      now: new Date('2026-10-19T16:00:00.000Z'),
      manualCanary: true,
      dryRun: false,
      startDate: '2026-10-20',
      endDate: '2026-10-22',
      store,
      archiveStore: archive,
      ledger,
    });

    expect(result.status).toBe('success');
    expect(result.bdlHttp).toBe(1);
    expect(urls).toHaveLength(1);
    const q = new URL(urls[0]).searchParams;
    expect(q.get('seasons[]')).toBe('2026');
    expect(q.get('season_type')).toBe('regular');
    expect(q.get('per_page')).toBe('100');
    expect(q.get('start_date')).toBe('2026-10-20');
    expect(q.get('end_date')).toBe('2026-10-22');
    expect(order).toEqual(['http', 'archive', 'upsert', 'upsert']);
    expect([...archive.objects.keys()][0]).toMatch(
      /^raw\/source=balldontlie\/league=nba\/season=2026\/entity=acq_games\//
    );
    const [row] = [...ledger.rows.values()];
    expect(row).toMatchObject({ archive_status: 'archived', parse_ok: true, season: 2026, season_type_requested: 'regular' });
    expect(row.s3_key).toBe([...archive.objects.keys()][0]);
    expect(result.seasonPhaseWrites).toBe(2);
    expect([...store.phases.values()].map((p) => `${p.phase}:${p.source}`)).toEqual([
      'REGULAR:request_season_type',
      'REGULAR:request_season_type',
    ]);
  });

  it('2027 canary window for season 2026 archives before writing and labels REGULAR', async () => {
    const order: string[] = [];
    const urls: string[] = [];
    const providerGames = [
      { id: 601, date: '2027-01-05', datetime: '2027-01-06T00:30:00.000Z' },
      { id: 602, date: '2027-01-31', datetime: '2027-01-31T20:00:00.000Z' },
    ].map((g) => ({ ...g, season: 2026, status: g.datetime, home_team_score: 0, visitor_team_score: 0, home_team: { id: 1 }, visitor_team: { id: 2 } }));
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(String(url));
      order.push('http');
      return new Response(JSON.stringify({ data: providerGames, meta: { next_cursor: null, per_page: 100 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const archive = new InMemoryAcqArchiveStore();
    const put = archive.putIfAbsent.bind(archive);
    archive.putIfAbsent = async (input) => {
      order.push('archive');
      return put(input);
    };
    const store = createMemoryGameStore([], { seasonPhase: true });
    const upsert = store.upsert.bind(store);
    store.upsert = (row) => {
      order.push('upsert');
      return upsert(row);
    };

    const result = await runLambdaGameStatusSync({
      env: { ...DEPLOYED_FROZEN_ENV },
      now: new Date('2026-10-19T16:00:00.000Z'),
      manualCanary: true,
      dryRun: false,
      startDate: '2027-01-01',
      endDate: '2027-01-31',
      store,
      archiveStore: archive,
      ledger: createMemoryAcqLedgerWriter(),
    });

    expect(result.status).toBe('success');
    expect(result.bdlHttp).toBe(1);
    const q = new URL(urls[0]).searchParams;
    expect(q.get('seasons[]')).toBe('2026');
    expect(q.get('start_date')).toBe('2027-01-01');
    expect(q.get('end_date')).toBe('2027-01-31');
    expect(order).toEqual(['http', 'archive', 'upsert', 'upsert']);
    expect([...archive.objects.keys()][0]).toMatch(/\/season=2026\/entity=acq_games\//);
    expect([...store.phases.values()].map((p) => p.phase)).toEqual(['REGULAR', 'REGULAR']);
  });

  it('same deployed freeze env without the canary flag makes no HTTP call and no writes', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const archive = new InMemoryAcqArchiveStore();
    const result = await runLambdaGameStatusSync({
      env: { ...DEPLOYED_FROZEN_ENV },
      now: new Date('2026-10-19T16:00:00.000Z'),
      store: createMemoryGameStore([], { seasonPhase: true }),
      archiveStore: archive,
      ledger: createMemoryAcqLedgerWriter(),
    });
    expect(result.status).toBe('skipped');
    expect(result.bdlHttp).toBe(0);
    expect(result.wroteDb).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(archive.objects.size).toBe(0);
  });
});
