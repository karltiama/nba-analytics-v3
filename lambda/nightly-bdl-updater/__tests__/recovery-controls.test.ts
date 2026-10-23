import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateGameBox, type StatLine } from '../box-completeness';
import { PLAYER_SEASON_SQL, TEAM_SEASON_SQL } from '../recovery-execute';
import {
  chargeAttempt,
  fetchRecoveryGames,
  recoveryGamesUrl,
  type AttemptBudget,
} from '../recovery-fetch';
import {
  planRecovery,
  recoveryAttemptBudget,
  recoveryRetryLimit,
  type RecoveryPlan,
} from '../recovery-plan';
import { selectRecoveryGames, type ProviderGame } from '../recovery-select';

type Call = { sql: string; values: unknown[] };

const h = vi.hoisted(() => ({
  urls: [] as string[],
  calls: [] as Call[],
  connects: 0,
  games: [] as unknown[],
  stats: [] as unknown[],
  status: 0,
  fetchError: null as Error | null,
  gamesCursors: [] as Array<number | null>,
  statsCursors: [] as Array<number | null>,
  failOn: '' as string,
  rawConflict: false,
  holdFirstLock: false,
  lockHold: Promise.resolve() as Promise<void>,
  lockWaits: 0,
  rollbackFails: false,
  releases: [] as Array<Error | null>,
  burst429: false,
  burstAccepted: 0,
  retry429: false,
  exhaustBeforeNextPage: false,
  trailingEmptyStats: false,
}));

vi.mock('pg', () => {
  const query = async (sql: string, values: unknown[] = []) => {
    h.calls.push({ sql, values });
    if (h.failOn && sql.includes(h.failOn)) throw new Error('injected write failure');
    if (sql === 'rollback' && h.rollbackFails) throw new Error('rollback failed');
    if (sql.includes('pg_advisory_xact_lock')) {
      h.lockWaits += 1;
      if (h.holdFirstLock && h.lockWaits === 1) {
        await h.lockHold;
        return { rows: [] };
      }
      if (h.holdFirstLock && h.lockWaits > 1) {
        throw new Error('advisory lock held by the uncommitted recovery');
      }
    }
    if (sql.includes('yesterday_et')) {
      return { rows: [{ yesterday_et: '2026-10-19', today_et: '2026-10-20', schedule_end_et: '2026-11-03' }] };
    }
    if (sql.includes('from raw.player_game_stats where game_id') && h.rawConflict) {
      return { rows: [{ id: 999, player_id: 1 }] };
    }
    if (sql.includes('from analytics.player_game_logs where game_id')) return { rows: [] };
    if (sql.includes('from analytics.team_game_stats')) {
      const played = new Map<string, Set<string>>();
      for (const call of h.calls) {
        if (!call.sql.includes('insert into analytics.team_game_stats')) continue;
        if (String(call.values[2]) !== '2026') throw new Error(`team stat season ${String(call.values[2])}`);
        const key = String(call.values[0]);
        const games = played.get(key) ?? new Set<string>();
        games.add(String(call.values[1]));
        played.set(key, games);
      }
      return {
        rows: [...played.entries()].map(([teamId, games]) => ({
          team_id: teamId,
          season: '2026',
          games_played: games.size,
          avg_points: 1,
          avg_rebounds: 1,
          avg_assists: 1,
          avg_steals: 1,
          avg_blocks: 1,
          avg_turnovers: 1,
          avg_fgm: 1,
          avg_fga: 1,
          avg_3pm: 1,
          avg_3pa: 1,
          avg_ftm: 1,
          avg_fta: 1,
          avg_points_allowed: 1,
          wins: 1,
          losses: 0,
          home_wins: 1,
          home_losses: 0,
          away_wins: 0,
          away_losses: 0,
          win_pct: 1,
          avg_offensive_rating: 110,
          avg_defensive_rating: 108,
          avg_pace: 22,
          avg_efg_pct: 0.55,
          avg_tov_pct: 0.12,
          avg_orb_pct: 0.25,
        })),
      };
    }
    if (sql.includes('from analytics.player_game_logs l')) {
      const played = new Map<string, Set<string>>();
      for (const call of h.calls) {
        if (!call.sql.includes('insert into analytics.player_game_logs')) continue;
        if (String(call.values[23]) !== '2026') throw new Error(`log season ${String(call.values[23])}`);
        const playerId = String(call.values[1]);
        const games = played.get(playerId) ?? new Set<string>();
        games.add(String(call.values[0]));
        played.set(playerId, games);
      }
      return {
        rows: [...played.entries()].map(([playerId, games]) => ({
          player_id: playerId,
          season: '2026',
          games_played: games.size,
          pts_avg: 20,
          reb_avg: 5,
          ast_avg: 3,
          stl_avg: 1,
          blk_avg: 0,
          turnover_avg: 1,
          pra_avg: 28,
          fg_pct: 0.5,
          fg3_pct: 0.4,
          ft_pct: 0.8,
        })),
      };
    }
    return { rows: [] };
  };
  class Pool {
    query = query;
    async connect() {
      h.connects += 1;
      return { query, release: (err?: Error) => { h.releases.push(err ?? null); } };
    }
    async end() {}
  }
  return { Pool };
});

