import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OddsPageCapError } from '../canary-limits';
import { acquireOdds, OddsPersistError, type AcquireDeps, type OddsPageResult, type OddsProviderRow } from '../acquire';
import { fetchBdlLive, resetDefaultMemoryLiveRateLimitStore } from '../bdl-live-rate-limit';
import {
  DAILY_ODDS_REQUEST_CEILING,
  NORMAL_MAX_PAGES_PER_DATE,
  SCHEDULED_INVOCATION_MAX_PAGES,
  assertNormalLiveLimiter,
  assessOddsGames,
  parseOddsNumber,
  providerThrowToPage,
  scheduledDates,
  seasonContainingEtDate,
  selectNormalDates,
  shouldReplaceCurrent,
  type StoredOddsGame,
} from '../normal-path';

const root = path.resolve(__dirname, '../../..');
const noonEt = new Date('2026-10-20T16:00:00.000Z');
const openingGames: StoredOddsGame[] = [
  { gameId: '21717855', season: '2026', seasonPhase: 'REGULAR', startTime: '2026-10-20T19:00:00.000Z' },
  { gameId: '21717856', season: '2026', seasonPhase: 'REGULAR', startTime: '2026-10-20T23:00:00.000Z' },
  { gameId: '21717857', season: '2026', seasonPhase: 'REGULAR', startTime: '2026-10-21T01:30:00.000Z' },
];

const limiter = {
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
  BDL_RATE_LIMIT_INTERVAL_MS: '13000',
  BDL_RATE_LIMIT_MAX_REQUESTS: '1',
  BDL_RATE_LIMIT_BURST: '1',
  BDL_RATE_LIMIT_MAX_RETRIES: '0',
};

function row(gameId: number, vendor = 'draftkings', updatedAt: string | null = '2026-10-20T15:00:00.000Z', total: string | null = '222.5'): OddsProviderRow {
  return {
    id: gameId,
    game_id: gameId,
    vendor,
    total_value: total,
    updated_at: updatedAt,
    spread_home_value: '-1.5',
    moneyline_home_odds: -112,
  };
}

function page(rows: OddsProviderRow[], nextCursor: number | null): OddsPageResult {
  return { ok: true, rows, nextCursor };
}

function harness(input: {
  pages: Record<string, OddsPageResult[]>;
  games?: StoredOddsGame[];
  env?: Record<string, string | undefined>;
  now?: Date;
  failRaw?: boolean;
  failStep?: 'HISTORY_PERSISTENCE' | 'CURRENT_PERSISTENCE' | 'MOVEMENT_PERSISTENCE';
  maxPagesPerInvocation?: number;
  presetCurrent?: Map<string, { snapshotAt: string; vendor: string; total: number | null }>;
}) {
  const calls: { date: string; cursor: number | null }[] = [];
  const queues = new Map(Object.entries(input.pages).map(([date, pages]) => [date, [...pages]]));
  const raw: { pullRunId: number; row: OddsProviderRow }[] = [];
  const history: { gameId: string; vendor: string; snapshotAt: string; total: number | null }[] = [];
  const current = input.presetCurrent ?? new Map<string, { snapshotAt: string; vendor: string; total: number | null }>();
  const transformed: number[] = [];
  let nextPull = 1;

  const deps: AcquireDeps = {
    env: input.env ?? limiter,
    now: () => input.now ?? noonEt,
    preferredVendor: 'draftkings',
    maxPagesPerInvocation: input.maxPagesPerInvocation,
    async fetchPage(date, cursor) {
      calls.push({ date, cursor });
      const next = queues.get(date)?.shift();
      if (!next) throw new Error(`unexpected provider call ${date}`);
      return next;
    },
    async createPullRun() {
      const id = nextPull;
      nextPull += 1;
      return id;
    },
    async completePullRun() {},
    async insertRaw(pullRunId, providerRow) {
      if (input.failRaw) throw new Error('raw insert failed');
      raw.push({ pullRunId, row: providerRow });
    },
    async loadGames() {
      return input.games ?? openingGames;
    },
    async transformComplete(pullRunId) {
      if (input.failStep) throw new OddsPersistError('analytics write failed', input.failStep);
      transformed.push(pullRunId);
      for (const stored of raw.filter((item) => item.pullRunId === pullRunId)) {
        if (stored.row.updated_at == null) continue;
        const total = parseOddsNumber(stored.row.total_value);
        const snapshotAt = stored.row.updated_at;
        if (!history.some((item) => item.gameId === String(stored.row.game_id) && item.vendor === stored.row.vendor && item.snapshotAt === snapshotAt)) {
          history.push({ gameId: String(stored.row.game_id), vendor: stored.row.vendor, snapshotAt, total });
        }
        if (stored.row.vendor !== 'draftkings') continue;
        const existing = current.get(String(stored.row.game_id)) ?? null;
        if (shouldReplaceCurrent(existing?.snapshotAt ?? null, snapshotAt)) {
          current.set(String(stored.row.game_id), { snapshotAt, vendor: 'draftkings', total });
        }
      }
      return { current: current.size, history: history.length, movement: transformed.length };
    },
  };

  return { deps, calls, raw, history, current, transformed };
}

