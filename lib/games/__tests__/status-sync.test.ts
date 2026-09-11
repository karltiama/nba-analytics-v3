import { describe, expect, it, vi } from 'vitest';
import { canonicalStartTimeUtc } from '@/lib/games/canonical-start-time';
import {
  frequentQueryIsFullSeason,
  planStatusSyncQuery,
  statusSyncRequestUrl,
} from '@/lib/games/status-sync-query';
import {
  classifyStatusSyncProviderError,
  createFixtureFetchPage,
  createMemoryGameStore,
  planGameStatusWrite,
  runGameStatusSync,
  shouldSkipGameStatusSync,
  type LocalGameRow,
  type ProviderGame,
} from '@/lib/games/status-sync';
import { PINNED_ANALYTICS_SEASON } from '@/lib/season';

const freezeEnv = {
  DATA_MODE: 'replay',
  OFFSEASON_MODE: '1',
  CRON_DRY_RUN: '1',
  LIVE_INGESTION_ENABLED: 'false',
  STATUS_SYNC_TARGET_SEASON: '2026',
} as Record<string, string>;

const liveEnv = {
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
  LIVE_INGESTION_ENABLED: 'true',
  STATUS_SYNC_TARGET_SEASON: '2026',
} as Record<string, string>;

const now = new Date('2026-10-22T03:15:00.000Z');

function local(partial: Partial<LocalGameRow> & Pick<LocalGameRow, 'gameId'>): LocalGameRow {
  return {
    season: '2026',
    status: 'Scheduled',
    startTime: '2026-10-22T23:30:00.000Z',
    homeTeamId: '13',
    awayTeamId: '14',
    homeScore: 0,
    awayScore: 0,
    venue: null,
    ...partial,
  };
}

function provider(partial: Partial<ProviderGame> & Pick<ProviderGame, 'id'>): ProviderGame {
  return {
    season: 2026,
    status: 'Scheduled',
    datetime: '2026-10-22T23:30:00.000Z',
    date: '2026-10-22',
    home_team_score: 0,
    visitor_team_score: 0,
    home_team: { id: 13 },
    visitor_team: { id: 14 },
    ...partial,
  };
}

describe('canonical start_time UTC', () => {
  it('normalizes an evening ET tip to UTC', () => {
    const d = canonicalStartTimeUtc('2026-10-22T23:30:00.000Z', '2026-10-22');
    expect(d?.toISOString()).toBe('2026-10-22T23:30:00.000Z');
  });

  it('keeps a game that crosses midnight UTC on the UTC instant', () => {
    const d = canonicalStartTimeUtc('2026-10-23T02:30:00.000Z', '2026-10-22');
    expect(d?.toISOString()).toBe('2026-10-23T02:30:00.000Z');
  });

  it('parses a DST spring-forward ET offset datetime to UTC', () => {
    const d = canonicalStartTimeUtc('2026-03-08T20:00:00-04:00', '2026-03-08');
    expect(d?.toISOString()).toBe('2026-03-09T00:00:00.000Z');
  });
});

describe('frequent query planner', () => {
  it('does not default to full-season polling', () => {
    const slateNow = new Date('2026-10-22T23:30:00.000Z');
    const plan = planStatusSyncQuery({ mode: 'frequent', targetSeason: 2026, now: slateNow });
    expect(plan.startDate).toBe('2026-10-21');
    expect(plan.endDate).toBe('2026-10-23');
    expect(plan.maxPages).toBe(3);
    expect(frequentQueryIsFullSeason(plan)).toBe(false);
    const url = statusSyncRequestUrl(plan);
    expect(url).toContain('/v1/games');
    expect(url).toContain('start_date=2026-10-21');
    expect(url).toContain('end_date=2026-10-23');
    expect(url).toContain('seasons%5B%5D=2026');
    expect(url).not.toMatch(/\/nba\/v1\/games/);
  });

  it('full-season mode is explicit and omitted from frequent URLs', () => {
    const full = planStatusSyncQuery({ mode: 'full_season', targetSeason: 2026, now });
    expect(full.startDate).toBeNull();
    expect(statusSyncRequestUrl(full)).not.toContain('start_date');
    const frequent = planStatusSyncQuery({ targetSeason: 2026, now });
    expect(frequent.mode).toBe('frequent');
    expect(statusSyncRequestUrl(frequent)).toContain('start_date');
  });

  it('explicit 2026 date window overrides today±1 (manual canary)', () => {
    const plan = planStatusSyncQuery({
      mode: 'frequent',
      targetSeason: 2026,
      now: new Date('2026-09-11T04:00:00.000Z'),
      startDate: '2026-10-22',
      endDate: '2026-10-22',
    });
    expect(plan.startDate).toBe('2026-10-22');
    expect(plan.endDate).toBe('2026-10-22');
    expect(plan.maxPages).toBe(3);
    const url = statusSyncRequestUrl(plan);
    expect(url).toContain('start_date=2026-10-22');
    expect(url).toContain('end_date=2026-10-22');
    expect(url).toContain('seasons%5B%5D=2026');
    expect(url).not.toContain('start_date=2026-09-10');
  });
});

