import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorageReservationStore } from '@/lib/ops/storage-admission';
import { CLUSTER_HALT_BYTES } from '@/lib/ops/storage-budget';
import { readFileSync } from 'node:fs';
import { estimateNightlyWindowPayloadBytes, nightlyBatchRefusal, scheduledNightlyWindowRefusal } from '../storage-admission';
import { CURRENT_SEASON_BOX_OPERATION_CAP_BYTES, decideLabeledStorageWrite } from '@/lib/ops/storage-budget';

type Call = { sql: string; values: unknown[] };

const h = vi.hoisted(() => ({
  urls: [] as string[],
  calls: [] as Call[],
  games: [] as Record<string, unknown>[],
  stats: [] as Record<string, unknown>[],
  stickyCursor: false,
  dates: {
    yesterday_et: '2026-10-19',
    today_et: '2026-10-20',
    schedule_end_et: '2026-11-03',
  },
}));

vi.mock('pg', () => {
  const query = async (sql: string, values: unknown[] = []) => {
    h.calls.push({ sql, values });
    if (sql.includes('yesterday_et')) {
      return { rows: [h.dates] };
    }
    return { rows: [], rowCount: 0 };
  };
  class Pool {
    query = query;
    async connect() {
      return { query, release: () => {} };
    }
    async end() {}
  }
  return { Pool, default: { Pool } };
});

vi.mock('../bdl-live-rate-limit', () => ({
  fetchBdlLive: async (url: string) => {
    h.urls.push(url);
    const pathname = new URL(url).pathname;
    const data = pathname.endsWith('/games') ? h.games : pathname.endsWith('/stats') ? h.stats : [];
    return new Response(JSON.stringify({ data, meta: { next_cursor: h.stickyCursor ? 1 : null } }), { status: 200 });
  },
}));

const NOW = '2026-11-18T23:00:00.000Z';
const FRESH = '2026-11-18T22:30:00.000Z';

const ENV = {
  SUPABASE_DB_URL: 'postgresql://test:test@localhost:5432/test',
  BALLDONTLIE_API_KEY: 'test-key-not-real',
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
  INGESTION_SEASON_START_YEAR: '2026',
  DISABLE_BDL_SCHEDULE_SYNC: '1',
  DISABLE_PLAYER_PERIOD_SCORING: '1',
  PGS_NORMALIZED_STORAGE: '1',
};

function game() {
  return {
    id: 200,
    season: 2026,
    date: '2026-10-20',
    datetime: '2026-10-21T02:00:00.000Z',
    status: 'Final',
    postseason: false,
    home_team_score: 110,
    visitor_team_score: 99,
    home_team: { id: 1, abbreviation: 'AAA' },
    visitor_team: { id: 2, abbreviation: 'BBB' },
  };
}

function reader(record: Record<string, unknown> | null, fail = false) {
  return {
    async get() {
      if (fail) throw new Error('dynamo unavailable');
      return record;
    },
  };
}

function measurement(clusterBytes: number, measuredAt = FRESH, valid = true) {
  return { schemaVersion: valid ? 1 : 0, valid, clusterBytes, measuredAt, reason: null };
}

async function run(
  event: unknown,
  record: Record<string, unknown> | null,
  fail = false,
  reservations: MemoryStorageReservationStore | null = new MemoryStorageReservationStore(),
  invocationId = 'nightly-test'
) {
  vi.resetModules();
  const mod = await import('../index');
  mod.setNightlyRunDepsForTests({
    now: NOW,
    measurementReader: reader(record, fail),
    reservations: reservations ?? undefined,
    invocationId: reservations ? invocationId : undefined,
    observedDatabaseGrowth: null,
  });
  return mod.handler(event);
}

function writes(): Call[] {
  return h.calls.filter((call) => /\b(insert|update|delete|begin|commit)\b/i.test(call.sql));
}

const saved: Record<string, string | undefined> = {};