describe('scheduled odds dates', () => {
  it('treats an empty event as today and tomorrow in Eastern time', () => {
    expect(selectNormalDates({}, noonEt)).toEqual({ ok: true, dates: ['2026-10-20', '2026-10-21'] });
    expect(selectNormalDates({ dates: [] }, noonEt)).toEqual({ ok: true, dates: ['2026-10-20', '2026-10-21'] });
  });

  it('accepts an explicit date inside the Eastern pair', () => {
    expect(selectNormalDates({ date: '2026-10-21' }, noonEt)).toEqual({ ok: true, dates: ['2026-10-21'] });
  });

  it('crosses UTC midnight on the Eastern calendar', () => {
    expect(scheduledDates(new Date('2026-10-20T03:59:59.000Z'))).toEqual(['2026-10-19', '2026-10-20']);
    expect(scheduledDates(new Date('2026-10-20T04:00:00.000Z'))).toEqual(['2026-10-20', '2026-10-21']);
  });

  it('keeps the late Oklahoma City tip on October 20 Eastern', () => {
    expect(seasonContainingEtDate('2026-10-20')).toBe('2026');
    expect(assessOddsGames({
      queriedDate: '2026-10-20',
      rows: [row(21717857)],
      games: openingGames,
    })).toEqual({ ok: true });
    expect(assessOddsGames({
      queriedDate: '2026-10-21',
      rows: [row(21717857)],
      games: openingGames,
    }).ok).toBe(false);
  });

  it('rejects preseason, the wrong season, and a date outside today and tomorrow', () => {
    expect(assessOddsGames({
      queriedDate: '2026-10-20',
      rows: [row(21717855)],
      games: [{ ...openingGames[0], seasonPhase: 'PRESEASON' }],
    }).ok).toBe(false);
    expect(assessOddsGames({
      queriedDate: '2026-10-20',
      rows: [row(21717855)],
      games: [{ ...openingGames[0], season: '2025' }],
    }).ok).toBe(false);
    expect(selectNormalDates({ dates: ['2026-05-12'] }, noonEt).ok).toBe(false);
    expect(selectNormalDates({ dates: ['2026-10-20', '2026-10-20'] }, noonEt).ok).toBe(false);
  });
});

