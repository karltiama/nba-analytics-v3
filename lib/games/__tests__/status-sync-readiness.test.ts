import { describe, expect, it } from 'vitest';
import {
  createFixtureFetchPage,
  createMemoryGameStore,
  runGameStatusSync,
  type GameStatusSyncEvent,
  type ProviderGame,
  type StatusSyncFetchPage,
} from '@/lib/games/status-sync';

const LIVE_ENV = {
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
  LIVE_INGESTION_ENABLED: 'true',
  STATUS_SYNC_TARGET_SEASON: '2026',
};

/** 2026-11-03 11:00 ET: scheduled window 11-02..11-04, operating horizon 11-03..11-04. */
const NOW = new Date('2026-11-03T16:00:00.000Z');

const game = (id: number, date: string, datetime: string, extra: Partial<ProviderGame> = {}): ProviderGame => ({
  id,
  season: 2026,
  status: datetime,
  date,
  datetime,
  home_team_score: 0,
  visitor_team_score: 0,
  home_team: { id: 1 },
  visitor_team: { id: 2 },
  ...extra,
});

async function run(fetchPage: StatusSyncFetchPage, opts: { dryRun?: boolean } = {}) {
  const events: GameStatusSyncEvent[] = [];
  const store = createMemoryGameStore([], { seasonPhase: true });
  const result = await runGameStatusSync({
    env: LIVE_ENV,
    now: NOW,
    dryRun: opts.dryRun ?? false,
    store,
    fetchPage,
    emit: (e) => events.push(e),
  });
  return { result, events, store };
}

describe('status-sync post-write season-phase readiness', () => {
  it('scheduled run reports today+tomorrow readiness with provider-verified coverage, Cup final excluded', async () => {
    const { result, events } = await run(
      createFixtureFetchPage([
        game(1, '2026-11-02', '2026-11-03T00:00:00.000Z'),
        game(2, '2026-11-03', '2026-11-04T00:00:00.000Z'),
        game(3, '2026-11-04', '2026-11-05T00:30:00.000Z', { ist_stage: 'Group' }),
        game(4, '2026-11-04', '2026-11-05T01:00:00.000Z', { ist_stage: 'Championship' }),
      ])
    );
    expect(result.status).toBe('success');
    expect(result.readiness).toMatchObject({
      ready: true,
      coverage: 'provider_verified',
      horizon: { season: '2026', startDate: '2026-11-03', endDate: '2026-11-04' },
      counts: { eligible: 2, unclassified: 0, ineligible: 0, missing: 0 },
    });
    const e = events.find((x) => x.event === 'season_phase_readiness');
    expect(e).toMatchObject({ ready: true, horizon: '2026-11-03..2026-11-04', coverage: 'provider_verified' });
  });

  it('a provider-confirmed no-game horizon is ready', async () => {
    const { result } = await run(createFixtureFetchPage([]));
    expect(result.readiness).toMatchObject({ ready: true, coverage: 'provider_verified', counts: { eligible: 0 } });
  });

  it('a provider game that could not be written is reported missing and not ready', async () => {
    const { result } = await run(
      createFixtureFetchPage([
        game(2, '2026-11-03', '2026-11-04T00:00:00.000Z'),
        game(5, '2026-11-04', '2026-11-05T00:00:00.000Z', { home_team: null }),
      ])
    );
    expect(result.readiness?.ready).toBe(false);
    expect(result.readiness?.missing).toEqual(['5']);
    expect(result.readiness?.reasons).toContain('missing_games:1');
  });

  it('a truncated (page-capped) pull is partial and never ready', async () => {
    let n = 0;
    const capped: StatusSyncFetchPage = async () => ({
      status: 200,
      ok: true,
      json: { data: [game(100 + n++, '2026-11-03', '2026-11-04T00:00:00.000Z')], meta: { next_cursor: 1 } },
    });
    const { result } = await run(capped);
    expect(result.status).toBe('partial');
    expect(result.readiness?.ready).toBe(false);
    expect(result.readiness?.reasons).toContain('provider_evidence_incomplete_or_not_covering_horizon');
  });

  it('dry run and failed runs carry no readiness', async () => {
    const dry = await run(createFixtureFetchPage([game(2, '2026-11-03', '2026-11-04T00:00:00.000Z')]), { dryRun: true });
    expect(dry.result.readiness).toBeUndefined();
    const failed = await run(async () => ({ status: 503, ok: false }));
    expect(failed.result.status).toBe('failed');
    expect(failed.result.readiness).toBeUndefined();
  });

  it('a store without the readiness hook still runs and reports none', async () => {
    const store = createMemoryGameStore([]);
    const result = await runGameStatusSync({
      env: LIVE_ENV,
      now: NOW,
      dryRun: false,
      store,
      fetchPage: createFixtureFetchPage([game(2, '2026-11-03', '2026-11-04T00:00:00.000Z')]),
    });
    expect(result.status).toBe('success');
    expect(result.readiness).toBeUndefined();
  });

  it('a readiness query failure is reported not-ready without failing the sync', async () => {
    const store = createMemoryGameStore([], { seasonPhase: true });
    store.loadReadinessRows = () => {
      throw new Error('db down');
    };
    const result = await runGameStatusSync({
      env: LIVE_ENV,
      now: NOW,
      dryRun: false,
      store,
      fetchPage: createFixtureFetchPage([game(2, '2026-11-03', '2026-11-04T00:00:00.000Z')]),
    });
    expect(result.status).toBe('success');
    expect(result.readiness).toMatchObject({ ready: false, reasons: ['readiness_query_failed'] });
  });
});
