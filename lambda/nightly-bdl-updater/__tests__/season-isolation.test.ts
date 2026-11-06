import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { sql: string; values: unknown[] };

const h = vi.hoisted(() => ({
  urls: [] as string[],
  calls: [] as Call[],
  gamesBySeasonType: {} as Record<string, unknown[]>,
  boxRows: [] as Record<string, unknown>[],
  playsByGame: {} as Record<string, unknown[]>,
}));

vi.mock('pg', () => {
  const query = async (sql: string, values: unknown[] = []) => {
    h.calls.push({ sql, values });
    if (sql.includes('yesterday_et')) {
      return { rows: [{ yesterday_et: '2026-10-19', today_et: '2026-10-20', schedule_end_et: '2026-11-03' }] };
    }
    if (sql.includes('three_pointers_made as fg3m')) return { rows: h.boxRows, rowCount: h.boxRows.length };
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
    const u = new URL(url);
    const body = u.pathname.endsWith('/games')
      ? { data: h.gamesBySeasonType[u.searchParams.get('season_type') ?? '<none>'] ?? [], meta: { next_cursor: null } }
      : u.pathname.endsWith('/plays')
        ? { data: h.playsByGame[u.searchParams.get('game_id') ?? ''] ?? [], meta: { next_cursor: null } }
        : { data: [], meta: { next_cursor: null } };
    return new Response(JSON.stringify(body), { status: 200 });
  },
}));

const ENV = {
  SUPABASE_DB_URL: 'postgresql://test:test@localhost:5432/test',
  BALLDONTLIE_API_KEY: 'test-key-not-real',
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
  INGESTION_SEASON_START_YEAR: '2026',
  DISABLE_BDL_SCHEDULE_SYNC: '1',
};

const game = (id: number, date: string, status = 'Final') => ({
  id,
  season: 2026,
  date,
  datetime: `${date}T23:30:00.000Z`,
  status,
  postseason: false,
  home_team: { id: 1, abbreviation: 'AAA' },
  visitor_team: { id: 2, abbreviation: 'BBB' },
  home_team_score: 100,
  visitor_team_score: 99,
});

const saved: Record<string, string | undefined> = {};

async function runHandler() {
  vi.resetModules();
  const mod = await import('../index');
  return mod.handler();
}