vi.mock('../bdl-live-rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../bdl-live-rate-limit')>();
  return {
    ...actual,
    fetchBdlLive: async (url: string, _init?: RequestInit, options?: { onHttpAttempt?: (event: { status: number | 'error' }) => void; beforeHttpAttempt?: () => void }) => {
    h.urls.push(url);
    if (h.burst429) {
      try {
        for (let attempt = 0; attempt < 200; attempt += 1) {
          options?.beforeHttpAttempt?.();
          h.burstAccepted += 1;
        }
      } catch (error) {
        throw error;
      }
    }
    if (h.exhaustBeforeNextPage) {
      const charges = h.urls.length === 1 ? 48 : 1;
      for (let attempt = 0; attempt < charges; attempt += 1) {
        options?.beforeHttpAttempt?.();
        h.burstAccepted += 1;
      }
      return new Response(JSON.stringify({ data: h.games, meta: { next_cursor: 9 } }), { status: 200 });
    }
    if (h.retry429) {
      options?.beforeHttpAttempt?.();
      options?.onHttpAttempt?.({ status: 429 });
      options?.beforeHttpAttempt?.();
      options?.onHttpAttempt?.({ status: 200 });
    } else {
      options?.beforeHttpAttempt?.();
      options?.onHttpAttempt?.({ status: h.fetchError ? 'error' : h.status || 200 });
    }
    if (h.fetchError) throw h.fetchError;
    const parsed = new URL(url);
    if (h.status) return new Response('no', { status: h.status });
    if (parsed.pathname.endsWith('/games')) {
      const cursor = h.gamesCursors.length ? h.gamesCursors.shift() ?? null : null;
      return new Response(JSON.stringify({ data: h.games, meta: { next_cursor: cursor } }), { status: 200 });
    }
    if (parsed.pathname.endsWith('/stats')) {
      const cursor = h.statsCursors.length ? h.statsCursors.shift() ?? null : null;
      const statsUrls = h.urls.filter((url) => url.includes('/stats')).length;
      const data = h.trailingEmptyStats && cursor == null && statsUrls > 1 ? [] : h.stats;
      return new Response(JSON.stringify({ data, meta: { next_cursor: cursor } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [], meta: { next_cursor: null } }), { status: 200 });
  },
  };
});

const LIVE = {
  SUPABASE_DB_URL: 'postgresql://test:test@localhost:5432/test',
  BALLDONTLIE_API_KEY: 'test-key-not-real',
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
  INGESTION_SEASON_START_YEAR: '2026',
  DISABLE_BDL_SCHEDULE_SYNC: '1',
  MAX_RETRIES: '3',
};

const saved: Record<string, string | undefined> = {};

function game(id: number, overrides: Partial<ProviderGame> = {}): ProviderGame {
  return {
    id,
    season: 2026,
    date: '2026-10-21',
    datetime: '2026-10-22T03:00:00.000Z',
    status: 'Final',
    home_team_score: 86,
    visitor_team_score: 80,
    home_team: { id: 10, abbreviation: 'ORL' },
    visitor_team: { id: 20, abbreviation: 'ATL' },
    ...overrides,
  };
}

function line(id: number, playerId: number, teamId: number, gameId: number, overrides: Partial<StatLine> = {}): StatLine {
  const home = teamId === 10;
  const bump = home && playerId % 10 === 1;
  const fgm = bump ? 6 : 4;
  const fga = bump ? 10 : 8;
  const fg3m = bump ? 2 : 1;
  const fg3a = bump ? 4 : 3;
  const ftm = bump ? 2 : 1;
  const fta = 2;
  return {
    id,
    player: { id: playerId, first_name: home ? 'Home' : 'Away', last_name: String(playerId) },
    team: { id: teamId },
    game: { id: gameId },
    min: '18',
    fgm,
    fga,
    fg3m,
    fg3a,
    ftm,
    fta,
    oreb: 1,
    dreb: 2,
    reb: 3,
    turnover: 1,
    pts: 2 * (fgm - fg3m) + 3 * fg3m + ftm,
    ast: 1,
    stl: 0,
    blk: 0,
    pf: 1,
    plus_minus: home ? 6 : -6,
    ...overrides,
  };
}

function box(gameId: number): StatLine[] {
  const lines: StatLine[] = [];
  for (let player = 1; player <= 8; player += 1) {
    lines.push(line(gameId * 100 + player, gameId * 100 + player, 10, gameId));
    lines.push(line(gameId * 100 + 50 + player, gameId * 100 + 50 + player, 20, gameId));
  }
  return lines;
}

function recoveryEvent(
  gameIds: Array<number | string>,
  startDate = '2026-10-21',
  endDate = '2026-10-21',
  seasonStartYear: unknown = 2026,
  extra: Record<string, unknown> = {}
) {
  return { recovery: { seasonStartYear, startDate, endDate, gameIds, ...extra } };
}

