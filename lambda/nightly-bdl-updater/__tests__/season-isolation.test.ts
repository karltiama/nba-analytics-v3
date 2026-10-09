import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { sql: string; values: unknown[] };

const h = vi.hoisted(() => ({
  urls: [] as string[],
  calls: [] as Call[],
  gamesBySeasonType: {} as Record<string, unknown[]>,
}));

vi.mock('pg', () => {
  const query = async (sql: string, values: unknown[] = []) => {
    h.calls.push({ sql, values });
    if (sql.includes('yesterday_et')) {
      return { rows: [{ yesterday_et: '2026-10-19', today_et: '2026-10-20', schedule_end_et: '2026-11-03' }] };
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
    const u = new URL(url);
    const body = u.pathname.endsWith('/games')
      ? { data: h.gamesBySeasonType[u.searchParams.get('season_type') ?? '<none>'] ?? [], meta: { next_cursor: null } }
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
