import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  InMemoryAcqArchiveStore,
  readArchivedEnvelope,
  type AcqArchiveStore,
  type AcqPutResult,
} from '@/lib/acquisition';
import { createMemoryAcqLedgerWriter, type AcqLedgerWriter } from '@/lib/acquisition/ledger-pg';
import { createMemoryLiveRateLimitStore } from '@/lib/balldontlie/live-rate-limit';
import {
  createFixtureFetchPage,
  createMemoryGameStore,
  runGameStatusSync,
  type LocalGameRow,
  type ProviderGame,
} from '@/lib/games/status-sync';
import { createAcquiringStatusSyncFetchPage, parseGamesPageBody } from '@/lib/games/status-sync-acquisition';
import { planStatusSyncQuery } from '@/lib/games/status-sync-query';

const API_KEY = 'test-key-not-real-0000';
const NOW = new Date('2026-10-22T03:15:00.000Z');
const LIVE_ENV: Record<string, string> = {
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
  LIVE_INGESTION_ENABLED: 'true',
  STATUS_SYNC_TARGET_SEASON: '2026',
  BDL_RATE_LIMIT_BACKEND: 'memory',
  BDL_RATE_LIMIT_ALLOW_FAST: '1',
  BDL_RATE_LIMIT_INTERVAL_MS: '1',
  BDL_RATE_LIMIT_MAX_REQUESTS: '1000',
  BDL_RATE_LIMIT_BURST: '1000',
  BDL_RATE_LIMIT_MAX_RETRIES: '0',
};

function game(partial: Partial<ProviderGame> & Pick<ProviderGame, 'id'>): ProviderGame {
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

const page = (data: unknown[], nextCursor: number | null = null) =>
  JSON.stringify({ data, meta: { next_cursor: nextCursor, per_page: 100 } });

type Responder = (url: string, init?: RequestInit) => Response | Promise<Response>;

class TrackedStore extends InMemoryAcqArchiveStore {
  constructor(
    private readonly order: string[],
    private readonly failOnPut: number | null = null
  ) {
    super();
  }
  override async putIfAbsent(input: Parameters<AcqArchiveStore['putIfAbsent']>[0]): Promise<AcqPutResult> {
    this.order.push('archive');
    if (this.failOnPut != null && this.putCalls + 1 === this.failOnPut) {
      this.putCalls += 1;
      throw new Error('AccessDenied: simulated S3 failure');
    }
    return super.putIfAbsent(input);
  }
}

class ConflictStore implements AcqArchiveStore {
  async putIfAbsent(): Promise<AcqPutResult> {
    return 'exists';
  }
  async head() {
    return { metadata: { 'body-sha256': 'f'.repeat(64), 'envelope-sha256': 'e'.repeat(64) } };
  }
  async get() {
    return null;
  }
}

function harness(opts: {
  respond: Responder;
  env?: Record<string, string>;
  archive?: AcqArchiveStore;
  failOnPut?: number;
  ledger?: AcqLedgerWriter;
  seed?: LocalGameRow[];
  seasonPhaseStore?: boolean;
  dryRun?: boolean;
}) {
  const order: string[] = [];
  const urls: string[] = [];
  const authHeaders: string[] = [];
  const env = { ...LIVE_ENV, ...(opts.env ?? {}) };
  const archive = opts.archive ?? new TrackedStore(order, opts.failOnPut ?? null);
  const ledger = opts.ledger ?? createMemoryAcqLedgerWriter();
  const store = createMemoryGameStore(opts.seed ?? [], { seasonPhase: opts.seasonPhaseStore });
  const upsert = store.upsert.bind(store);
  store.upsert = (row) => {
    order.push('upsert');
    return upsert(row);
  };
  let req = 0;
  let run = 0;
  const fetchPage = createAcquiringStatusSyncFetchPage({
    env,
    apiKey: API_KEY,
    archiveStore: archive,
    ledger,
    fetchImpl: async (url, init) => {
      urls.push(url);
      authHeaders.push(String((init?.headers as Record<string, string> | undefined)?.Authorization ?? ''));
      return opts.respond(url, init);
    },
    rateLimitStore: createMemoryLiveRateLimitStore(),
    now: () => NOW,
    newRequestId: () => `req-${++req}`,
    logger: { error: () => undefined },
  });
  const runSync = () =>
    runGameStatusSync({
      env,
      now: NOW,
      store,
      fetchPage,
      requireAcquisition: true,
      dryRun: opts.dryRun ?? false,
      newId: () => `run-${++run}`,
    });
  return { order, urls, authHeaders, archive, ledger, store, runSync, fetchPage, env };
}

const memLedger = (l: AcqLedgerWriter) => l as ReturnType<typeof createMemoryAcqLedgerWriter>;
const ok = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });

describe('DATA2E.1 game-status-sync acquisition: archive before serve', () => {
  it('regular/unparameterized response: archived, ledgered parse_ok, then written; phase UNCLASSIFIED', async () => {
    const h = harness({ respond: () => ok(page([game({ id: 501 })]), 200, { 'x-ratelimit-remaining': '59' }) });
    const result = await h.runSync();

    expect(result.status).toBe('success');
    expect(result.inserted).toBe(1);
    expect(result.wroteDb).toBe(true);
    expect(result.bdlHttp).toBe(1);
    expect(result.acquisition).toEqual({ required: true, archivedRequests: 1, blockedReason: null });
    expect(result.seasonPhases.UNCLASSIFIED).toBe(1);
    expect(result.seasonPhases.REGULAR).toBe(0);
    expect(h.store.rows.get('501')?.status).toBe('Scheduled');
    expect(h.order).toEqual(['archive', 'upsert']);
    expect(h.authHeaders[0]).toBe(API_KEY);

    const [ledgerRow] = [...memLedger(h.ledger).rows.values()];
    expect(ledgerRow).toMatchObject({
      request_id: 'req-1',
      pull_run_id: 'run-1',
      provider: 'balldontlie',
      league: 'nba',
      endpoint_family: 'games',
      endpoint_path: '/v1/games',
      scope_kind: 'query',
      season: 2026,
      season_type_requested: null,
      page_index: 0,
      attempt: 1,
      http_status: 200,
      archive_status: 'archived',
      parse_ok: true,
      parse_error: null,
      collector_name: 'game-status-sync',
    });
    expect(ledgerRow.s3_key).toContain('/entity=acq_games/');
    expect(ledgerRow.s3_key).toContain('/scope=query/');

    const archive = h.archive as InMemoryAcqArchiveStore;
    const env = await readArchivedEnvelope(archive, ledgerRow.s3_key!);
    const plan = planStatusSyncQuery({ targetSeason: 2026, now: NOW });
    expect(env.scope).toMatchObject({
      kind: 'query',
      season: 2026,
      season_type_requested: null,
      date_window_et: [plan.startDate, plan.endDate],
    });
    expect(env.request.params).toContainEqual(['seasons[]', '2026']);
    expect(env.request.params.some(([k]) => k === 'season_type')).toBe(false);
    expect(env.response?.headers['x-ratelimit-remaining']).toBe('59');
    expect(env.response?.body).toBe(page([game({ id: 501 })]));
    expect(env.times.request_started_at).toBe(NOW.toISOString());
    expect(env.times.controller_enqueued_at).toBeNull();
  });

  it('never archives or ledgers the API key', async () => {
    const h = harness({ respond: () => ok(page([game({ id: 502 })])) });
    await h.runSync();
    const archive = h.archive as InMemoryAcqArchiveStore;
    for (const obj of archive.objects.values()) {
      expect(gunzipSync(obj.body).toString('utf8')).not.toContain(API_KEY);
      expect(JSON.stringify(obj.metadata)).not.toContain(API_KEY);
    }
    expect(JSON.stringify([...memLedger(h.ledger).rows.values()])).not.toContain(API_KEY);
  });

  it('multi-page: one envelope + request_id per page, shared pull_run_id, all archived before any write', async () => {
    const h = harness({
      respond: (url) =>
        new URL(url).searchParams.get('cursor') === '77'
          ? ok(page([game({ id: 602 })], null))
          : ok(page([game({ id: 601 })], 77)),
    });
    const result = await h.runSync();
    expect(result.status).toBe('success');
    expect(result.inserted).toBe(2);
    expect(result.queries).toEqual([
      { seasonTypeRequested: null, pullRunId: 'run-1', pages: 2, truncated: false, requestIds: ['req-1', 'req-2'] },
    ]);
    const rows = [...memLedger(h.ledger).rows.values()];
    expect(rows.map((r) => [r.request_id, r.pull_run_id, r.page_index, r.archive_status, r.parse_ok])).toEqual([
      ['req-1', 'run-1', 0, 'archived', true],
      ['req-2', 'run-1', 1, 'archived', true],
    ]);
    expect(rows[0].scope_id).toBe(rows[1].scope_id);
    expect(h.order).toEqual(['archive', 'archive', 'upsert', 'upsert']);
    const env2 = await readArchivedEnvelope(h.archive as InMemoryAcqArchiveStore, rows[1].s3_key!);
    expect(env2.request.cursor_in).toBe('77');
  });

  it('keeps the existing page cap (3) and partial status', async () => {
    let n = 0;
    const h = harness({ respond: () => ok(page([game({ id: 700 + ++n })], 1000 + n)) });
    const result = await h.runSync();
    expect(h.urls).toHaveLength(3);
    expect(result.status).toBe('partial');
    expect(result.queries[0].truncated).toBe(true);
    expect(result.inserted).toBe(3);
  });

  it('invalid JSON: archived evidence, parse_ok=false, zero serving writes', async () => {
    const h = harness({ respond: () => ok('{"data": [ not json') });
    const result = await h.runSync();
    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(/failed validation after archive: invalid JSON/);
    expect(result.wroteDb).toBe(false);
    expect(h.order).toEqual(['archive']);
    expect(h.store.rows.size).toBe(0);
    const [r] = [...memLedger(h.ledger).rows.values()];
    expect(r).toMatchObject({ archive_status: 'archived', parse_ok: false });
    expect(r.parse_error).toMatch(/invalid JSON/);
  });

  it('parse/shape failure after successful archive blocks writes', async () => {
    const h = harness({ respond: () => ok('{"data":{"id":1}}') });
    const result = await h.runSync();
    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(/data is not an array/);
    expect(h.store.rows.size).toBe(0);
    expect([...memLedger(h.ledger).rows.values()][0]).toMatchObject({ archive_status: 'archived', parse_ok: false });
  });

  it('provider non-2xx: archived, not parsed, no writes', async () => {
    const h = harness({ respond: () => ok('{"error":"unavailable"}', 503) });
    const result = await h.runSync();
    expect(result.status).toBe('failed');
    expect(result.providerStatus).toBe(503);
    expect(result.providerErrors).toBe(1);
    expect(h.store.rows.size).toBe(0);
    const [r] = [...memLedger(h.ledger).rows.values()];
    expect(r).toMatchObject({ http_status: 503, archive_status: 'archived', parse_ok: null });
  });

  it('provider 429 (BDL_RATE_LIMIT_MAX_RETRIES=0): attempt archived, cycle fails as limiter timeout', async () => {
    const h = harness({ respond: () => ok('{"error":"rate limited"}', 429, { 'retry-after': '13' }) });
    const result = await h.runSync();
    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(/timeout/);
    expect(result.bdlHttp).toBe(1);
    expect(h.store.rows.size).toBe(0);
    expect([...memLedger(h.ledger).rows.values()][0]).toMatchObject({ http_status: 429, archive_status: 'archived' });
  });

  it('transport error: body-less envelope archived, no writes', async () => {
    const h = harness({
      respond: () => {
        throw new TypeError('fetch failed');
      },
    });
    const result = await h.runSync();
    expect(result.status).toBe('failed');
    expect(h.store.rows.size).toBe(0);
    expect([...memLedger(h.ledger).rows.values()][0]).toMatchObject({
      http_status: null,
      transport_error: 'TypeError: fetch failed',
      archive_status: 'archived',
    });
  });

  it('ARCHIVE_FAILED: strict fail-closed, ledger archive_failed, zero serving writes', async () => {
    const h = harness({ respond: () => ok(page([game({ id: 801 })])), failOnPut: 1 });
    const result = await h.runSync();
    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(/acquisition blocked: ARCHIVE_FAILED \(put_failed\)/);
    expect(result.acquisition.blockedReason).toMatch(/ARCHIVE_FAILED/);
    expect(result.wroteDb).toBe(false);
    expect(h.order).toEqual(['archive']);
    expect(h.store.rows.size).toBe(0);
    const [r] = [...memLedger(h.ledger).rows.values()];
    expect(r).toMatchObject({ archive_status: 'archive_failed', parse_ok: null, envelope_sha256: null, archived_at: null });
    expect(r.archive_error).toMatch(/put_failed/);
  });

  it('archive failure on page 2 blocks the writes from page 1 as well', async () => {
    const h = harness({
      respond: (url) =>
        new URL(url).searchParams.get('cursor') ? ok(page([game({ id: 812 })])) : ok(page([game({ id: 811 })], 9)),
      failOnPut: 2,
    });
    const result = await h.runSync();
    expect(result.status).toBe('failed');
    expect(h.store.rows.size).toBe(0);
    expect(h.order).not.toContain('upsert');
  });

  it('IMMUTABILITY_CONFLICT: strict fail-closed and ledgered', async () => {
    const h = harness({ respond: () => ok(page([game({ id: 821 })])), archive: new ConflictStore() });
    const result = await h.runSync();
    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(/IMMUTABILITY_CONFLICT/);
    expect(h.store.rows.size).toBe(0);
    const [r] = [...memLedger(h.ledger).rows.values()];
    expect(r.archive_status).toBe('immutability_conflict');
    expect(r.archive_error).toMatch(/existing body_sha256=f{64}/);
  });

  it('ledger write failure blocks serving even when the archive succeeded', async () => {
    const failing: AcqLedgerWriter = {
      insertRow: async () => {
        throw new Error('connection refused');
      },
      updateArchiveOutcome: async () => undefined,
      recordParseResult: async () => undefined,
    };
    const h = harness({ respond: () => ok(page([game({ id: 831 })])), ledger: failing });
    const result = await h.runSync();
    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(/ledger_write_failed/);
    expect(h.store.rows.size).toBe(0);
  });

  it('pages without archive evidence fail closed when acquisition is required', async () => {
    const store = createMemoryGameStore();
    const result = await runGameStatusSync({
      env: LIVE_ENV,
      now: NOW,
      store,
      dryRun: false,
      requireAcquisition: true,
      fetchPage: createFixtureFetchPage([game({ id: 841 })]),
    });
    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(/acquisition evidence missing/);
    expect(store.rows.size).toBe(0);
  });

  it('limiter refusal before HTTP: no envelope, no archive, no writes', async () => {
    const h = harness({ respond: () => ok(page([])), env: { DATA_MODE: 'replay' } });
    const plan = planStatusSyncQuery({ targetSeason: 2026, now: NOW });
    const res = await h.fetchPage('https://api.balldontlie.io/v1/games?seasons%5B%5D=2026', {
      plan,
      pageIndex: 0,
      cursor: null,
      pullRunId: 'run-x',
    });
    expect(res.ok).toBe(false);
    expect(res.acquisition?.requestIds).toEqual([]);
    expect(h.urls).toHaveLength(0);
    expect(h.order).toEqual([]);
  });

  it('existing final-preserve behavior holds on the archived path', async () => {
    const h = harness({
      respond: () => ok(page([game({ id: 851, status: 'Scheduled' })])),
      seed: [local({ gameId: '851', status: 'Final', homeScore: 100, awayScore: 90 })],
    });
    const result = await h.runSync();
    expect(result.status).toBe('success');
    expect(result.finalPreserved).toBe(1);
    expect(h.store.rows.get('851')).toMatchObject({ status: 'Final', homeScore: 100 });
    expect(h.order).toEqual(['archive']);
  });
});