async function loadHandler(env: Record<string, string | undefined> = LIVE) {
  for (const key of Object.keys(LIVE)) {
    if (!(key in saved)) saved[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (!(key in saved)) saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  return import('../index');
}

function inserts(table: string): Call[] {
  return h.calls.filter((call) => call.sql.includes(`insert into ${table}`));
}

describe('recovery plan', () => {
  const env = { INGESTION_SEASON_START_YEAR: '2026' };

  it('rejects an empty allowlist, a reversed window, an excessive window, and a preseason date', () => {
    expect(() => planRecovery(recoveryEvent([]), env)).toThrow(/at least one game id/);
    expect(() => planRecovery(recoveryEvent([21717922], '2026-10-21', '2026-10-20'), env)).toThrow(/reversed/);
    expect(() => planRecovery(recoveryEvent([21717922], '2026-10-20', '2026-10-22'), env)).toThrow(/maximum is 2/);
    expect(() => planRecovery(recoveryEvent([21717922], '2026-10-19', '2026-10-19'), env)).toThrow(/not in the 2026 regular season/);
  });

  it('fails closed when the season is missing, invalid, or not 2026', () => {
    expect(() => planRecovery(recoveryEvent([21717922]), {})).toThrow(/four-digit/);
    expect(() => planRecovery(recoveryEvent([21717922]), { INGESTION_SEASON_START_YEAR: '2026-27' })).toThrow(/four-digit/);
    expect(() => planRecovery(recoveryEvent([21717922]), { INGESTION_SEASON_START_YEAR: '2025' })).toThrow(/not the recovery season/);
    expect(() => planRecovery({ recovery: { startDate: '2026-10-21', endDate: '2026-10-21', gameIds: [21717922] } }, env)).toThrow(
      /seasonStartYear is required/
    );
    expect(() => planRecovery(recoveryEvent([21717922], '2026-10-21', '2026-10-21', 2025), env)).toThrow(/season start year 2026/);
  });

  it('dedupes game ids and rejects an allowlist above 14', () => {
    const plan = planRecovery(recoveryEvent([21717922, '21717922']), env);
    expect(plan.gameIds).toEqual([21717922]);
    expect(plan.duplicateIdsIgnored).toEqual([21717922]);
    expect(() => planRecovery(recoveryEvent(Array.from({ length: 15 }, (_, index) => 21717922 + index)), env)).toThrow(/maximum is 14/);
  });

  it('caps recovery retries at the existing default of 3', () => {
    expect(recoveryRetryLimit(10)).toBe(3);
    expect(recoveryRetryLimit(0)).toBe(0);
    expect(recoveryAttemptBudget(3)).toBe(32);
  });

  it('rejects a canary payload that omits the approved final or tries to disable the ceiling', () => {
    const env = { INGESTION_SEASON_START_YEAR: '2026', RECOVERY_ONLY: '1' };
    expect(() => planRecovery(recoveryEvent([21717922]), env)).toThrow(/expected final/);
    expect(() =>
      planRecovery(recoveryEvent([21717922], '2026-10-21', '2026-10-21', 2026, { strictHttpBudget: false, expected: [] }), env)
    ).toThrow(/cannot raise or disable/);
    const planned = planRecovery(
      recoveryEvent([21717922], '2026-10-21', '2026-10-21', 2026, {
        expected: [{ gameId: 21717922, homeTeamId: 22, awayTeamId: 1, homeScore: 125, awayScore: 132 }],
      }),
      env
    );
    expect(planned.strictHttpBudget).toBe(true);
    expect(planned.expected[0]).toMatchObject({ homeTeamId: 22, awayTeamId: 1, homeScore: 125, awayScore: 132 });
  });

  it('builds a games url only for the requested window', () => {
    const plan = planRecovery(recoveryEvent([21717922], '2026-10-20', '2026-10-21'), env);
    const url = new URL(recoveryGamesUrl('https://api.balldontlie.io/v1', plan, 'regular', null));
    expect(url.searchParams.get('start_date')).toBe('2026-10-20');
    expect(url.searchParams.get('end_date')).toBe('2026-10-21');
    expect(url.searchParams.get('seasons[]')).toBe('2026');
    expect(url.searchParams.get('season_type')).toBe('regular');
    expect(url.searchParams.get('per_page')).toBe('100');
  });
});

describe('box completeness and selection', () => {
  const plan: RecoveryPlan = {
    seasonStartYear: 2026,
    startDate: '2026-10-21',
    endDate: '2026-10-21',
    gameIds: [21717922],
    duplicateIdsIgnored: [],
    strictHttpBudget: false,
    expected: [],
  };

  it('accepts a complete box, including a genuine zero turnover, and ignores a neighbor', () => {
    const selected = selectRecoveryGames(plan, [game(21717922), game(21717923)]);
    expect(selected.ignoredGameIds).toEqual([21717923]);
    const zeros = box(21717922).map((row) => ({ ...row, turnover: 0 }));
    const validated = validateGameBox(selected.ready[0], zeros);
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.box.possessions).toBeGreaterThan(0);
  });

  it('rejects a non-final, a 2025 season, a date outside the window, and an ET date that disagrees with the UTC tip', () => {
    expect(selectRecoveryGames(plan, [game(21717922, { status: '2026-10-21T23:00:00Z' })]).rejected[0].reason).toBe('not_final');
    expect(selectRecoveryGames(plan, [game(21717922, { season: 2025 })]).rejected[0].reason).toBe('season_mismatch');
    expect(selectRecoveryGames(plan, [game(21717922, { date: '2026-10-22' })]).rejected[0].reason).toBe('outside_window');
    expect(
      selectRecoveryGames(plan, [game(21717922, { date: '2026-10-22', datetime: '2026-10-22T02:00:00.000Z' })]).rejected[0].reason
    ).toBe('outside_window');
    expect(selectRecoveryGames(plan, []).rejected[0].reason).toBe('game_absent');
  });

  it('rejects one missing team, a null counting stat, duplicate players, a score mismatch, and non-positive possessions', () => {
    const final = game(21717922);
    expect(validateGameBox(final, [box(21717922)[0]]).ok).toBe(false);
    const missing = box(21717922);
    delete missing[0].turnover;
    const missingResult = validateGameBox(final, missing);
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) expect(missingResult.rejection).toMatchObject({ reason: 'missing_stat', detail: 'turnover' });

    const duplicated = box(21717922);
    duplicated.push({ ...duplicated[0], id: 99 });
    expect(validateGameBox(final, duplicated).ok).toBe(false);

    const mismatched = validateGameBox(game(21717922, { home_team_score: 125, visitor_team_score: 132 }), box(21717922));
    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok) expect(mismatched.rejection.reason).toBe('score_mismatch');

    const empty = box(21717922).map((row) => ({
      ...row,
      fgm: 5,
      fga: 10,
      fg3m: 0,
      fg3a: 0,
      ftm: 0,
      fta: 0,
      oreb: 40,
      dreb: 5,
      reb: 45,
      turnover: 0,
      pts: 10,
    }));
    const possessions = validateGameBox(game(21717922, { home_team_score: 80, visitor_team_score: 80 }), empty);
    expect(possessions.ok).toBe(false);
    if (!possessions.ok) expect(possessions.rejection.reason).toBe('invalid_possessions');
  });

  it('stops when the games cursor is still open after the page cap', async () => {
    const budget: AttemptBudget = { attempts: 0, maxAttempts: 2 };
    await expect(
      fetchRecoveryGames({
        baseUrl: 'https://api.balldontlie.io/v1',
        plan,
        retries: 0,
        onAttempt: () => chargeAttempt(budget),
        onHttpAttempt: () => {},
        beforeHttpAttempt: () => {},
        fetchPage: async (_url, _retries, onAttempt) => {
          onAttempt();
          return new Response(JSON.stringify({ data: [game(21717922)], meta: { next_cursor: budget.attempts + 1 } }), { status: 200 });
        },
      })
    ).rejects.toMatchObject({ reason: 'truncated' });
    expect(budget.attempts).toBe(2);
  });

  it('rejects a two-player box and a short box whose shooting already matches the score', () => {
    const home = line(1, 1, 10, 21717922);
    const away = line(2, 2, 20, 21717922);
    const short = validateGameBox(
      game(21717922, { home_team_score: home.pts, visitor_team_score: away.pts }),
      [home, away]
    );
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.rejection.reason).toBe('short_box');

    const seven = box(21717922).filter((row) => row.team?.id !== 10 || Number(row.player?.id) % 100 !== 8);
    const homePts = seven.filter((row) => row.team?.id === 10).reduce((sum, row) => sum + Number(row.pts), 0);
    const awayPts = seven.filter((row) => row.team?.id === 20).reduce((sum, row) => sum + Number(row.pts), 0);
    const reduced = validateGameBox(game(21717922, { home_team_score: homePts, visitor_team_score: awayPts }), seven);
    expect(reduced.ok).toBe(false);
    if (!reduced.ok) expect(reduced.rejection.reason).toBe('short_box');
  });

  it('rejects a scoring or rebound identity break and an unreadable minutes value', () => {
    const scored = box(21717922);
    scored[0] = { ...scored[0], pts: Number(scored[0].pts) + 1 };
    const scoring = validateGameBox(game(21717922), scored);
    expect(scoring.ok).toBe(false);
    if (!scoring.ok) expect(scoring.rejection.reason).toBe('scoring_identity');

    const rebounds = box(21717922);
    rebounds[0] = { ...rebounds[0], reb: Number(rebounds[0].reb) + 1 };
    const rebound = validateGameBox(game(21717922), rebounds);
    expect(rebound.ok).toBe(false);
    if (!rebound.ok) expect(rebound.rejection.reason).toBe('rebound_identity');

    const shots = box(21717922);
    shots[0] = { ...shots[0], fgm: 11 };
    const split = validateGameBox(game(21717922), shots);
    expect(split.ok).toBe(false);
    if (!split.ok) expect(split.rejection.reason).toBe('invalid_shot_split');

    const minutes = box(21717922);
    minutes[0] = { ...minutes[0], min: 'OT' };
    const parsed = validateGameBox(game(21717922), minutes);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.rejection.reason).toBe('invalid_minutes');
  });

  it('does not treat a zero-minute row as a participant, and cannot see an omitted zero-point rebounder', () => {
    const benched = box(21717922);
    const eighth = benched.find((row) => row.team?.id === 10 && Number(row.player?.id) % 100 === 8);
    if (!eighth) throw new Error('fixture missing the eighth home player');
    eighth.min = '0:00';
    eighth.fgm = 0;
    eighth.fga = 0;
    eighth.fg3m = 0;
    eighth.fg3a = 0;
    eighth.ftm = 0;
    eighth.fta = 0;
    eighth.pts = 0;
    eighth.oreb = 0;
    eighth.dreb = 0;
    eighth.reb = 0;
    eighth.turnover = 0;
    const homePts = benched.filter((row) => row.team?.id === 10).reduce((sum, row) => sum + Number(row.pts), 0);
    const dnp = validateGameBox(game(21717922, { home_team_score: homePts }), benched);
    expect(dnp.ok).toBe(false);
    if (!dnp.ok) expect(dnp.rejection.reason).toBe('short_box');

    const complete = validateGameBox(game(21717922), box(21717922));
    expect(complete.ok).toBe(true);

    const omittedScorer = box(21717922).filter((row) => !(row.team?.id === 10 && Number(row.player?.id) % 100 === 1));
    const missingScorer = validateGameBox(game(21717922), omittedScorer);
    expect(missingScorer.ok).toBe(false);
    if (!missingScorer.ok) expect(missingScorer.rejection.reason).toBe('score_mismatch');

    const wrongTeam = box(21717922);
    wrongTeam[0] = { ...wrongTeam[0], team: { id: 99 } };
    const team = validateGameBox(game(21717922), wrongTeam);
    expect(team.ok).toBe(false);
    if (!team.ok) expect(team.rejection.reason).toBe('unexpected_team');
  });

  it('stops when the request budget is already spent', () => {
    const budget: AttemptBudget = { attempts: 1, maxAttempts: 1 };
    expect(() => chargeAttempt(budget)).toThrow(/request budget exhausted/);
  });
});