describe('status transitions and Final-preserve', () => {
  it('Scheduled → In Progress', () => {
    const r = planGameStatusWrite({
      local: local({ gameId: '1', status: 'Scheduled' }),
      incoming: local({ gameId: '1', status: 'In Progress', homeScore: 12, awayScore: 10 }),
      targetSeason: '2026',
    });
    expect(r.action).toBe('update');
    expect(r.becameFinal).toBe(false);
  });

  it('Scheduled → Final', () => {
    const r = planGameStatusWrite({
      local: local({ gameId: '1', status: 'Scheduled' }),
      incoming: local({ gameId: '1', status: 'Final', homeScore: 110, awayScore: 104 }),
      targetSeason: '2026',
    });
    expect(r.action).toBe('update');
    expect(r.becameFinal).toBe(true);
  });

  it('In Progress → Final', () => {
    const r = planGameStatusWrite({
      local: local({ gameId: '1', status: 'In Progress', homeScore: 50, awayScore: 48 }),
      incoming: local({ gameId: '1', status: 'Final', homeScore: 110, awayScore: 104 }),
      targetSeason: '2026',
    });
    expect(r.becameFinal).toBe(true);
  });

  it('Final → Final may update official scores', () => {
    const r = planGameStatusWrite({
      local: local({ gameId: '1', status: 'Final', homeScore: 110, awayScore: 103 }),
      incoming: local({ gameId: '1', status: 'Final', homeScore: 110, awayScore: 104 }),
      targetSeason: '2026',
    });
    expect(r.action).toBe('update');
    expect(r.becameFinal).toBe(false);
  });

  it('Final → Scheduled payload remains Final', () => {
    const r = planGameStatusWrite({
      local: local({ gameId: '1', status: 'Final', homeScore: 110, awayScore: 104 }),
      incoming: local({ gameId: '1', status: 'Scheduled', homeScore: 0, awayScore: 0 }),
      targetSeason: '2026',
    });
    expect(r.action).toBe('final_preserved');
    expect(r.newStatus).toBe('Final');
    expect(r.becameFinal).toBe(false);
  });

  it('Final → In Progress payload remains Final', () => {
    const r = planGameStatusWrite({
      local: local({ gameId: '1', status: 'Final', homeScore: 110, awayScore: 104 }),
      incoming: local({ gameId: '1', status: 'In Progress', homeScore: 90, awayScore: 88 }),
      targetSeason: '2026',
    });
    expect(r.action).toBe('final_preserved');
  });

  it('same payload twice is unchanged', () => {
    const row = local({ gameId: '1', status: 'In Progress', homeScore: 20, awayScore: 18 });
    const first = planGameStatusWrite({ local: row, incoming: row, targetSeason: '2026' });
    expect(first.action).toBe('unchanged');
  });
});

describe('season safety and inserts', () => {
  it('rejects 2025/2023/2024 mutations', () => {
    for (const season of ['2023', '2024', '2025']) {
      const r = planGameStatusWrite({
        local: local({ gameId: 'h', season, status: 'Final' }),
        incoming: local({ gameId: 'h', season, status: 'Scheduled' }),
        targetSeason: '2026',
      });
      expect(r.action).toBe('reject');
    }
  });

  it('inserts a previously unseen 2026 provider game', () => {
    const r = planGameStatusWrite({
      local: null,
      incoming: local({ gameId: '18449999', status: 'Scheduled' }),
      targetSeason: '2026',
    });
    expect(r.action).toBe('insert');
  });

  it('rejects team identity mismatch', () => {
    const r = planGameStatusWrite({
      local: local({ gameId: '1', homeTeamId: '13', awayTeamId: '14' }),
      incoming: local({ gameId: '1', homeTeamId: '1', awayTeamId: '2' }),
      targetSeason: '2026',
    });
    expect(r.action).toBe('reject');
    expect(r.reason).toMatch(/team identity/);
  });
});

