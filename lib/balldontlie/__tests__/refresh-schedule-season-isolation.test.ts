import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  urls: [] as string[],
  sql: [] as Array<{ text: string; values: unknown[] }>,
  gamesBySeasonType: {} as Record<string, unknown[]>,
}));

vi.mock('@/lib/db', () => {
  const query = async (text: string, values: unknown[] = []) => {
    h.sql.push({ text, values });
    return { rows: [], rowCount: 0 };
  };
  return { default: { connect: async () => ({ query, release: () => {} }), query } };
});

vi.mock('@/lib/balldontlie/live-rate-limit', () => ({
  fetchBdlLive: async (url: string) => {
    h.urls.push(url);
    const type = new URL(url).searchParams.get('season_type') ?? '<none>';
    return new Response(JSON.stringify({ data: h.gamesBySeasonType[type] ?? [], meta: { next_cursor: null } }), {
      status: 200,
    });
  },
}));

import { refreshBdlScheduleForEtDateRange } from '@/lib/balldontlie/refresh-schedule-from-bdl';

const game = (id: number, date: string, season = 2026) => ({
  id,
  season,
  date,
  datetime: `${date}T23:30:00.000Z`,
  status: `${date}T23:30:00Z`,
  postseason: false,
  home_team: { id: 1 },
  visitor_team: { id: 2 },
});

const rawGameIds = () => h.sql.filter((s) => s.text.includes('insert into raw.games')).map((s) => s.values[0]);

describe('slate refresh preseason isolation', () => {
  const savedKey = process.env.BALLDONTLIE_API_KEY;

  beforeEach(() => {
    h.urls.length = 0;
    h.sql.length = 0;
    h.gamesBySeasonType = {};
    process.env.BALLDONTLIE_API_KEY = 'test-key-not-real';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.BALLDONTLIE_API_KEY;
    else process.env.BALLDONTLIE_API_KEY = savedKey;
    vi.restoreAllMocks();
  });

  it('queries season_type=regular explicitly and never preseason', async () => {
    await refreshBdlScheduleForEtDateRange('2026-10-20', '2026-10-20', 2026);
    expect(h.urls).toHaveLength(1);
    expect(new URL(h.urls[0]).searchParams.get('season_type')).toBe('regular');
  });

  it('upserts Oct 20 games and fences Oct 19 rows before any write', async () => {
    h.gamesBySeasonType.regular = [game(1, '2026-10-19'), game(2, '2026-10-20')];
    const n = await refreshBdlScheduleForEtDateRange('2026-10-19', '2026-10-20', 2026);
    expect(n).toBe(1);
    expect(rawGameIds()).toEqual([2]);
  });

  it('only preseason-dated rows: no DB connection, no writes', async () => {
    h.gamesBySeasonType.regular = [game(1, '2026-10-09')];
    const n = await refreshBdlScheduleForEtDateRange('2026-10-09', '2026-10-09', 2026);
    expect(n).toBe(0);
    expect(h.sql).toHaveLength(0);
  });

  it('rows from another season are fenced', async () => {
    h.gamesBySeasonType.regular = [game(3, '2026-10-22', 2025)];
    const n = await refreshBdlScheduleForEtDateRange('2026-10-22', '2026-10-22', 2026);
    expect(n).toBe(0);
    expect(rawGameIds()).toEqual([]);
  });

  it('historical playoff window adds playin and playoffs queries and keeps those rows', async () => {
    h.gamesBySeasonType.playoffs = [game(4, '2026-04-20', 2025)];
    const n = await refreshBdlScheduleForEtDateRange('2026-04-20', '2026-04-20', 2025);
    expect(h.urls.map((u) => new URL(u).searchParams.get('season_type'))).toEqual(['regular', 'playin', 'playoffs']);
    expect(n).toBe(1);
    expect(rawGameIds()).toEqual([4]);
  });
});