describe('normal acquisition bounds', () => {
  it('uses three pages per date and six across the scheduled pair', () => {
    expect(NORMAL_MAX_PAGES_PER_DATE).toBe(3);
    expect(SCHEDULED_INVOCATION_MAX_PAGES).toBe(6);
    expect(DAILY_ODDS_REQUEST_CEILING).toBe(60);
  });

  it('completes a two-page date and stops before a fourth page', async () => {
    const game = row(21717855);
    const { deps, calls, transformed } = harness({
      pages: {
        '2026-10-21': [page([game], 1), page([game], 2), page([game], 3), page([game], null)],
      },
      now: noonEt,
    });
    const result = await acquireOdds({ date: '2026-10-21' }, deps);
    expect(calls).toHaveLength(3);
    expect(result.success).toBe(false);
    expect(result.results[0]?.classification).toBe('INCOMPLETE');
    expect(transformed).toEqual([]);
  });

  it('stays complete when a finished page skips tipped games', async () => {
    const { deps, raw } = harness({
      pages: { '2026-10-21': [page([row(21717922), row(21717923)], null)] },
      games: [
        { gameId: '21717922', season: '2026', seasonPhase: 'REGULAR', startTime: '2026-10-21T23:00:00.000Z' },
        { gameId: '21717923', season: '2026', seasonPhase: 'REGULAR', startTime: '2026-10-21T23:30:00.000Z' },
      ],
    });
    deps.transformComplete = async () => ({
      current: 1,
      history: 1,
      movement: 1,
      acquiredRows: 2,
      pregameEligibleRows: 1,
      postTipRowsSkipped: 1,
      currentRowsUpdated: 1,
      historyRowsInserted: 1,
      movementRowsInserted: 1,
    });
    const result = await acquireOdds({ date: '2026-10-21' }, deps);
    expect(result.success).toBe(true);
    expect(result.results[0]?.classification).toBe('COMPLETE');
    expect(raw).toHaveLength(2);
  });

  it('does not replace current odds when the cursor is still open at the cap', async () => {
    const { deps, current, transformed } = harness({
      pages: { '2026-10-21': [page([row(21717856)], 9), page([row(21717856)], 10), page([row(21717856)], 11)] },
      presetCurrent: new Map([['21717856', { snapshotAt: '2026-10-19T19:39:01.000Z', vendor: 'draftkings', total: 232.5 }]]),
    });
    const result = await acquireOdds({ date: '2026-10-21' }, deps);
    expect(result.results[0]?.classification).toBe('INCOMPLETE');
    expect(transformed).toEqual([]);
    expect(current.get('21717856')?.snapshotAt).toBe('2026-10-19T19:39:01.000Z');
  });

  it('leaves the second date incomplete when the invocation budget is only three', async () => {
    const today = [page([row(21717855, 'fanduel')], 1), page([row(21717855)], null)];
    const tomorrow = [page([row(21717922)], 1), page([row(21717922)], null)];
    const { deps, calls, transformed } = harness({
      pages: { '2026-10-20': today, '2026-10-21': tomorrow },
      games: [
        ...openingGames,
        { gameId: '21717922', season: '2026', seasonPhase: 'REGULAR', startTime: '2026-10-21T23:00:00.000Z' },
      ],
      maxPagesPerInvocation: 3,
    });
    const result = await acquireOdds({}, deps);
    expect(calls.map((call) => call.date)).toEqual(['2026-10-20', '2026-10-20', '2026-10-21']);
    expect(result.status).toBe('PARTIAL');
    expect(result.success).toBe(false);
    expect(result.results.map((item) => item.classification)).toEqual(['COMPLETE', 'INCOMPLETE']);
    expect(transformed).toEqual([1]);
  });

  it('completes both dates inside the six-page invocation ceiling', async () => {
    const { deps, calls } = harness({
      pages: {
        '2026-10-20': [page([row(21717855, 'fanduel')], 1), page([row(21717855)], null)],
        '2026-10-21': [page([row(21717922, 'fanduel')], 4), page([row(21717922)], null)],
      },
      games: [
        ...openingGames,
        { gameId: '21717922', season: '2026', seasonPhase: 'REGULAR', startTime: '2026-10-21T23:00:00.000Z' },
      ],
    });
    const result = await acquireOdds({}, deps);
    expect(calls).toHaveLength(4);
    expect(result.success).toBe(true);
    expect(result.status).toBe('COMPLETE');
  });

  it('keeps the successful date when the other date fails', async () => {
    const { deps, calls, current } = harness({
      pages: {
        '2026-10-20': [page([row(21717855)], null)],
        '2026-10-21': [{ ok: false, status: 401 }],
      },
    });
    const result = await acquireOdds({}, deps);
    expect(result.success).toBe(false);
    expect(result.status).toBe('PARTIAL');
    expect(result.results.map((item) => item.classification)).toEqual(['COMPLETE', 'UNAUTHORIZED']);
    expect(calls.filter((call) => call.date === '2026-10-21')).toHaveLength(1);
    expect(current.get('21717855')?.vendor).toBe('draftkings');
  });
});

