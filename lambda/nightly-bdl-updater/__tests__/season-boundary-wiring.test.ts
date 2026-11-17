import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { sql: string; values: unknown[] };

const h = vi.hoisted(() => ({
  urls: [] as string[],
  calls: [] as Call[],
  games: [] as Record<string, unknown>[],
  stats: [] as Record<string, unknown>[],
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
    const pathname = new URL(url).pathname;
    const data = pathname.endsWith('/games') ? h.games : pathname.endsWith('/stats') ? h.stats : [];
    return new Response(JSON.stringify({ data, meta: { next_cursor: null } }), { status: 200 });
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
  DISABLE_PLAYER_PERIOD_SCORING: '1',
};

function currentGame(season: unknown = 2026) {
  return {
    id: 200,
    season,
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

const saved: Record<string, string | undefined> = {};

async function runHandler() {
  vi.resetModules();
  const mod = await import('../index');
  return mod.handler();
}

function statWrites(): Call[] {
  return h.calls.filter(
    (call) => call.sql.includes('insert into raw.player_game_stats') || call.sql.includes('raw.upsert_player_game_stat')
  );
}

describe('nightly season-boundary wiring', () => {
  beforeEach(() => {
    h.urls.length = 0;
    h.calls.length = 0;
    h.games = [];
    h.stats = [];
    for (const [key, value] of Object.entries(ENV)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
    delete process.env.PGS_NORMALIZED_STORAGE;
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
    vi.restoreAllMocks();
  });

  it('writes a current-season stat only after the game passes the boundary', async () => {
    h.games = [currentGame()];
    h.stats = [{ id: 9, min: '10:00', game: { id: 200, season: 2026 } }];
    const response = await runHandler();
    expect(response.statusCode).toBe(200);
    expect(h.calls.some((call) => call.sql.includes('insert into raw.games'))).toBe(true);
    expect(statWrites().length).toBeGreaterThan(0);
  });

  it('rejects a prior-season stat before raw.games or the normalized writer', async () => {
    h.games = [currentGame()];
    h.stats = [{ id: 9, game: { id: 200, season: 2025 } }];
    const response = await runHandler();
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toMatch(/season 2025/);
    expect(h.calls.some((call) => call.sql.includes('insert into raw.games'))).toBe(false);
    expect(statWrites()).toEqual([]);
  });

  it('rejects a stat whose game is outside the serving set before any write', async () => {
    h.games = [currentGame()];
    h.stats = [{ id: 9, game: { id: 404, season: 2026 } }];
    const response = await runHandler();
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toMatch(/not in the current-season serving set/);
    expect(statWrites()).toEqual([]);
  });

  it('keeps a preseason tip out of the stat writer', async () => {
    h.games = [{ ...currentGame(), id: 100, date: '2026-10-19', datetime: '2026-10-19T23:30:00.000Z' }];
    h.stats = [{ id: 9, game: { id: 100, season: 2026 } }];
    const response = await runHandler();
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).finalGames).toBe(0);
    expect(statWrites()).toEqual([]);
  });

  it('does not write when the provider omits the season', async () => {
    h.games = [currentGame(null)];
    const response = await runHandler();
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).gamesFenced).toBe(1);
    expect(JSON.parse(response.body).finalGames).toBe(0);
    expect(h.calls.some((call) => call.sql.includes('insert into raw.games'))).toBe(false);
  });

  it('uses the normalized writer for a repeated current-season run', async () => {
    process.env.PGS_NORMALIZED_STORAGE = '1';
    h.games = [currentGame()];
    h.stats = [{ id: 9, min: '10:00', game: { id: 200, season: 2026 } }];
    const first = await runHandler();
    const second = await runHandler();
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const writes = statWrites();
    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect(writes.every((call) => call.sql.includes('raw.upsert_player_game_stat'))).toBe(true);
  });

  it('freeze and dry-run return before provider calls and stat writes', async () => {
    process.env.DATA_MODE = 'replay';
    process.env.OFFSEASON_MODE = '1';
    process.env.CRON_DRY_RUN = '1';
    h.games = [currentGame(2025)];
    h.stats = [{ id: 9, game: { id: 200, season: 2025 } }];
    const response = await runHandler();
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).skippedProviderCalls).toBe(true);
    expect(h.urls).toEqual([]);
    expect(statWrites()).toEqual([]);
  });
});