describe('DATA2E.1 preseason discovery (disabled by default)', () => {
  const regular = game({ id: 901 });
  const pre = game({ id: 902, datetime: '2026-10-05T23:00:00.000Z', date: '2026-10-05' });
  const respond: Responder = (url) =>
    new URL(url).searchParams.get('season_type') === 'preseason' ? ok(page([pre])) : ok(page([regular]));

  it('flag absent: one query, no season_type param', async () => {
    const h = harness({ respond });
    const result = await h.runSync();
    expect(result.preseasonDiscovery).toBe(false);
    expect(h.urls).toHaveLength(1);
    expect(h.urls[0]).not.toContain('season_type');
    expect(result.queries).toHaveLength(1);
    expect(result.inserted).toBe(1);
  });

  it('flag true: extra preseason query with its own pull_run_id; PRESEASON fenced until season_phase exists', async () => {
    const h = harness({ respond, env: { GAME_STATUS_SYNC_PRESEASON_DISCOVERY_ENABLED: 'true' } });
    const result = await h.runSync();
    expect(result.preseasonDiscovery).toBe(true);
    expect(h.urls).toHaveLength(2);
    expect(h.urls[0]).not.toContain('season_type');
    expect(h.urls[1]).toContain('season_type=preseason');
    expect(result.queries.map((q) => [q.seasonTypeRequested, q.pullRunId])).toEqual([
      [null, 'run-1'],
      ['preseason', 'run-2'],
    ]);
    expect(result.seasonPhases.PRESEASON).toBe(1);
    expect(result.preseasonFenced).toBe(1);
    expect(result.inserted).toBe(1);
    expect(h.store.rows.has('901')).toBe(true);
    expect(h.store.rows.has('902')).toBe(false);

    const rows = [...memLedger(h.ledger).rows.values()];
    expect(rows.map((r) => r.season_type_requested)).toEqual([null, 'preseason']);
    expect(rows[0].scope_id).not.toBe(rows[1].scope_id);
    expect(rows.every((r) => r.archive_status === 'archived' && r.parse_ok === true)).toBe(true);
  });

  it('flag true + season_phase-capable store: preseason row written and labeled from the request', async () => {
    const h = harness({
      respond,
      env: { GAME_STATUS_SYNC_PRESEASON_DISCOVERY_ENABLED: '1' },
      seasonPhaseStore: true,
    });
    const result = await h.runSync();
    expect(result.inserted).toBe(2);
    expect(result.preseasonFenced).toBe(0);
    expect(h.store.phases.get('902')).toEqual({ phase: 'PRESEASON', source: 'request_season_type' });
    expect(h.store.phases.has('901')).toBe(false);
    expect(result.seasonPhaseWrites).toBe(1);
  });

  it('preseason query failure fails the whole cycle (no partial writes from the primary query)', async () => {
    const h = harness({
      respond: (url) =>
        new URL(url).searchParams.get('season_type') === 'preseason' ? ok('nope', 500) : ok(page([regular])),
      env: { GAME_STATUS_SYNC_PRESEASON_DISCOVERY_ENABLED: '1' },
    });
    const result = await h.runSync();
    expect(result.status).toBe('failed');
    expect(h.store.rows.size).toBe(0);
  });

  it('provider ist_stage labels IST on the primary query when the store supports it', async () => {
    const h = harness({
      respond: () => ok(page([game({ id: 911, ist_stage: 'group' })])),
      seasonPhaseStore: true,
    });
    const result = await h.runSync();
    expect(result.seasonPhases.IST).toBe(1);
    expect(h.store.phases.get('911')).toEqual({ phase: 'IST', source: 'provider_ist_stage' });
  });
});

describe('parseGamesPageBody', () => {
  const cap = (body: string) => ({
    body_semantics: 'application_response_body_bytes' as const,
    body_encoding: 'utf8' as const,
    body_bytes: Buffer.byteLength(body),
    body_sha256: '0'.repeat(64),
    body,
    http_status: 200,
    headers: {},
    content_encoding_received: null,
  });
  it('accepts the documented shape and rejects malformed variants', () => {
    expect(parseGamesPageBody(cap(page([game({ id: 1 })], 5))).ok).toBe(true);
    expect(parseGamesPageBody(cap('{"data":[]}')).ok).toBe(true);
    expect(parseGamesPageBody(cap('')).ok).toBe(false);
    expect(parseGamesPageBody(cap('[]')).ok).toBe(false);
    expect(parseGamesPageBody(cap('{"data":[1]}')).ok).toBe(false);
    expect(parseGamesPageBody(cap('{"data":[],"meta":{"next_cursor":"abc"}}')).ok).toBe(false);
    expect(parseGamesPageBody(cap('{"data":[],"meta":[]}')).ok).toBe(false);
  });
});