describe('provider failures do not retry inside the acquisition', () => {
  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [429, 'RATE_LIMITED'],
  ] as const)('fails HTTP %s once', async (status, classification) => {
    const { deps, calls, transformed } = harness({
      pages: { '2026-10-21': [{ ok: false, status }] },
    });
    const result = await acquireOdds({ date: '2026-10-21' }, deps);
    expect(calls).toHaveLength(1);
    expect(result.results[0]?.classification).toBe(classification);
    expect(result.success).toBe(false);
    expect(transformed).toEqual([]);
  });

  it('fails a provider timeout once', async () => {
    const { deps, transformed } = harness({ pages: { '2026-10-21': [] } });
    deps.fetchPage = async () => {
      throw Object.assign(new Error('odds provider timeout'), { timeout: true });
    };
    const result = await acquireOdds({ date: '2026-10-21' }, deps);
    expect(result.results[0]?.classification).toBe('TIMEOUT');
    expect(result.providerRequests).toBe(1);
    expect(transformed).toEqual([]);
  });

  it('refuses an unsafe limiter before any provider call', async () => {
    const { deps, calls } = harness({
      pages: { '2026-10-20': [page([row(21717855)], null)], '2026-10-21': [page([row(21717922)], null)] },
      env: { ...limiter, BDL_RATE_LIMIT_INTERVAL_MS: '500', BDL_RATE_LIMIT_BURST: '5' },
    });
    const result = await acquireOdds({}, deps);
    expect(result.status).toBe('LIMITER_REFUSED');
    expect(result.providerRequests).toBe(0);
    expect(calls).toEqual([]);
  });

  it('refuses a missing retry setting before any provider call', () => {
    expect(() => assertNormalLiveLimiter({ ...limiter, BDL_RATE_LIMIT_MAX_RETRIES: undefined })).toThrow(/MAX_RETRIES/);
  });

  it('does not retry a 429 inside the shared client when retries are zero', async () => {
    resetDefaultMemoryLiveRateLimitStore();
    let calls = 0;
    let requested = '';
    await expect(fetchBdlLive('https://example.test/odds', { headers: { Authorization: 'test' } }, {
      env: { ...limiter, BDL_RATE_LIMIT_BACKEND: 'memory' },
      fetchImpl: async (url) => {
        calls += 1;
        requested = String(url);
        return new Response('no', { status: 429, headers: { 'retry-after': '1' } });
      },
      sleepFn: async () => {},
    })).rejects.toThrow(/429/);
    expect(calls).toBe(1);
    expect(requested).not.toContain('balldontlie');
    expect(providerThrowToPage(Object.assign(new Error('BDL 429 after 1 attempts'), { code: 'timeout' }))).toEqual({ ok: false, status: 429 });
  });

  it('classifies a complete empty provider response without inventing markets', async () => {
    const { deps, current, transformed } = harness({
      pages: { '2026-10-21': [page([], null)] },
      presetCurrent: new Map([['21717856', { snapshotAt: '2026-10-19T19:39:01.000Z', vendor: 'draftkings', total: 232.5 }]]),
    });
    const result = await acquireOdds({ date: '2026-10-21' }, deps);
    expect(result.status).toBe('PROVIDER_EMPTY');
    expect(result.success).toBe(true);
    expect(transformed).toEqual([]);
    expect(current.get('21717856')?.total).toBe(232.5);
  });
});