describe('nightly storage admission', () => {
  beforeEach(() => {
    h.urls.length = 0;
    h.calls.length = 0;
    h.stickyCursor = false;
    h.dates = { yesterday_et: '2026-10-19', today_et: '2026-10-20', schedule_end_et: '2026-11-03' };
    h.games = [game()];
    h.stats = [{ id: 9, min: '10:00', pts: 8, game: { id: 200, season: 2026 }, player: { id: 7 }, team: { id: 1 } }];
    for (const [key, value] of Object.entries(ENV)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
    delete process.env.BDL_SCHEDULE_SYNC_DAYS_FORWARD;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete process.env.PGS_NORMALIZED_STORAGE;
    delete process.env.BDL_SCHEDULE_SYNC_DAYS_FORWARD;
    vi.restoreAllMocks();
  });

  it('keeps the default schedule window inside the payload cap and rejects the 120-day ceiling', () => {
    expect(estimateNightlyWindowPayloadBytes(14)).toBeLessThanOrEqual(CURRENT_SEASON_BOX_OPERATION_CAP_BYTES);
    expect(estimateNightlyWindowPayloadBytes(120)).toBeGreaterThan(CURRENT_SEASON_BOX_OPERATION_CAP_BYTES);
  });

  it('denies every write at the measured cluster size', async () => {
    const response = await run(undefined, measurement(478_662_833));
    const body = JSON.parse(response.body);
    expect(body.status).toBe('storage_denied');
    expect(writes()).toEqual([]);
    expect(h.urls).toEqual([]);
  });

  it('denies every write at the halt line', async () => {
    const response = await run(undefined, measurement(450_000_000));
    expect(JSON.parse(response.body).status).toBe('storage_denied');
    expect(writes()).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  it('reaches the normalized write path when the physical envelope fits under halt', async () => {
    const response = await run(undefined, measurement(1_000_000));
    const body = JSON.parse(response.body);
    expect(response.statusCode).toBe(200);
    expect(body.status).toBe('success');
    expect(body.finalGames).toBe(1);
    expect(h.calls.some((call) => call.sql.includes('insert into raw.games'))).toBe(true);
    expect(h.calls.some((call) => call.sql.includes('raw.upsert_player_game_stat'))).toBe(true);
    expect(h.calls.some((call) => call.sql.includes('insert into raw.player_game_stats'))).toBe(false);
  });

  it.each([
    ['missing', null],
    ['stale', measurement(400_000_000, '2026-11-18T20:00:00.000Z')],
    ['malformed', measurement(400_000_000, FRESH, false)],
  ])('denies a %s measurement', async (_label, record) => {
    const response = await run(undefined, record);
    expect(JSON.parse(response.body).status).toBe('storage_denied');
    expect(writes()).toEqual([]);
  });

  it('denies when the measurement store throws', async () => {
    const response = await run(undefined, null, true);
    expect(JSON.parse(response.body).admissionReason).toMatch(/read failed/);
    expect(writes()).toEqual([]);
    expect(h.urls).toEqual([]);
  });

  it('ignores an event-supplied kind and still applies the trusted class', async () => {
    const response = await run(
      { kind: 's3_archive', requestedCategory: 's3_archive' },
      measurement(478_662_833)
    );
    const body = JSON.parse(response.body);
    expect(body.status).toBe('storage_denied');
    expect(body.admissionReason).toMatch(/450,000,000/);
    expect(writes()).toEqual([]);
  });

  it('does not let a recovery event run the scheduled batch', async () => {
    const response = await run(
      { recovery: { seasonStartYear: 2025, startDate: '2026-10-20', endDate: '2026-10-20', gameIds: [200] }, kind: 'current_season_ingestion' },
      measurement(400_000_000)
    );
    expect(h.calls.some((call) => call.sql.includes('yesterday_et'))).toBe(false);
    expect(h.calls.some((call) => call.sql.includes('insert into raw.games'))).toBe(false);
    expect(JSON.parse(response.body).status).not.toBe('success');
  });

  it('refuses the legacy fat writer when the normalized flag is missing', async () => {
    delete process.env.PGS_NORMALIZED_STORAGE;
    const response = await run(undefined, measurement(400_000_000));
    expect(JSON.parse(response.body).admissionReason).toMatch(/normalized storage/);
    expect(h.calls).toEqual([]);
    expect(h.calls.some((call) => call.sql.includes('insert into raw.player_game_stats'))).toBe(false);
  });

  it('denies one byte under halt because the physical envelope does not fit', async () => {
    const response = await run(undefined, measurement(CLUSTER_HALT_BYTES - 1));
    expect(JSON.parse(response.body).status).toBe('storage_denied');
    expect(writes()).toEqual([]);
    expect(h.urls).toEqual([]);
  });

  it('denies when the reservation store is not configured', async () => {
    const response = await run(undefined, measurement(1_000_000), false, null);
    expect(JSON.parse(response.body).admissionReason).toMatch(/not configured/);
    expect(writes()).toEqual([]);
    expect(h.urls).toEqual([]);
  });

  it('does not spend the same invocation reservation twice', async () => {
    const store = new MemoryStorageReservationStore();
    vi.resetModules();
    const mod = await import('../index');
    mod.setNightlyRunDepsForTests({
      now: NOW,
      measurementReader: reader(measurement(1_000_000)),
      reservations: store,
      invocationId: 'same-invocation',
      observedDatabaseGrowth: { beforeBytes: 1_000, afterBytes: 50_000_000_000 },
    });
    const first = await mod.handler(undefined);
    expect(JSON.parse(first.body).status).toBe('storage_denied');
    const protectedAfter = store.snapshot().protectedBytes;
    expect(protectedAfter).toBeGreaterThan(0);
    h.calls.length = 0;
    const second = await mod.handler(undefined);
    expect(JSON.parse(second.body).status).toBe('storage_denied');
    expect(store.snapshot().protectedBytes).toBe(protectedAfter);
    expect(store.snapshot().active['same-invocation']).toBeDefined();
  });

  it('keeps the reservation when observed growth exceeds the bound', async () => {
    vi.resetModules();
    const store = new MemoryStorageReservationStore();
    const mod = await import('../index');
    mod.setNightlyRunDepsForTests({
      now: NOW,
      measurementReader: reader(measurement(1_000_000)),
      reservations: store,
      invocationId: 'growth-over',
      observedDatabaseGrowth: { beforeBytes: 1_000, afterBytes: 50_000_000_000 },
    });
    const response = await mod.handler(undefined);
    expect(JSON.parse(response.body).admissionReason).toMatch(/exceeds the reserved physical bound/);
    expect(store.snapshot().active['growth-over']?.inWrite).toBe(true);
    expect(store.snapshot().settled['growth-over']).toBeUndefined();
  });

  it('refuses a stat batch over the player cap before any upsert', async () => {
    h.stats = Array.from({ length: 41 }, (_, index) => ({
      id: index + 1,
      min: '10:00',
      pts: 1,
      game: { id: 200, season: 2026 },
      player: { id: index + 1 },
      team: { id: 1 },
    }));
    const response = await run(undefined, measurement(1_000_000));
    expect(JSON.parse(response.body).admissionReason).toMatch(/players per game/);
    expect(writes()).toEqual([]);
  });

  it('refuses a box window wider than yesterday and today before any provider call', () => {
    expect(scheduledNightlyWindowRefusal({
      yesterdayEt: '2026-11-13',
      todayEt: '2026-11-20',
      scheduleEndEt: '2026-12-04',
      forwardDays: 14,
    })).toMatch(/yesterday and today/);
    expect(scheduledNightlyWindowRefusal({
      yesterdayEt: '2026-11-19',
      todayEt: '2026-11-20',
      scheduleEndEt: '2026-12-04',
      forwardDays: 14,
    })).toBeNull();
  });

  it('refuses a date span that would catch up more than yesterday and today', async () => {
    h.dates = { yesterday_et: '2026-11-13', today_et: '2026-11-20', schedule_end_et: '2026-12-04' };
    const store = new MemoryStorageReservationStore();
    const response = await run(undefined, measurement(1_000_000), false, store, 'wide-window');
    expect(JSON.parse(response.body).admissionReason).toMatch(/yesterday and today/);
    expect(writes()).toEqual([]);
    expect(h.urls).toEqual([]);
    expect(store.snapshot().active['wide-window']?.boundBytes).toBeGreaterThan(0);
    expect(store.snapshot().settled['wide-window']).toBeUndefined();
  });

  it('stops an unbounded games cursor before writing', async () => {
    h.stickyCursor = true;
    const response = await run(undefined, measurement(1_000_000));
    expect(JSON.parse(response.body).admissionReason).toMatch(/exceeded 5 pages/);
    expect(writes()).toEqual([]);
  });

  it('stores the post-write PostgreSQL clock and keeps a second invocation from spending it early', async () => {
    const store = new MemoryStorageReservationStore();
    const pre = '2026-11-18T22:00:00.000Z';
    const post = '2026-11-18T22:00:02.000Z';
    const during = '2026-11-18T22:00:01.000Z';
    vi.resetModules();
    const mod = await import('../index');
    let reads = 0;
    mod.setNightlyRunDepsForTests({
      now: NOW,
      measurementReader: reader(measurement(1_000_000)),
      reservations: store,
      invocationId: 'nightly-clock',
      measureCluster: async () => {
        reads += 1;
        return {
          clusterBytes: 1_000_000,
          measuredAt: reads === 1 ? pre : post,
          databaseObservedAt: reads === 1 ? pre : post,
          source: 'nightly-bdl-updater:pg_database',
          valid: true,
          complete: true,
        };
      },
    });
    const response = await mod.handler(undefined);
    expect(JSON.parse(response.body).status).toBe('success');
    expect(store.snapshot().settled['nightly-clock']?.observedThrough).toBe(post);
    const { admitPersistentWrite } = await import('@/lib/ops/storage-admission');
    const { NIGHTLY_PHYSICAL_GROWTH_BOUND_BYTES } = await import('@/lib/ops/storage-growth-bounds');
    const overlapping = await admitPersistentWrite({
      writerId: 'scoreboard-collector',
      kind: 'scoreboard',
      invocationId: 'scoreboard-during-nightly',
      now: '2026-11-18T23:00:00.000Z',
      measurement: {
        clusterBytes: CLUSTER_HALT_BYTES - NIGHTLY_PHYSICAL_GROWTH_BOUND_BYTES - 1,
        measuredAt: '2026-11-18T22:30:00.000Z',
        databaseObservedAt: during,
        source: 'scoreboard-collector:pg_database',
        valid: true,
        complete: true,
      },
      physicalGrowthBoundBytes: NIGHTLY_PHYSICAL_GROWTH_BOUND_BYTES,
      tables: ['display.scoreboard_games'],
      reservations: store,
    });
    expect(overlapping.allowed).toBe(false);
    expect(store.snapshot().settled['nightly-clock']?.boundBytes).toBe(NIGHTLY_PHYSICAL_GROWTH_BOUND_BYTES);
    expect(store.snapshot().protectedBytes).toBe(NIGHTLY_PHYSICAL_GROWTH_BOUND_BYTES);
  });

  it('denies a forward window whose bound exceeds the payload cap before any write', async () => {
    process.env.BDL_SCHEDULE_SYNC_DAYS_FORWARD = '120';
    process.env.DISABLE_BDL_SCHEDULE_SYNC = '0';
    const response = await run(undefined, measurement(400_000_000));
    expect(JSON.parse(response.body).admissionReason).toMatch(/2,000,000/);
    expect(h.calls).toEqual([]);
    expect(h.urls).toEqual([]);
  });

  it('checks the payload cap without the measurement table when PostgreSQL measurement is wired', async () => {
    process.env.BDL_SCHEDULE_SYNC_DAYS_FORWARD = '120';
    process.env.DISABLE_BDL_SCHEDULE_SYNC = '0';
    vi.resetModules();
    const mod = await import('../index');
    mod.setNightlyRunDepsForTests({
      now: NOW,
      measurementReader: {
        async get() {
          throw new Error('measurement table must not be read');
        },
      },
      reservations: new MemoryStorageReservationStore(),
      invocationId: 'nightly-direct-cap',
      measureCluster: async () => ({
        clusterBytes: 1_000_000,
        measuredAt: FRESH,
        databaseObservedAt: FRESH,
        source: 'nightly-bdl-updater:pg_database',
        valid: true,
        complete: true,
      }),
    });
    const response = await mod.handler(undefined);
    expect(JSON.parse(response.body).admissionReason).toMatch(/2,000,000/);
    expect(h.urls).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it('refuses a recovery payload when the reservation table is wired', async () => {
    const previousTable = process.env.STORAGE_RESERVATION_TABLE;
    const previousUrl = process.env.SUPABASE_DB_URL;
    process.env.STORAGE_RESERVATION_TABLE = 'nba-storage-admission';
    process.env.SUPABASE_DB_URL = 'postgresql://example.invalid/db';
    try {
      vi.resetModules();
      const mod = await import('../index');
      const response = await mod.handler({ recovery: { gameIds: [21718143] } }, { awsRequestId: 'recovery-wired' });
      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.writesCommitted).toBe(false);
      expect(body.admissionReason).toBe('historical recovery is not admitted on the scheduled package');
      expect(h.urls).toEqual([]);
      expect(writes()).toEqual([]);
    } finally {
      if (previousTable === undefined) delete process.env.STORAGE_RESERVATION_TABLE;
      else process.env.STORAGE_RESERVATION_TABLE = previousTable;
      if (previousUrl === undefined) delete process.env.SUPABASE_DB_URL;
      else process.env.SUPABASE_DB_URL = previousUrl;
    }
  });

  it('admits a measurement that finishes after the pre-call clock and still rejects a future or stale one', async () => {
    const original = '2026-11-20T15:37:52.000Z';
    const completed = '2026-11-20T15:37:53.000Z';
    const settled = '2026-11-20T15:37:54.000Z';
    const clusterBytes = 399_331_505;
    const direct = {
      clusterBytes,
      source: 'nightly-bdl-updater:pg_database',
      valid: true,
      complete: true,
    };
    const oldPath = decideLabeledStorageWrite(
      { kind: 'current_season_ingestion' },
      { valid: true, clusterBytes, measuredAt: completed, source: direct.source },
      original
    );
    expect(oldPath.allowed).toBe(false);
    expect(oldPath.reason).toBe('cluster size measurement is future-dated');

    vi.useFakeTimers();
    vi.setSystemTime(new Date(original));
    try {
      const store = new MemoryStorageReservationStore();
      vi.resetModules();
      const admitted = await import('../index');
      let reads = 0;
      admitted.setNightlyRunDepsForTests({
        now: original,
        measurementReader: reader(null),
        reservations: store,
        invocationId: 'f71-clock',
        measureCluster: async () => {
          reads += 1;
          const measuredAt = reads === 1 ? completed : settled;
          vi.setSystemTime(new Date(measuredAt));
          return { ...direct, measuredAt, databaseObservedAt: measuredAt };
        },
      });
      const callback = vi.fn();
      const response = await admitted.handler(
        {},
        { awsRequestId: 'f71-clock', getRemainingTimeInMillis: () => 300_000 },
        callback
      );
      const body = JSON.parse(response.body);
      expect(callback).not.toHaveBeenCalled();
      expect(body.status).toBe('success');
      expect(body.finalGames).toBe(1);
      expect(body.storageDenied).toBeUndefined();
      expect(store.snapshot().settled['f71-clock']?.observedThrough).toBe(settled);
      expect(store.snapshot().active['f71-clock']).toBeUndefined();
      expect(h.urls.length).toBeGreaterThan(0);

      h.urls.length = 0;
      h.calls.length = 0;
      vi.setSystemTime(new Date(original));
      vi.resetModules();
      const future = await import('../index');
      const futureStore = new MemoryStorageReservationStore();
      future.setNightlyRunDepsForTests({
        now: new Date(Date.parse(original) + 86_400_000).toISOString(),
        measurementReader: reader(null),
        reservations: futureStore,
        invocationId: 'f71-future',
        measureCluster: async () => ({
          ...direct,
          measuredAt: new Date(Date.parse(original) + 10_000).toISOString(),
          databaseObservedAt: original,
        }),
      });
      const futureResponse = await future.handler({}, { awsRequestId: 'f71-future' });
      expect(JSON.parse(futureResponse.body).admissionReason).toBe('cluster size measurement is future-dated');
      expect(h.urls).toEqual([]);
      expect(writes()).toEqual([]);
      expect(futureStore.snapshot().active['f71-future']).toBeUndefined();
      expect(futureStore.snapshot().protectedBytes).toBe(0);

      h.calls.length = 0;
      vi.resetModules();
      const stale = await import('../index');
      const staleStore = new MemoryStorageReservationStore();
      stale.setNightlyRunDepsForTests({
        now: original,
        measurementReader: reader(null),
        reservations: staleStore,
        invocationId: 'f71-stale',
        measureCluster: async () => ({
          ...direct,
          measuredAt: new Date(Date.parse(original) - 60 * 60 * 1000 - 1).toISOString(),
          databaseObservedAt: original,
        }),
      });
      const staleResponse = await stale.handler({}, { awsRequestId: 'f71-stale' });
      expect(JSON.parse(staleResponse.body).admissionReason).toMatch(/older than 60 minutes/);
      expect(writes()).toEqual([]);
      expect(staleStore.snapshot().protectedBytes).toBe(0);

      h.calls.length = 0;
      vi.resetModules();
      const missing = await import('../index');
      missing.setNightlyRunDepsForTests({
        now: original,
        measurementReader: reader(measurement(clusterBytes, original)),
      });
      const missingResponse = await missing.handler({}, { awsRequestId: 'f71-missing' });
      expect(JSON.parse(missingResponse.body).admissionReason).toMatch(/not configured/);
      expect(writes()).toEqual([]);
      expect(h.urls).toEqual([]);

      h.calls.length = 0;
      h.urls.length = 0;
      vi.setSystemTime(new Date(completed));
      vi.resetModules();
      const retained = await import('../index');
      const retainedStore = new MemoryStorageReservationStore();
      retained.setNightlyRunDepsForTests({
        now: original,
        measurementReader: reader(null),
        reservations: retainedStore,
        invocationId: 'f71-retain',
        measureCluster: async () => ({
          ...direct,
          measuredAt: completed,
          databaseObservedAt: completed,
        }),
      });
      const retainedResponse = await retained.handler({}, { awsRequestId: 'f71-retain' });
      expect(JSON.parse(retainedResponse.body).admissionReason).toMatch(/not fresh/);
      expect(retainedStore.snapshot().settled['f71-retain']).toBeUndefined();
      expect(retainedStore.snapshot().active['f71-retain']?.boundBytes).toBeGreaterThan(0);

      h.urls.length = 0;
      h.calls.length = 0;
      vi.useRealTimers();
      vi.resetModules();
      const recovery = await import('../index');
      const recoveryStore = new MemoryStorageReservationStore();
      recovery.setNightlyRunDepsForTests({
        now: original,
        measurementReader: reader(measurement(clusterBytes, completed)),
        reservations: recoveryStore,
        invocationId: 'f71-recovery',
        productionAdmission: true,
      });
      const recoveryResponse = await recovery.handler(
        { recovery: { gameIds: [21718143] } },
        { awsRequestId: 'f71-recovery' },
        () => {}
      );
      expect(JSON.parse(recoveryResponse.body).admissionReason).toBe(
        'historical recovery is not admitted on the scheduled package'
      );
      expect(h.urls).toEqual([]);
      expect(writes()).toEqual([]);
      expect(recoveryStore.snapshot().protectedBytes).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts the measured November 19 documents and still rejects one byte over the game cap', () => {
    const capture = 'D:/court-context-backups/rollbacks/nightly-bdl-updater/f72-capture';
    const stats = JSON.parse(readFileSync(`${capture}/stats.json`, 'utf8')) as Record<string, unknown>[];
    const box = JSON.parse(readFileSync(`${capture}/box-games.json`, 'utf8')) as Record<string, unknown>[];
    const schedule = JSON.parse(readFileSync(`${capture}/schedule-games.json`, 'utf8')) as Record<string, unknown>[];
    const finals = box.filter((game) => game.status === 'Final');
    expect(stats).toHaveLength(140);
    expect(finals).toHaveLength(4);
    expect(nightlyBatchRefusal({ scheduleGames: schedule, finalGames: finals, stats })).toBeNull();
    const oversized = {
      ...stats[0],
      game: { id: 21718143, pad: 'x'.repeat(768) },
    };
    expect(nightlyBatchRefusal({ scheduleGames: [], finalGames: finals, stats: [oversized] })).toMatch(/stat document/);
    const missingGame = { ...stats[0], game: null };
    expect(nightlyBatchRefusal({ scheduleGames: [], finalGames: [], stats: [missingGame] })).toBeNull();
  });
});