describe('recovery handler', () => {
  beforeEach(() => {
    h.urls.length = 0;
    h.calls.length = 0;
    h.connects = 0;
    h.games = [game(21717922), game(21717923)];
    h.stats = box(21717922);
    h.status = 0;
    h.fetchError = null;
    h.gamesCursors = [];
    h.statsCursors = [];
    h.failOn = '';
    h.rawConflict = false;
    h.holdFirstLock = false;
    h.lockHold = Promise.resolve();
    h.lockWaits = 0;
    h.rollbackFails = false;
    h.releases.length = 0;
    h.burst429 = false;
    h.burstAccepted = 0;
    h.retry429 = false;
    h.exhaustBeforeNextPage = false;
    h.trailingEmptyStats = false;
    delete process.env.RECOVERY_ONLY;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.restoreAllMocks();
  });

  it('keeps the frozen nightly return and does not read the recovery payload', async () => {
    const { handler } = await loadHandler({
      ...LIVE,
      DATA_MODE: 'replay',
      OFFSEASON_MODE: '1',
      CRON_DRY_RUN: '1',
      INGESTION_SEASON_START_YEAR: undefined,
    });
    const response = await handler(recoveryEvent([21717922]));
    const body = JSON.parse(response.body);
    expect(response.statusCode).toBe(200);
    expect(body.skippedProviderCalls).toBe(true);
    expect(body.recovery).toBeUndefined();
    expect(h.urls).toEqual([]);
    expect(h.connects).toBe(0);
  });

  it('leaves an ordinary live invoke on the nightly path', async () => {
    h.games = [];
    const { handler } = await loadHandler();
    const response = await handler();
    const body = JSON.parse(response.body);
    expect(response.statusCode).toBe(200);
    expect(body.recovery).toBeUndefined();
    expect(body.finalGames).toBe(0);
    expect(h.urls.some((url) => new URL(url).searchParams.get('start_date') === '2026-10-19')).toBe(true);
    expect(h.urls.some((url) => new URL(url).pathname.endsWith('/stats'))).toBe(false);
  });

  it('writes only the allowlisted final and skips schedule sync even when that flag is off', async () => {
    const { handler } = await loadHandler({ ...LIVE, DISABLE_BDL_SCHEDULE_SYNC: '0' });
    const response = await handler(recoveryEvent([21717922, 21717922]));
    const body = JSON.parse(response.body);
    expect(response.statusCode).toBe(200);
    expect(body.writesCommitted).toBe(true);
    expect(body.scheduleGamesSynced).toBe(0);
    expect(body.committedGameIds).toEqual([21717922]);
    expect(body.ignoredGameIds).toEqual([21717923]);
    expect(body.teamGameStats).toBe(2);
    expect(body.requestsAttempted).toBe(2);
    expect(body.logicalAttempts).toBe(2);
    expect(body.httpAttempts).toBe(2);
    expect(body.httpAttemptUpperBound).toBe(128);
    expect(body.seasonTypes).toEqual(['regular']);
    const gameUrls = h.urls.filter((url) => new URL(url).pathname.endsWith('/games'));
    const statUrls = h.urls.filter((url) => new URL(url).pathname.endsWith('/stats'));
    expect(gameUrls).toHaveLength(1);
    expect(new URL(gameUrls[0]).searchParams.get('end_date')).toBe('2026-10-21');
    expect(new URL(statUrls[0]).searchParams.getAll('game_ids[]')).toEqual(['21717922']);
    expect(inserts('raw.games').map((call) => call.values[0])).toEqual([21717922]);
    expect(inserts('analytics.games').map((call) => [call.values[0], call.values[1], call.values[3], call.values[6], call.values[7]])).toEqual([
      ['21717922', '2026', 'Final', 86, 80],
    ]);
    expect(inserts('analytics.player_game_logs')).toHaveLength(16);
    expect(inserts('analytics.team_game_stats')).toHaveLength(2);
    expect(h.calls.some((call) => call.sql.includes('yesterday_et'))).toBe(false);
    expect(JSON.stringify(h.calls)).not.toContain('2025');
    expect(h.calls.some((call) => call.sql === TEAM_SEASON_SQL && call.values[0] === '2026')).toBe(true);
    expect(h.calls.some((call) => call.sql === PLAYER_SEASON_SQL && call.values[0] === '2026')).toBe(true);
    expect(inserts('analytics.team_season_averages').every((call) => call.values[1] === '2026' && call.values[2] === 1)).toBe(true);
    expect(h.calls.some((call) => call.sql.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(inserts('raw.players').every((call) => call.sql.includes('do nothing'))).toBe(true);
    expect(inserts('analytics.players').every((call) => call.sql.includes('do nothing'))).toBe(true);
    expect(h.releases).toEqual([null]);
  });

  it('writes two allowlisted games and still does not write a third returned game', async () => {
    h.games = [game(21717922), game(21717930), game(21717923)];
    h.stats = [...box(21717922), ...box(21717930)];
    const { handler } = await loadHandler();
    const response = await handler(recoveryEvent([21717922, 21717930], '2026-10-20', '2026-10-21'));
    const body = JSON.parse(response.body);
    expect(response.statusCode).toBe(200);
    expect(body.committedGameIds).toEqual([21717922, 21717930]);
    expect(new URL(h.urls.find((url) => url.includes('/stats'))!).searchParams.getAll('game_ids[]')).toEqual(['21717922', '21717930']);
    expect(inserts('raw.games').map((call) => call.values[0])).toEqual([21717922, 21717930]);
    expect(body.teamGameStats).toBe(4);
  });

  it('does not fetch or write when the allowlisted game is not a final inside the window', async () => {
    h.games = [game(21717922, { date: '2026-10-22' })];
    const { handler } = await loadHandler();
    const response = await handler(recoveryEvent([21717922]));
    const body = JSON.parse(response.body);
    expect(response.statusCode).toBe(500);
    expect(body.recoveryStatus).toBe('rejected');
    expect(body.rejected[0].reason).toBe('outside_window');
    expect(body.writesCommitted).toBe(false);
    expect(h.urls.some((url) => url.includes('/stats'))).toBe(false);
    expect(h.connects).toBe(0);
  });

  it('does not write a null counting stat, a one-team box, or a score that does not match', async () => {
    const { handler } = await loadHandler();
    h.stats = box(21717922).map((row, index) => (index === 0 ? { ...row, turnover: null } : row));
    let response = await handler(recoveryEvent([21717922]));
    expect(JSON.parse(response.body).rejected[0]).toMatchObject({ reason: 'missing_stat', detail: 'turnover' });
    expect(h.connects).toBe(0);

    h.calls.length = 0;
    h.urls.length = 0;
    h.stats = [box(21717922)[0]];
    response = await handler(recoveryEvent([21717922]));
    expect(JSON.parse(response.body).rejected[0].reason).toBe('team_missing');

    h.urls.length = 0;
    h.stats = box(21717922);
    h.games = [game(21717922, { home_team_score: 125, visitor_team_score: 132 })];
    response = await handler(recoveryEvent([21717922]));
    expect(JSON.parse(response.body).rejected[0].reason).toBe('score_mismatch');
    expect(inserts('analytics.team_game_stats')).toHaveLength(0);
  });

  it('rejects an unexpected stats game, a truncated stats cursor, a provider error, and a rate-limit throw before commit', async () => {
    h.stats = [...box(21717922), line(1, 1, 10, 999)];
    const { handler } = await loadHandler();
    let response = await handler(recoveryEvent([21717922]));
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toMatch(/outside the allowlist/);
    expect(h.connects).toBe(0);

    h.stats = box(21717922);
    h.statsCursors = [1, 2, 3, 4, 5, 6, 7];
    h.urls.length = 0;
    response = await handler(recoveryEvent([21717922]));
    expect(JSON.parse(response.body).error).toMatch(/page budget exhausted/);
    expect(h.urls.filter((url) => url.includes('/stats'))).toHaveLength(6);
    expect(h.connects).toBe(0);

    h.statsCursors = [];
    h.status = 404;
    h.urls.length = 0;
    response = await handler(recoveryEvent([21717922]));
    expect(JSON.parse(response.body).error).toMatch(/returned 404/);
    expect(h.connects).toBe(0);

    h.status = 0;
    h.fetchError = new Error('BDL rate-limit acquire timed out');
    response = await handler(recoveryEvent([21717922]));
    expect(JSON.parse(response.body).error).toMatch(/rate-limit/);
    expect(h.connects).toBe(0);
  });

  it('abandons a 500 before the deadline and does not commit', async () => {
    h.status = 500;
    const { handler } = await loadHandler();
    const response = await handler(recoveryEvent([21717922]), { getRemainingTimeInMillis: () => 0 });
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toMatch(/returned 500/);
    expect(h.connects).toBe(0);
    expect(h.urls.length).toBe(1);
  });

  it('rolls back a failed write and retries the same game once', async () => {
    h.failOn = 'insert into analytics.player_game_logs';
    const { handler } = await loadHandler();
    const failed = await handler(recoveryEvent([21717922]));
    expect(failed.statusCode).toBe(500);
    expect(h.calls.some((call) => call.sql === 'rollback')).toBe(true);
    expect(h.calls.some((call) => call.sql === 'commit')).toBe(false);

    h.failOn = '';
    h.calls.length = 0;
    h.urls.length = 0;
    const retried = await handler(recoveryEvent([21717922]));
    const body = JSON.parse(retried.body);
    expect(retried.statusCode).toBe(200);
    expect(body.committedGameIds).toEqual([21717922]);
    expect(h.calls.some((call) => call.sql === 'commit')).toBe(true);
    expect(inserts('analytics.player_game_logs')).toHaveLength(16);
    expect(inserts('analytics.team_game_stats')).toHaveLength(2);
    expect(inserts('analytics.team_season_averages').every((call) => call.values[2] === 1)).toBe(true);
    expect(inserts('analytics.player_season_averages').every((call) => call.values[1] === '2026' && call.values[2] === 1)).toBe(true);
  });

  it('does not count the same game twice when the recovery is repeated', async () => {
    const { handler } = await loadHandler();
    await handler(recoveryEvent([21717922]));
    await handler(recoveryEvent([21717922]));
    const played = inserts('analytics.team_season_averages').map((call) => call.values[2]);
    expect(played.length).toBeGreaterThan(0);
    expect(played.every((value) => value === 1)).toBe(true);
    expect(new Set(inserts('raw.games').map((call) => call.values[0]))).toEqual(new Set([21717922]));
  });

  it('rolls back when an existing raw stat id would fork the same player', async () => {
    h.rawConflict = true;
    const { handler } = await loadHandler();
    const response = await handler(recoveryEvent([21717922]));
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toMatch(/does not match this payload/);
    expect(h.calls.some((call) => call.sql === 'rollback')).toBe(true);
    expect(h.calls.some((call) => call.sql === 'commit')).toBe(false);
  });

  it('keeps season-average SQL inside season 2026', () => {
    expect(TEAM_SEASON_SQL).toContain('t.season = $1');
    expect(TEAM_SEASON_SQL).toContain('t.team_id = any($2::text[])');
    expect(PLAYER_SEASON_SQL).toContain('l.season = $1');
    expect(PLAYER_SEASON_SQL).not.toContain('2025');
  });

  it('rejects the second recovery of one game while the first transaction is still open', async () => {
    let releaseLock: () => void = () => {};
    h.lockHold = new Promise((resolve) => {
      releaseLock = resolve;
    });
    h.holdFirstLock = true;
    const { handler } = await loadHandler();
    const first = handler(recoveryEvent([21717922]));
    await vi.waitUntil(() => h.lockWaits >= 1);
    const second = await handler(recoveryEvent([21717922]));
    expect(second.statusCode).toBe(500);
    expect(JSON.parse(second.body).error).toMatch(/advisory lock held/);
    expect(inserts('raw.player_game_stats')).toHaveLength(0);
    expect(h.calls.some((call) => call.sql === 'commit')).toBe(false);
    releaseLock();
    const finished = await first;
    expect(finished.statusCode).toBe(200);
    expect(JSON.parse(finished.body).writesCommitted).toBe(true);
    expect(inserts('raw.player_game_stats')).toHaveLength(16);
  });

  it('stops a 429 storm at the HTTP ceiling and writes nothing', async () => {
    h.burst429 = true;
    const { handler } = await loadHandler();
    const response = await handler(recoveryEvent([21717922]));
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toMatch(/request budget exhausted/);
    expect(h.burstAccepted).toBe(128);
    expect(h.connects).toBe(0);
    expect(inserts('analytics.player_game_logs')).toHaveLength(0);
  });

  it('stops a strict canary at 48 HTTP attempts, including a 429 retry, and writes nothing', async () => {
    h.burst429 = true;
    const { handler } = await loadHandler();
    const response = await handler(recoveryEvent([21717922], '2026-10-21', '2026-10-21', 2026, { strictHttpBudget: true }));
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toMatch(/request budget exhausted/);
    expect(h.burstAccepted).toBe(48);
    expect(h.connects).toBe(0);
    expect(h.urls).toHaveLength(1);
  });

  it('counts a 429 and the following success inside the strict ceiling', async () => {
    h.retry429 = true;
    const { handler } = await loadHandler();
    const response = await handler(recoveryEvent([21717922], '2026-10-21', '2026-10-21', 2026, { strictHttpBudget: true }));
    const body = JSON.parse(response.body);
    expect(response.statusCode).toBe(200);
    expect(body.httpAttempts).toBe(4);
    expect(body.logicalAttempts).toBe(2);
    expect(body.httpAttemptUpperBound).toBe(48);
    expect(body.writesCommitted).toBe(true);
  });

  it('counts an extra stats page and still commits one box', async () => {
    h.statsCursors = [50];
    h.trailingEmptyStats = true;
    const { handler } = await loadHandler();
    const response = await handler(recoveryEvent([21717922], '2026-10-21', '2026-10-21', 2026, { strictHttpBudget: true }));
    const body = JSON.parse(response.body);
    expect(response.statusCode).toBe(200);
    expect(body.writesCommitted).toBe(true);
    expect(body.httpAttempts).toBe(3);
    expect(body.statsPages).toBe(2);
    expect(h.urls.filter((url) => url.includes('/stats'))).toHaveLength(2);
    expect(inserts('analytics.player_game_logs')).toHaveLength(16);
  });

  it('stops before the next games page when the canary ceiling is already spent', async () => {
    h.exhaustBeforeNextPage = true;
    const { handler } = await loadHandler();
    const response = await handler(recoveryEvent([21717922], '2026-10-21', '2026-10-21', 2026, { strictHttpBudget: true }));
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toMatch(/request budget exhausted/);
    expect(h.burstAccepted).toBe(48);
    expect(h.urls).toHaveLength(2);
    expect(h.urls.some((url) => url.includes('/stats'))).toBe(false);
    expect(h.connects).toBe(0);
    expect(inserts('analytics.player_game_logs')).toHaveLength(0);
  });

  it('rejects an internally consistent box whose provider score is not the approved final', async () => {
    const { handler } = await loadHandler();
    const response = await handler(
      recoveryEvent([21717922], '2026-10-21', '2026-10-21', 2026, {
        expected: [{ gameId: 21717922, homeTeamId: 10, awayTeamId: 20, homeScore: 125, awayScore: 132 }],
      })
    );
    const body = JSON.parse(response.body);
    expect(response.statusCode).toBe(500);
    expect(body.rejected[0]).toMatchObject({ gameId: 21717922, reason: 'expected_score_mismatch' });
    expect(body.writesCommitted).toBe(false);
    expect(h.urls.some((url) => url.includes('/stats'))).toBe(false);
    expect(h.connects).toBe(0);
  });

  it('rejects a provider team that is not the approved team before any write', async () => {
    const { handler } = await loadHandler();
    const response = await handler(
      recoveryEvent([21717922], '2026-10-21', '2026-10-21', 2026, {
        expected: [{ gameId: 21717922, homeTeamId: 22, awayTeamId: 1, homeScore: 86, awayScore: 80 }],
      })
    );
    expect(JSON.parse(response.body).rejected[0].reason).toBe('expected_team_mismatch');
    expect(h.connects).toBe(0);
    expect(h.urls.some((url) => url.includes('/stats'))).toBe(false);
  });

  it('does not run nightly ingestion when recovery-only mode has no recovery payload', async () => {
    const { handler } = await loadHandler({ ...LIVE, RECOVERY_ONLY: '1' });
    const response = await handler({});
    const body = JSON.parse(response.body);
    expect(response.statusCode).toBe(500);
    expect(body.recoveryOnly).toBe(true);
    expect(body.skippedProviderCalls).toBe(true);
    expect(body.scheduleGamesSynced).toBe(0);
    expect(h.urls).toEqual([]);
    expect(h.connects).toBe(0);
  });

  it('keeps a frozen process frozen when recovery-only mode is also set', async () => {
    const { handler } = await loadHandler({
      ...LIVE,
      DATA_MODE: 'replay',
      OFFSEASON_MODE: '1',
      CRON_DRY_RUN: '1',
      INGESTION_SEASON_START_YEAR: undefined,
      RECOVERY_ONLY: '1',
    });
    const response = await handler({});
    const body = JSON.parse(response.body);
    expect(response.statusCode).toBe(200);
    expect(body.skippedProviderCalls).toBe(true);
    expect(body.recoveryOnly).toBeUndefined();
    expect(h.urls).toEqual([]);
  });

  it('requires the approved final before provider calls when recovery-only mode is on', async () => {
    const { handler } = await loadHandler({ ...LIVE, RECOVERY_ONLY: '1' });
    const response = await handler(recoveryEvent([21717922]));
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toMatch(/expected final/);
    expect(h.urls).toEqual([]);
    expect(h.connects).toBe(0);
  });

  it('runs the recovery payload in recovery-only mode when the approved final matches', async () => {
    const { handler } = await loadHandler({ ...LIVE, RECOVERY_ONLY: '1' });
    const response = await handler(
      recoveryEvent([21717922], '2026-10-21', '2026-10-21', 2026, {
        expected: [{ gameId: 21717922, homeTeamId: 10, awayTeamId: 20, homeScore: 86, awayScore: 80 }],
      })
    );
    const body = JSON.parse(response.body);
    expect(response.statusCode).toBe(200);
    expect(body.writesCommitted).toBe(true);
    expect(body.httpAttemptUpperBound).toBe(48);
    expect(body.scheduleGamesSynced).toBe(0);
    expect(h.urls.some((url) => url.includes('/stats'))).toBe(true);
  });

  it('stops a 500 sequence after the capped retry count', async () => {
    h.status = 500;
    const { handler } = await loadHandler();
    const response = await handler(recoveryEvent([21717922]), { getRemainingTimeInMillis: () => 120_000 });
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toMatch(/returned 500/);
    expect(h.urls).toHaveLength(4);
    expect(h.connects).toBe(0);
  }, 30_000);

  it('marks the connection unusable when rollback fails and still reports the write error', async () => {
    h.failOn = 'insert into analytics.player_game_logs';
    h.rollbackFails = true;
    const { handler } = await loadHandler();
    const response = await handler(recoveryEvent([21717922]));
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toMatch(/injected write failure/);
    expect(h.calls.filter((call) => call.sql === 'rollback')).toHaveLength(1);
    expect(h.releases).toHaveLength(1);
    expect(h.releases[0]).toBeInstanceOf(Error);
    expect(h.releases[0]?.message).toBe('rollback failed');
    expect(h.calls.some((call) => call.sql === 'commit')).toBe(false);
  });

  it('releases a successful rollback without an error', async () => {
    h.failOn = 'insert into analytics.player_game_logs';
    const { handler } = await loadHandler();
    const response = await handler(recoveryEvent([21717922]));
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toMatch(/injected write failure/);
    expect(h.releases).toEqual([null]);
  });
});