describe('snapshot preservation', () => {
  it('fails a raw insert without publishing current odds', async () => {
    const { deps, transformed, current } = harness({
      pages: { '2026-10-21': [page([row(21717856)], null)] },
      failRaw: true,
      presetCurrent: new Map([['21717856', { snapshotAt: '2026-10-19T19:39:01.000Z', vendor: 'draftkings', total: 232.5 }]]),
    });
    const result = await acquireOdds({ date: '2026-10-21' }, deps);
    expect(result.results[0]?.classification).toBe('RAW_PERSISTENCE');
    expect(transformed).toEqual([]);
    expect(current.get('21717856')?.snapshotAt).toBe('2026-10-19T19:39:01.000Z');
  });

  it('does not publish an ineligible or duplicate game', async () => {
    const preseason = harness({
      pages: { '2026-10-21': [page([row(21717855)], null)] },
      games: [{ ...openingGames[0], seasonPhase: 'PRESEASON', startTime: '2026-10-21T23:00:00.000Z' }],
    });
    const rejected = await acquireOdds({ date: '2026-10-21' }, preseason.deps);
    expect(rejected.results[0]?.classification).toBe('IDENTITY');
    expect(preseason.transformed).toEqual([]);

    const duplicate = harness({
      pages: { '2026-10-21': [page([row(21717856), row(21717856)], null)] },
    });
    const again = await acquireOdds({ date: '2026-10-21' }, duplicate.deps);
    expect(again.results[0]?.classification).toBe('IDENTITY');
    expect(duplicate.transformed).toEqual([]);
  });

  it('keeps an older observation off the current row and ignores a duplicate history key', async () => {
    expect(shouldReplaceCurrent('2026-10-20T18:00:00.000Z', '2026-10-20T15:00:00.000Z')).toBe(false);
    expect(shouldReplaceCurrent('2026-10-20T15:00:00.000Z', '2026-10-20T15:00:00.000Z')).toBe(false);
    expect(shouldReplaceCurrent(null, '2026-10-20T15:00:00.000Z')).toBe(true);
    const { deps, current, history } = harness({
      pages: {
        '2026-10-21': [
          page([row(21717922, 'draftkings', '2026-10-20T15:00:00.000Z')], null),
          page([row(21717922, 'draftkings', '2026-10-20T15:00:00.000Z')], null),
        ],
      },
      games: [{ gameId: '21717922', season: '2026', seasonPhase: 'REGULAR', startTime: '2026-10-21T23:00:00.000Z' }],
      presetCurrent: new Map([['21717922', { snapshotAt: '2026-10-20T18:00:00.000Z', vendor: 'draftkings', total: 232.5 }]]),
    });
    await acquireOdds({ date: '2026-10-21' }, deps);
    expect(current.get('21717922')).toEqual({ snapshotAt: '2026-10-20T18:00:00.000Z', vendor: 'draftkings', total: 232.5 });
    await acquireOdds({ date: '2026-10-21' }, deps);
    expect(history.filter((item) => item.gameId === '21717922')).toHaveLength(1);
  });

  it('keeps DraftKings current odds and still stores another book, including a missing total', async () => {
    expect(parseOddsNumber(null)).toBeNull();
    expect(parseOddsNumber('')).toBeNull();
    const { deps, current, history } = harness({
      pages: {
        '2026-10-21': [page([
          row(21717922, 'draftkings', '2026-10-20T18:30:00.000Z', '232.5'),
          row(21717922, 'betparx', '2026-10-20T18:30:00.000Z', null),
          row(21717922, 'fanduel', '2026-10-20T18:30:00.000Z', '233'),
        ], null)],
      },
      games: [{ gameId: '21717922', season: '2026', seasonPhase: 'REGULAR', startTime: '2026-10-21T23:00:00.000Z' }],
      presetCurrent: new Map([['21717922', { snapshotAt: '2026-10-19T19:39:01.000Z', vendor: 'draftkings', total: 232.5 }]]),
    });
    const result = await acquireOdds({ date: '2026-10-21' }, deps);
    expect(result.success).toBe(true);
    expect(current.get('21717922')).toEqual({ snapshotAt: '2026-10-20T18:30:00.000Z', vendor: 'draftkings', total: 232.5 });
    expect(history.find((item) => item.vendor === 'betparx')?.total).toBeNull();
    expect(history.map((item) => item.vendor).sort()).toEqual(['betparx', 'draftkings', 'fanduel']);
  });

  it('does not let a history failure replace current odds', async () => {
    const { deps, current, transformed } = harness({
      pages: { '2026-10-21': [page([row(21717922, 'draftkings', '2026-10-20T18:30:00.000Z')], null)] },
      games: [{ gameId: '21717922', season: '2026', seasonPhase: 'REGULAR', startTime: '2026-10-21T23:00:00.000Z' }],
      failStep: 'HISTORY_PERSISTENCE',
      presetCurrent: new Map([['21717922', { snapshotAt: '2026-10-19T19:39:01.000Z', vendor: 'draftkings', total: 232.5 }]]),
    });
    const result = await acquireOdds({ date: '2026-10-21' }, deps);
    expect(result.results[0]?.classification).toBe('HISTORY_PERSISTENCE');
    expect(transformed).toEqual([]);
    expect(current.get('21717922')?.snapshotAt).toBe('2026-10-19T19:39:01.000Z');
  });
});