describe('runGameStatusSync', () => {
  it('frozen handler path does not call BDL or write', async () => {
    const fetchPage = vi.fn(async () => {
      throw new Error('BDL must not be called while frozen');
    });
    const store = createMemoryGameStore([local({ gameId: '1' })]);
    const upsert = vi.spyOn(store, 'upsert');
    const result = await runGameStatusSync({
      env: freezeEnv,
      now,
      dryRun: false,
      store,
      fetchPage,
    });
    expect(shouldSkipGameStatusSync(freezeEnv)).toBe(true);
    expect(result.status).toBe('skipped');
    expect(result.bdlHttp).toBe(0);
    expect(result.wroteDb).toBe(false);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(result.productPin).toBe(PINNED_ANALYTICS_SEASON);
    expect(PINNED_ANALYTICS_SEASON).toBe('2025');
  });

  it('manual canary writes through freeze using the explicit date window', async () => {
    const fetchPage = vi.fn(async (url: string) => {
      expect(url).toContain('start_date=2026-10-22');
      expect(url).toContain('end_date=2026-10-22');
      return createFixtureFetchPage([
        provider({ id: 21717860, status: 'Scheduled', home_team_score: 0, visitor_team_score: 0 }),
      ])(url);
    });
    const store = createMemoryGameStore([
      local({
        gameId: '21717860',
        status: '2026-10-22T23:00:00Z',
        startTime: '2026-10-22T23:00:00.000Z',
      }),
    ]);
    const result = await runGameStatusSync({
      env: freezeEnv,
      now,
      manualCanary: true,
      dryRun: false,
      startDate: '2026-10-22',
      endDate: '2026-10-22',
      store,
      fetchPage,
    });
    expect(result.status).toBe('success');
    expect(result.bdlHttp).toBe(1);
    expect(result.wroteDb).toBe(true);
    expect(result.updated + result.unchanged).toBeGreaterThanOrEqual(1);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(store.rows.get('21717860')?.status).toBe('Scheduled');
  });

  it('emits became_final without SQS and is idempotent on replay', async () => {
    const game = provider({ id: 18450001, status: 'Final', home_team_score: 110, visitor_team_score: 104 });
    const store = createMemoryGameStore([
      local({ gameId: '18450001', status: 'In Progress', homeScore: 90, awayScore: 88 }),
    ]);
    const events: string[] = [];
    const first = await runGameStatusSync({
      env: liveEnv,
      now,
      dryRun: true,
      store,
      fetchPage: createFixtureFetchPage([game]),
      emit: (e) => events.push(e.event),
    });
    expect(first.becameFinal).toBe(1);
    expect(first.transitions[0]).toMatchObject({ game_id: '18450001', became_final: true });
    expect(events).toContain('game_became_final');
    expect(first.wroteDb).toBe(false);
    expect(first.queryMode).toBe('frequent');

    store.upsert(local({ gameId: '18450001', status: 'Final', homeScore: 110, awayScore: 104 }));
    const second = await runGameStatusSync({
      env: liveEnv,
      now,
      dryRun: true,
      store,
      fetchPage: createFixtureFetchPage([game]),
    });
    expect(second.unchanged).toBe(1);
    expect(second.becameFinal).toBe(0);
    expect(second.inserted).toBe(0);
  });

  it('preserves existing venue when the provider row has none', () => {
    const planned = planGameStatusWrite({
      local: local({ gameId: 'v1', status: 'Scheduled', venue: 'TD Garden' }),
      incoming: local({ gameId: 'v1', status: 'In Progress', venue: null }),
      targetSeason: '2026',
    });
    expect(planned.action).toBe('update');
    expect(planned.row?.venue).toBe('TD Garden');
  });

  it('maps provider errors without retry loops', () => {
    expect(classifyStatusSyncProviderError({ status: 401 }).retry).toBe(false);
    expect(classifyStatusSyncProviderError({ status: 403 }).kind).toBe('403');
    expect(classifyStatusSyncProviderError({ status: 429 }).kind).toBe('429');
    expect(classifyStatusSyncProviderError({ status: 503 }).kind).toBe('5xx');
    expect(classifyStatusSyncProviderError({ timeout: true }).kind).toBe('timeout');
  });

  it('401 fetch fails closed after one request', async () => {
    let calls = 0;
    const result = await runGameStatusSync({
      env: liveEnv,
      now,
      dryRun: true,
      store: createMemoryGameStore(),
      fetchPage: async () => {
        calls += 1;
        return { status: 401, ok: false };
      },
    });
    expect(calls).toBe(1);
    expect(result.status).toBe('failed');
    expect(result.providerStatus).toBe(401);
    expect(result.wroteDb).toBe(false);
  });
});