describe('nightly BDL updater preseason isolation', () => {
  beforeEach(() => {
    h.urls.length = 0;
    h.calls.length = 0;
    h.gamesBySeasonType = {};
    h.boxRows = [];
    h.playsByGame = {};
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.restoreAllMocks();
  });

  it('requests /v1/games with explicit season_type=regular only (no preseason, no unparameterized query)', async () => {
    await runHandler();
    const gameUrls = h.urls.filter((u) => new URL(u).pathname.endsWith('/games'));
    expect(gameUrls.length).toBeGreaterThan(0);
    for (const u of gameUrls) {
      expect(new URL(u).searchParams.get('season_type')).toBe('regular');
    }
  });

  it('a Final row dated before opening night never reaches raw.games or /stats', async () => {
    h.gamesBySeasonType.regular = [game(100, '2026-10-19')];
    const res = await runHandler();
    const body = JSON.parse(res.body);
    expect(body.gamesFound).toBe(1);
    expect(body.gamesFenced).toBe(1);
    expect(body.finalGames).toBe(0);
    expect(h.urls.some((u) => new URL(u).pathname.endsWith('/stats'))).toBe(false);
    expect(h.calls.some((c) => c.sql.includes('insert into raw.games'))).toBe(false);
  });

  it('only eligible game ids reach the box-score request and the raw.games upsert', async () => {
    h.gamesBySeasonType.regular = [game(100, '2026-10-19'), game(200, '2026-10-20')];
    await runHandler();
    const statsUrls = h.urls.filter((u) => new URL(u).pathname.endsWith('/stats'));
    expect(statsUrls).toHaveLength(1);
    expect(new URL(statsUrls[0]).searchParams.getAll('game_ids[]')).toEqual(['200']);
    const rawGameIds = h.calls.filter((c) => c.sql.includes('insert into raw.games')).map((c) => c.values[0]);
    expect(rawGameIds).toEqual([200]);
  });

  it('writes player period scoring for eligible Final games, checked against the box score', async () => {
    h.gamesBySeasonType.regular = [game(100, '2026-10-19'), game(200, '2026-10-20')];
    h.boxRows = [
      { game_id: '200', player_id: '7', team_id: '1', points: 5, fgm: 2, fg3m: 1, ftm: 0 },
    ];
    h.playsByGame['200'] = [
      { period: 1, type: 'Jump Shot', shooting_play: true, scoring_play: true, score_value: 3, participants: [7] },
      { period: 2, type: 'Layup Shot', shooting_play: true, scoring_play: true, score_value: 2, participants: [7] },
    ];
    const res = await runHandler();
    const playsUrls = h.urls.filter((u) => new URL(u).pathname.endsWith('/plays'));
    expect(playsUrls.map((u) => new URL(u).searchParams.get('game_id'))).toEqual(['200']);
    const insert = h.calls.find((c) => c.sql.includes('insert into analytics.player_period_scoring'));
    expect(insert?.values.slice(0, 4)).toEqual(['200', '2026', true, 'bdl_plays_nightly']);
    expect(insert?.values.slice(4)).toEqual([['7', '7'], ['1', '1'], [1, 2], [3, 2], [1, 1], [1, 0], [0, 0]]);
    expect(JSON.parse(res.body).playerPeriodGames).toBe(1);
  });

  it('marks a game not reconciled when play-by-play disagrees with the box score', async () => {
    h.gamesBySeasonType.regular = [game(200, '2026-10-20')];
    h.boxRows = [{ game_id: '200', player_id: '7', team_id: '1', points: 4, fgm: 2, fg3m: 0, ftm: 0 }];
    h.playsByGame['200'] = [
      { period: 1, type: 'Layup Shot', shooting_play: true, scoring_play: true, score_value: 2, participants: [8] },
      { period: 1, type: 'Layup Shot', shooting_play: true, scoring_play: true, score_value: 2, participants: [7] },
    ];
    const res = await runHandler();
    const insert = h.calls.find((c) => c.sql.includes('insert into analytics.player_period_scoring'));
    expect(insert?.values[2]).toBe(false);
    expect(JSON.parse(res.body).playerPeriodNotReconciled).toBe(1);
  });

  it('DISABLE_PLAYER_PERIOD_SCORING=1 skips play-by-play calls', async () => {
    h.gamesBySeasonType.regular = [game(200, '2026-10-20')];
    h.boxRows = [{ game_id: '200', player_id: '7', team_id: '1', points: 0, fgm: 0, fg3m: 0, ftm: 0 }];
    process.env.DISABLE_PLAYER_PERIOD_SCORING = '1';
    try {
      const res = await runHandler();
      expect(res.statusCode).toBe(200);
      expect(h.urls.some((u) => new URL(u).pathname.endsWith('/plays'))).toBe(false);
    } finally {
      delete process.env.DISABLE_PLAYER_PERIOD_SCORING;
    }
  });

  it('season-average aggregates carry the opening-night predicate', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const src = readFileSync(path.resolve(__dirname, '../index.ts'), 'utf8');
    expect(src).toMatch(/from analytics\.team_game_stats t\s+left join \(values \$\{regularSeasonOpenValuesSql\(\)\}\)/);
    expect(src).toMatch(/t\.game_date >= rs_open\.open_et/);
    expect(src).toMatch(/from analytics\.player_game_logs l\s+left join \(values \$\{regularSeasonOpenValuesSql\(\)\}\)/);
    expect(src).toMatch(/l\.game_date >= rs_open\.open_et/);
  });
});