describe('opening-night canary remains separate', () => {
  it('still caps the single October 20 event and rejects a foreign game before any pull run', async () => {
    const capped = harness({
      pages: {
        '2026-10-20': [page([row(21717855)], 1), page([row(21717855)], 2), page([row(21717855)], 3)],
      },
    });
    await expect(acquireOdds({ dates: ['2026-10-20'] }, capped.deps)).rejects.toBeInstanceOf(OddsPageCapError);
    expect(capped.calls).toHaveLength(3);
    expect(capped.transformed).toEqual([]);
    expect(capped.raw).toEqual([]);

    const foreign = harness({
      pages: { '2026-10-20': [page([row(21717922)], null)] },
    });
    await expect(acquireOdds({ dates: ['2026-10-20'] }, foreign.deps)).rejects.toThrow(/21717922/);
    expect(foreign.raw).toEqual([]);
  });

  it('does not apply the canary allowlist to a normal explicit date', async () => {
    const { deps } = harness({
      pages: { '2026-10-21': [page([row(21717922)], null)] },
      games: [{ gameId: '21717922', season: '2026', seasonPhase: 'REGULAR', startTime: '2026-10-21T23:00:00.000Z' }],
    });
    const result = await acquireOdds({ date: '2026-10-21' }, deps);
    expect(result.success).toBe(true);
    expect(result.results[0]?.classification).toBe('COMPLETE');
  });
});

describe('packaged handler source', () => {
  const src = fs.readFileSync(path.join(root, 'lambda/odds-pre-game-snapshot/index.ts'), 'utf8');
  const market = fs.readFileSync(path.join(root, 'lambda/odds-pre-game-snapshot/pregame-market.ts'), 'utf8');

  it('keeps the current-row guard, history conflict, and DraftKings movement open', () => {
    expect(src).toContain('promotePullOdds');
    expect(src).not.toContain('INSERT INTO analytics.game_odds_current');
    expect(src).not.toContain('INSERT INTO analytics.game_odds_history');
    expect(src).not.toContain('INSERT INTO analytics.game_line_movement_summary');
    expect(market).toContain('analytics.game_odds_current.snapshot_at < excluded.snapshot_at');
    expect(market).toContain('ON CONFLICT (game_id, vendor, snapshot_at) DO NOTHING');
    expect(market).toContain('AND vendor = $2');
    expect(market).toContain('clock_timestamp()');
    expect(market).toContain('start_time > clock_timestamp()');
    expect(market).toContain('open_total = COALESCE(analytics.game_line_movement_summary.open_total, excluded.open_total)');
    expect(market).not.toMatch(/open_total = excluded\.open_total/);
    expect(src).toContain('providerThrowToPage');
    expect(src).toContain('acquireOdds');
    expect(src).not.toContain('success: true, ...summary');
  });

  it('does not hardcode the opening-night slate into the season-long date selector', () => {
    const normal = fs.readFileSync(path.join(root, 'lambda/odds-pre-game-snapshot/normal-path.ts'), 'utf8');
    const acquire = fs.readFileSync(path.join(root, 'lambda/odds-pre-game-snapshot/acquire.ts'), 'utf8');
    expect(normal).not.toContain('21717855');
    expect(normal).toContain('DAILY_ODDS_REQUEST_CEILING = 60');
    expect(acquire).not.toContain('DAILY_ODDS_REQUEST_CEILING');
    expect(src).not.toContain('DAILY_ODDS_REQUEST_CEILING');
  });
});
