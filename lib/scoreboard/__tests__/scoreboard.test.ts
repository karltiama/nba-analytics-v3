import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AcquiringBdlFetch } from '@/lib/games/status-sync-acquisition';
import type { StoredScoreboardGame } from '@/lib/scoreboard/contract';
import { runScoreboardCycle, scoreboardGamesUrl, scoreboardLiveBoxUrl } from '@/lib/scoreboard/collector';
import { isScoreboardServingEnabled, resolveScoreboardCollection } from '@/lib/scoreboard/flags';
import {
  boxScoreCompleteness,
  carriedBoxCompleteness,
  parseMinutes,
  verifyFinalBoxScore,
} from '@/lib/scoreboard/box-verify';
import { matchLiveBoxScores, normalizeGameRow } from '@/lib/scoreboard/normalize';
import {
  activeCadenceMs,
  needsLiveBox,
  nextPollingState,
  planScoreboardTick,
  SCOREBOARD_POLICY,
} from '@/lib/scoreboard/planner';
import { serveScoreboard } from '@/lib/scoreboard/serve';
import { createMemoryScoreboardStore, createPgScoreboardStore } from '@/lib/scoreboard/store';

const ROOT = path.resolve(__dirname, '../../..');
const TIP = '2026-10-10T00:00:00.000Z';
const MIN = 60_000;
const at = (offsetMs: number) => new Date(Date.parse(TIP) + offsetMs);

const LIVE_ENV = {
  DATA_MODE: 'live_api',
  OFFSEASON_MODE: '0',
  CRON_DRY_RUN: '0',
  LIVE_INGESTION_ENABLED: '1',
  SCOREBOARD_COLLECT_PRESEASON: '1',
  SCOREBOARD_TARGET_SEASON: '2026',
};

function bdlGame(over: Record<string, unknown> = {}) {
  return {
    id: 5001,
    date: '2026-10-09',
    datetime: TIP,
    season: 2026,
    status: TIP,
    period: 0,
    time: null,
    postseason: false,
    home_team: { id: 5, abbreviation: 'CHI', full_name: 'Chicago Bulls' },
    visitor_team: { id: 15, abbreviation: 'MEM', full_name: 'Memphis Grizzlies' },
    home_team_score: 0,
    visitor_team_score: 0,
    ...over,
  };
}

/** Internally consistent player line: pts = 2*fgm + fg3m + ftm, makes <= attempts, reb = oreb + dreb. */
function statLine(id: number, pts: number, min: string) {
  const fg3m = pts >= 3 ? 1 : 0;
  const ftm = (pts - fg3m) % 2;
  const fgm = (pts - fg3m - ftm) / 2;
  return {
    player: { id, first_name: 'P', last_name: String(id) },
    min, pts, fgm, fga: fgm + 3, fg3m, fg3a: fg3m + 1, ftm, fta: ftm + 1, oreb: 1, dreb: 2, reb: 3, ast: 1,
  };
}

/** Points per player; five players per team with 48 minutes each (240 team minutes). */
function liveBox(homePts: number[], visitorPts: number[], over: Record<string, unknown> = {}) {
  const lines = (base: number, pts: number[]) => pts.map((p, i) => statLine(base + i, p, '48'));
  const sum = (pts: number[]) => pts.reduce((s, p) => s + p, 0);
  return {
    date: '2026-10-09',
    status: '1st Qtr',
    home_team_score: sum(homePts),
    visitor_team_score: sum(visitorPts),
    home_team: { id: 5, players: lines(1, homePts) },
    visitor_team: { id: 15, players: lines(101, visitorPts) },
    ...over,
  };
}

const FINAL_HOME = [20, 20, 20, 20, 20];
const FINAL_VISITOR = [20, 20, 20, 20, 18];

type Respond = (url: string) => unknown[] | { status: number } | { blocked: string };

function fakeFetchers(respond: { games: Respond; box: Respond }) {
  const calls: string[] = [];
  let n = 0;
  const make =
    (r: Respond): AcquiringBdlFetch =>
    async (url) => {
      calls.push(url);
      n += 1;
      const evidence = { requestIds: [`req-${n}`], archiveStatuses: ['ARCHIVED' as const], s3Keys: [], blockedReason: null };
      const out = r(url);
      if (!Array.isArray(out) && 'blocked' in out) {
        return { status: 200, ok: false, acquisition: { ...evidence, blockedReason: out.blocked } };
      }
      if (!Array.isArray(out)) return { status: out.status, ok: false, acquisition: evidence };
      return { status: 200, ok: true, json: { data: out as never[], meta: { next_cursor: null } }, acquisition: evidence };
    };
  return { fetch: { games: make(respond.games), liveBox: make(respond.box) }, calls };
}

function stored(over: Partial<StoredScoreboardGame> = {}): StoredScoreboardGame {
  return {
    gameId: '5001',
    season: 2026,
    seasonType: 'preseason',
    seasonTypeSource: 'request_season_type',
    etDate: '2026-10-09',
    scheduledTip: TIP,
    homeTeamId: '5',
    homeAbbr: 'CHI',
    homeName: null,
    homeScore: 0,
    visitorTeamId: '15',
    visitorAbbr: 'MEM',
    visitorName: null,
    visitorScore: 0,
    providerStatus: null,
    providerStatusState: null,
    period: 0,
    clock: null,
    overtimePeriods: 0,
    lifecycle: 'scheduled',
    gamesRequestId: 'req-0',
    firstObservedAt: at(-48 * 60 * MIN).toISOString(),
    lastObservedAt: at(-1 * MIN).toISOString(),
    lastChangedAt: at(-48 * 60 * MIN).toISOString(),
    terminalConfirmations: 0,
    finalObservedAt: null,
    pollingState: 'pending',
    boxCompleteness: 'none',
    boxRequestId: null,
    boxObservedAt: null,
    finalBoxAttempts: 0,
    ...over,
  };
}

describe('scoreboard gates fail closed', () => {
  it('collection needs live mode, LIVE_INGESTION_ENABLED and an exact "1" per season type', () => {
    expect(resolveScoreboardCollection(LIVE_ENV).seasonTypes).toEqual(['preseason']);
    expect(resolveScoreboardCollection({}).frozen).toBe(true);
    expect(resolveScoreboardCollection({ ...LIVE_ENV, DATA_MODE: undefined }).seasonTypes).toEqual([]);
    expect(resolveScoreboardCollection({ ...LIVE_ENV, CRON_DRY_RUN: '1' }).seasonTypes).toEqual([]);
    expect(resolveScoreboardCollection({ ...LIVE_ENV, LIVE_INGESTION_ENABLED: '0' }).seasonTypes).toEqual([]);
    for (const v of ['true', 'yes', '01', ' 2 ']) {
      const d = resolveScoreboardCollection({ ...LIVE_ENV, SCOREBOARD_COLLECT_PRESEASON: v });
      expect(d.seasonTypes, v).toEqual([]);
      expect(d.refused[0].reason).toMatch(/invalid/);
    }
  });

  it('regular season, play-in and playoffs cannot be enabled by flag', () => {
    const d = resolveScoreboardCollection({
      ...LIVE_ENV,
      SCOREBOARD_COLLECT_PRESEASON: undefined,
      SCOREBOARD_COLLECT_REGULAR: '1',
      SCOREBOARD_COLLECT_PLAYIN: '1',
      SCOREBOARD_COLLECT_PLAYOFFS: '1',
    });
    expect(d.seasonTypes).toEqual([]);
    expect(d.refused.map((r) => r.seasonType)).toEqual(['regular', 'playin', 'playoffs']);
    expect(d.refused.every((r) => /separate approval/.test(r.reason))).toBe(true);
  });

  it('serving: only "1" serves, independent of collection', () => {
    expect(isScoreboardServingEnabled({}).enabled).toBe(false);
    expect(isScoreboardServingEnabled({ SCOREBOARD_SERVING_ENABLED: 'true' })).toEqual({
      enabled: false,
      reason: 'serving_flag_invalid',
    });
    expect(isScoreboardServingEnabled({ SCOREBOARD_SERVING_ENABLED: '1' }).enabled).toBe(true);
    expect(isScoreboardServingEnabled({ ...LIVE_ENV }).enabled).toBe(false);
  });
});

describe('season provenance and normalization', () => {
  const ctx = { requestSeasonType: 'preseason' as const, targetSeason: 2026, requestId: 'r1', observedAt: TIP };

  it('season type comes from the request, never from season or postseason=false', () => {
    const r = normalizeGameRow(bdlGame(), ctx, at(-MIN));
    expect(r.ok && r.game.seasonType).toBe('preseason');
    expect(r.ok && r.game.seasonTypeSource).toBe('request_season_type');
    const asRegular = normalizeGameRow(bdlGame(), { ...ctx, requestSeasonType: 'regular' }, at(-MIN));
    expect(asRegular.ok && asRegular.game.seasonType).toBe('regular');
  });

  it('rows contradicting the request are rejected, not relabelled', () => {
    expect(normalizeGameRow(bdlGame({ season_type: 'regular' }), ctx, at(0))).toMatchObject({ ok: false });
    expect(normalizeGameRow(bdlGame({ postseason: true }), ctx, at(0))).toMatchObject({ ok: false });
    expect(normalizeGameRow(bdlGame({ season: 2025 }), ctx, at(0))).toMatchObject({ ok: false });
    expect(normalizeGameRow(bdlGame({ home_team: null }), ctx, at(0))).toMatchObject({ ok: false });
  });

  it('lifecycle covers scheduled, live, halftime, overtime, final, postponed, canceled and unknown', () => {
    const life = (over: Record<string, unknown>, now = at(30 * MIN)) => {
      const r = normalizeGameRow(bdlGame(over), ctx, now);
      return r.ok ? r.game.lifecycle : r.reason;
    };
    expect(life({}, at(-MIN))).toBe('scheduled');
    expect(life({ status_state: 'in_progress', status: '2nd Qtr', period: 2 })).toBe('live');
    expect(life({ status_state: 'in_progress', status: 'Halftime', period: 2 })).toBe('halftime');
    expect(life({ status_state: 'in_progress', status: 'OT', period: 5, home_ot1: 9 })).toBe('overtime');
    expect(life({ status_state: 'final', status: 'Final' })).toBe('final');
    expect(life({ status: 'Postponed' })).toBe('postponed');
    expect(life({ status: 'Canceled' })).toBe('canceled');
    expect(life({ status: 'Suspended?' })).toBe('unknown');
    const ot = normalizeGameRow(bdlGame({ period: 6, home_ot1: 9, visitor_ot1: 9, home_ot2: 5 }), ctx, at(0));
    expect(ot.ok && ot.game.overtimePeriods).toBe(2);
  });

  it('live box rows match by date and teams; unmatched and ambiguous rows are dropped', () => {
    const games = [stored()];
    const m = matchLiveBoxScores([liveBox([10, 5], [7]), { ...liveBox([1], [1]), home_team: { id: 99 } }], games);
    expect(m.byGame.get('5001')?.lines.map((l) => l.playerId)).toEqual(['1', '2', '101']);
    expect(m.byGame.get('5001')).toMatchObject({ providerStatus: '1st Qtr', homeScore: 15, visitorScore: 7 });
    expect(m.unmatched).toBe(1);
    const dup = matchLiveBoxScores([liveBox([1], [1])], [stored(), stored({ gameId: '5002' })]);
    expect(dup.ambiguous).toBe(1);
    expect(dup.byGame.size).toBe(0);
  });

  it('verified_final needs provider-final evidence and passing statistical checks', () => {
    const boxOf = (row: unknown) => matchLiveBoxScores([row], [stored()]).byGame.get('5001')!;
    const box = boxOf(liveBox(FINAL_HOME, FINAL_VISITOR, { status: 'Final' }));
    const final = stored({ lifecycle: 'final', homeScore: 100, visitorScore: 98, finalObservedAt: TIP, terminalConfirmations: 2 });
    const after = at(MIN).toISOString();
    expect(verifyFinalBoxScore(final, box, after)).toEqual({ ok: true, failures: [] });
    expect(boxScoreCompleteness(final, box, after)).toBe('verified_final');

    const fails = (g: typeof final, b: typeof box, t = after) => verifyFinalBoxScore(g, b, t).failures;
    // Provider-final evidence.
    expect(fails({ ...final, terminalConfirmations: 1 }, box)).toContain('final not yet confirmed');
    expect(fails(final, box, at(-MIN).toISOString())).toContain('box observed before final');
    expect(fails(final, boxOf(liveBox(FINAL_HOME, FINAL_VISITOR, { status: '4th Qtr' })))).toContain('box status not final: 4th Qtr');
    expect(fails(final, boxOf(liveBox(FINAL_HOME, FINAL_VISITOR, { status: 'Final', home_team_score: 102 })))[0]).toMatch(/^box score 98-102 != final 98-100/);
    expect(fails({ ...final, homeScore: 101 }, box)).toContain('home: player points 100 != score 101');

    // Points sum to the score but a line is internally inconsistent: not verified.
    const bad = (mutate: (l: (typeof box.lines)[number]) => void) => {
      const b = structuredClone(box);
      mutate(b.lines[0]);
      return fails(final, b);
    };
    expect(bad((l) => { l.fgm = (l.fgm ?? 0) + 1; l.fga = (l.fga ?? 0) + 1; })).toContain('player 1: pts != 2*fgm + fg3m + ftm');
    expect(bad((l) => { l.fga = 0; })).toContain('player 1: fgm > fga');
    expect(bad((l) => { l.fg3a = 0; })).toContain('player 1: fg3m > fg3a');
    expect(bad((l) => { l.reb = 9; })).toContain('player 1: reb != oreb + dreb');
    expect(bad((l) => { l.ftm = null; })).toContain('player 1: missing ftm');
    expect(bad((l) => { l.min = 'DNP?'; })).toContain('player 1: unparseable min');
    expect(bad((l) => { l.min = '20'; })).toContain('home: minutes 212.0 != 240 ± 5');

    // Team checks: too few lines; overtime raises the minutes target.
    const short = { ...box, lines: box.lines.filter((l) => l.playerId !== '5') };
    expect(fails({ ...final, homeScore: 80 }, { ...short, homeScore: 80 })).toContain('home: 4 player lines < 5');
    expect(fails({ ...final, overtimePeriods: 1 }, box)).toContain('home: minutes 240.0 != 265 ± 5');

    expect(boxScoreCompleteness({ ...final, terminalConfirmations: 1 }, box, after)).toBe('final_unverified');
    expect(boxScoreCompleteness({ ...final, lifecycle: 'live' }, box, after)).toBe('live_partial');
    expect(boxScoreCompleteness(final, null, null)).toBe('none');
  });

  it('minutes parse as MM, MM:SS or decimal; blank is did-not-play', () => {
    expect(parseMinutes('34')).toBe(34);
    expect(parseMinutes('34:30')).toBe(34.5);
    expect(parseMinutes('12.5')).toBe(12.5);
    expect(parseMinutes(null)).toBe(0);
    expect(parseMinutes('')).toBe(0);
    expect(parseMinutes('34:75')).toBeNaN();
  });

  it('without a fresh box row, a final game keeps verified only if already verified', () => {
    expect(carriedBoxCompleteness({ lifecycle: 'final', boxCompleteness: 'verified_final' }, true)).toBe('verified_final');
    expect(carriedBoxCompleteness({ lifecycle: 'final', boxCompleteness: 'live_partial' }, true)).toBe('final_unverified');
    expect(carriedBoxCompleteness({ lifecycle: 'live', boxCompleteness: 'verified_final' }, true)).toBe('live_partial');
    expect(carriedBoxCompleteness({ lifecycle: 'final', boxCompleteness: 'verified_final' }, false)).toBe('none');
  });
});

describe('polling policy: no fixed cutoff, bounded safeguards', () => {
  it('no games: only schedule discovery, every 3 hours, never the live endpoint', () => {
    expect(planScoreboardTick({ now: at(0), games: [], lastGamesRequestAt: null }).gamesRequest?.reason).toBe('first_discovery');
    const quiet = planScoreboardTick({ now: at(0), games: [], lastGamesRequestAt: at(-60 * MIN).toISOString() });
    expect(quiet.gamesRequest).toBeNull();
    expect(quiet.boxRequest).toBeNull();
    const due = planScoreboardTick({ now: at(0), games: [], lastGamesRequestAt: at(-180 * MIN).toISOString() });
    expect(due.gamesRequest?.reason).toBe('discovery_due');
    expect(due.boxRequest).toBeNull();
  });

  it('a game discovered days ahead starts polling near tip, not before', () => {
    const g = stored();
    expect(nextPollingState(g, at(-60 * MIN))).toBe('pending');
    expect(planScoreboardTick({ now: at(-60 * MIN), games: [g], lastGamesRequestAt: at(-61 * MIN).toISOString() }).gamesRequest).toBeNull();
    expect(nextPollingState(g, at(-14 * MIN))).toBe('active');
    const p = planScoreboardTick({ now: at(-14 * MIN), games: [g], lastGamesRequestAt: at(-16 * MIN).toISOString() });
    expect(p.gamesRequest).not.toBeNull();
    expect(p.boxRequest).toBeNull();
  });

  it('live games poll every 60 s; quiet spells back off; nothing stops while the game keeps changing', () => {
    const live = (changedAgoMin: number, tipAgoMin: number, lifecycle: StoredScoreboardGame['lifecycle'] = 'live') => {
      const now = at(tipAgoMin * MIN);
      return { g: stored({ lifecycle, pollingState: 'active', lastChangedAt: at((tipAgoMin - changedAgoMin) * MIN).toISOString() }), now };
    };
    let c = live(1, 30);
    expect(activeCadenceMs(c.g, c.now)).toBe(60_000);
    c = live(12, 70, 'halftime');
    expect(activeCadenceMs(c.g, c.now)).toBe(SCOREBOARD_POLICY.QUIET_INTERVAL_MS);
    expect(needsLiveBox(c.g)).toBe(true);
    c = live(45, 120);
    expect(activeCadenceMs(c.g, c.now)).toBe(SCOREBOARD_POLICY.STALE_INTERVAL_MS);
    expect(nextPollingState(c.g, c.now)).toBe('active');
    c = live(1, 9 * 60, 'overtime');
    expect(nextPollingState(c.g, c.now)).toBe('active');
    expect(activeCadenceMs(c.g, c.now)).toBe(60_000);
  });

  it('a delayed tip keeps polling (2 min, then 5 min); quiet time counts from tip, not discovery', () => {
    const g = stored({ pollingState: 'active' });
    expect(nextPollingState(g, at(20 * MIN))).toBe('active');
    expect(activeCadenceMs(g, at(20 * MIN))).toBe(SCOREBOARD_POLICY.DELAYED_INTERVAL_MS);
    expect(nextPollingState(g, at(3 * 60 * MIN))).toBe('active');
    expect(activeCadenceMs(g, at(3 * 60 * MIN))).toBe(SCOREBOARD_POLICY.STALE_INTERVAL_MS);
  });

  it('safeguards: 6 h without any change, or 16 h after tip, stop polling as safety_stopped', () => {
    const quiet = stored({ lifecycle: 'live', pollingState: 'active', lastChangedAt: at(60 * MIN).toISOString() });
    expect(nextPollingState(quiet, at(6 * 60 * MIN + 59 * MIN))).toBe('active');
    expect(nextPollingState(quiet, at(7 * 60 * MIN))).toBe('safety_stopped');
    const busy = stored({ lifecycle: 'overtime', pollingState: 'active', lastChangedAt: at(16 * 60 * MIN - MIN).toISOString() });
    expect(nextPollingState(busy, at(16 * 60 * MIN))).toBe('safety_stopped');
    expect(nextPollingState({ ...busy, pollingState: 'safety_stopped' }, at(0))).toBe('safety_stopped');
  });

  it('completion needs two terminal observations and final player lines (or bounded attempts)', () => {
    const final = stored({ lifecycle: 'final', pollingState: 'active', lastChangedAt: at(150 * MIN).toISOString() });
    const now = at(151 * MIN);
    expect(nextPollingState({ ...final, terminalConfirmations: 1, boxCompleteness: 'verified_final' }, now)).toBe('active');
    expect(nextPollingState({ ...final, terminalConfirmations: 2, boxCompleteness: 'verified_final' }, now)).toBe('complete');
    expect(nextPollingState({ ...final, terminalConfirmations: 2, boxCompleteness: 'final_unverified', finalBoxAttempts: 1 }, now)).toBe('active');
    expect(needsLiveBox({ ...final, finalBoxAttempts: 1 })).toBe(true);
    expect(nextPollingState({ ...final, terminalConfirmations: 2, boxCompleteness: 'final_unverified', finalBoxAttempts: 3 }, now)).toBe('complete');
    expect(nextPollingState({ ...final, lifecycle: 'postponed', terminalConfirmations: 2 }, now)).toBe('complete');
  });
});

describe('collector cycle (fake fetch, memory store)', () => {
  it('frozen, missing flags, or regular-season-only config make zero BDL requests', async () => {
    for (const env of [{}, { ...LIVE_ENV, DATA_MODE: 'replay' }, { ...LIVE_ENV, SCOREBOARD_COLLECT_PRESEASON: undefined, SCOREBOARD_COLLECT_REGULAR: '1' }]) {
      const f = fakeFetchers({ games: () => [bdlGame()], box: () => [] });
      const r = await runScoreboardCycle({ env, store: createMemoryScoreboardStore(), fetch: f.fetch, now: at(0) });
      expect(r.status).toBe('skipped');
      expect(f.calls).toEqual([]);
    }
  });

  it('missing target season fails closed before any request', async () => {
    const f = fakeFetchers({ games: () => [bdlGame()], box: () => [] });
    const r = await runScoreboardCycle({ env: { ...LIVE_ENV, SCOREBOARD_TARGET_SEASON: '' }, store: createMemoryScoreboardStore(), fetch: f.fetch, now: at(0) });
    expect(r.status).toBe('failed');
    expect(f.calls).toEqual([]);
  });

  it('full preseason game: discovery, tip window, live with player lines, verified final, then quiet', async () => {
    const store = createMemoryScoreboardStore();
    let state: Record<string, unknown> = {};
    let box: unknown[] = [];
    const f = fakeFetchers({ games: () => [bdlGame(state)], box: () => box });
    const tick = (offsetMs: number) => {
      const now = at(offsetMs);
      return runScoreboardCycle({ env: LIVE_ENV, store, fetch: f.fetch, now, clock: () => now });
    };

    let r = await tick(-8 * 60 * MIN);
    expect(r.bdlRequests).toBe(1);
    expect(f.calls[0]).toBe(scoreboardGamesUrl({ season: 2026, seasonType: 'preseason', startDate: '2026-10-09', endDate: '2026-10-10' }));
    expect(store.games.get('5001')).toMatchObject({ seasonType: 'preseason', lifecycle: 'scheduled', pollingState: 'pending' });

    r = await tick(-8 * 60 * MIN + MIN);
    expect(r.bdlRequests).toBe(0);

    r = await tick(-14 * MIN);
    expect(r.bdlRequests).toBe(1);
    expect(store.games.get('5001')?.pollingState).toBe('active');

    state = { status_state: 'in_progress', status: '1st Qtr', period: 1, time: '6:00', home_team_score: 12, visitor_team_score: 10 };
    box = [liveBox([7, 5], [6, 4])];
    r = await tick(6 * MIN);
    expect(r.bdlRequests).toBe(2);
    expect(f.calls.at(-1)).toBe(scoreboardLiveBoxUrl('preseason'));
    expect(store.games.get('5001')).toMatchObject({ lifecycle: 'live', boxCompleteness: 'live_partial', homeScore: 12 });
    expect(store.lines.get('5001')).toHaveLength(4);

    r = await tick(6 * MIN + 30_000);
    expect(r.bdlRequests).toBe(0);

    state = { status_state: 'final', status: 'Final', period: 4, home_team_score: 100, visitor_team_score: 98 };
    box = [liveBox(FINAL_HOME, FINAL_VISITOR, { status: 'Final' })];
    r = await tick(140 * MIN);
    expect(r.bdlRequests).toBe(2);
    expect(store.games.get('5001')).toMatchObject({ lifecycle: 'final', boxCompleteness: 'final_unverified', terminalConfirmations: 1, pollingState: 'active' });
    expect(r.seasonTypes[0].box.unverified).toEqual([{ gameId: '5001', reason: 'final not yet confirmed' }]);

    // Second final observation confirms the final; the box is re-read and now verifies.
    r = await tick(141 * MIN);
    expect(r.bdlRequests).toBe(2);
    expect(store.games.get('5001')).toMatchObject({ boxCompleteness: 'verified_final', terminalConfirmations: 2, pollingState: 'complete' });
    expect(store.lines.get('5001')).toHaveLength(10);

    r = await tick(142 * MIN);
    expect(r.bdlRequests).toBe(0);
    expect(f.calls.every((u) => u.includes('season_type=preseason'))).toBe(true);
  });

  it('a failed or unarchived games request writes nothing', async () => {
    for (const games of [() => ({ status: 500 }), () => ({ blocked: 'ARCHIVE_FAILED (put)' })] as Respond[]) {
      const store = createMemoryScoreboardStore();
      const f = fakeFetchers({ games, box: () => [] });
      const r = await runScoreboardCycle({ env: LIVE_ENV, store, fetch: f.fetch, now: at(0) });
      expect(r.status).toBe('failed');
      expect(store.games.size).toBe(0);
      expect(store.gamesRequests.size).toBe(0);
    }
  });

  it('rows contradicting the preseason request are rejected and never stored', async () => {
    const store = createMemoryScoreboardStore();
    const f = fakeFetchers({
      games: () => [bdlGame(), bdlGame({ id: 5002, season_type: 'regular' }), bdlGame({ id: 5003, postseason: true })],
      box: () => [],
    });
    const r = await runScoreboardCycle({ env: LIVE_ENV, store, fetch: f.fetch, now: at(-60 * MIN) });
    expect([...store.games.keys()]).toEqual(['5001']);
    expect(r.seasonTypes[0].rejected.map((x) => x.gameId)).toEqual(['5002', '5003']);
  });
});

describe('Postgres display store (recording fake db)', () => {
  it('replaces player lines with one upsert plus a stale-player delete, all in display.*', async () => {
    const calls: Array<{ text: string; params: unknown[] }> = [];
    const db = {
      query: async (text: string, params: unknown[] = []) => {
        calls.push({ text, params });
        if (/^\s*SELECT game_id, player_id/.test(text)) {
          return { rows: [{ game_id: '5001', player_id: 1, team_id: 5, name: 'P 1', min: '48', pts: 20, reb: 3, ast: 1, fgm: 8, fga: 11, fg3m: 1, fg3a: 2, ftm: 1, fta: 2, oreb: 1, dreb: 2 }] };
        }
        return { rows: [] };
      },
    };
    const store = createPgScoreboardStore(db);
    const box = matchLiveBoxScores([liveBox(FINAL_HOME, FINAL_VISITOR, { status: 'Final' })], [stored()]).byGame.get('5001')!;
    await store.replacePlayerLines('5001', box.lines);
    expect(calls).toHaveLength(2);
    expect(calls[0].text).toMatch(/^INSERT INTO display\.scoreboard_player_lines/);
    expect(calls[0].text).toMatch(/ON CONFLICT \(game_id, player_id\) DO UPDATE/);
    expect(calls[0].params[0]).toBe('5001');
    expect(calls[0].params).toHaveLength(16);
    for (const arr of calls[0].params.slice(1)) expect(arr).toHaveLength(10);
    expect(calls[1].text).toMatch(/^DELETE FROM display\.scoreboard_player_lines WHERE game_id = \$1 AND NOT \(player_id = ANY/);
    expect(calls[1].params[1]).toEqual(box.lines.map((l) => l.playerId));
    expect(calls.every((c) => !/analytics\.|raw\./.test(c.text))).toBe(true);

    const [line] = await store.loadPlayerLines(['5001']);
    expect(line).toEqual({
      gameId: '5001', playerId: '1', teamId: '5', name: 'P 1', min: '48',
      pts: 20, reb: 3, ast: 1, fgm: 8, fga: 11, fg3m: 1, fg3a: 2, ftm: 1, fta: 2, oreb: 1, dreb: 2,
    });
  });
});

describe('GET /api/scoreboard', () => {
  const params = (q = '') => new URLSearchParams(q);

  it('serving disabled or invalid: 503, no data, no caching', async () => {
    for (const env of [{}, { SCOREBOARD_SERVING_ENABLED: 'yes' }]) {
      const r = await serveScoreboard({ env, params: params(), now: at(0), store: () => createMemoryScoreboardStore() });
      expect(r.status).toBe(503);
      expect(r.headers['Cache-Control']).toBe('no-store');
    }
  });

  it('unknown parameters, bad dates and bad season types are 400', async () => {
    const env = { SCOREBOARD_SERVING_ENABLED: '1' };
    for (const q of ['foo=1', 'date=2026-13-40', 'date=yesterday', 'season_type=summer']) {
      const r = await serveScoreboard({ env, params: params(q), now: at(0), store: () => createMemoryScoreboardStore() });
      expect(r.status, q).toBe(400);
    }
  });

  it('serves scoreboard.v1 from the display store with shared caching and staleness', async () => {
    const store = createMemoryScoreboardStore();
    await store.upsertGames([
      stored({ lifecycle: 'live', pollingState: 'active', lastObservedAt: at(10 * MIN).toISOString() }),
      stored({ gameId: '5002', lifecycle: 'final', pollingState: 'complete', lastObservedAt: at(-600 * MIN).toISOString() }),
    ]);
    const r = await serveScoreboard({
      env: { SCOREBOARD_SERVING_ENABLED: '1' },
      params: params('date=2026-10-09&season_type=preseason'),
      now: at(13 * MIN),
      store: () => store,
    });
    expect(r.status).toBe(200);
    expect(r.headers['Cache-Control']).toMatch(/s-maxage=15/);
    const body = r.body as { schema_version: string; stale: boolean; source: { coverage: string }; games: Array<Record<string, unknown>> };
    expect(body.schema_version).toBe('scoreboard.v1');
    expect(body.source.coverage).toBe('display_only');
    expect(body.games.every((g) => g.model_eligible === false && g.season_type === 'preseason')).toBe(true);
    expect(body.games.find((g) => g.game_id === '5001')).toMatchObject({ stale: true, stale_reason: 'no_recent_observation' });
    expect(body.games.find((g) => g.game_id === '5002')).toMatchObject({ stale: false });
    expect(body.stale).toBe(true);
  });

  it('store failure is 503, not an empty scoreboard', async () => {
    const r = await serveScoreboard({
      env: { SCOREBOARD_SERVING_ENABLED: '1' },
      params: params(),
      now: at(0),
      store: () => {
        throw new Error('db down');
      },
    });
    expect(r.status).toBe(503);
  });
});

describe('isolation: preseason observations cannot reach modeling tables', () => {
  const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      if (['node_modules', '.next', 'dist', '.package', 'build', '.terraform'].includes(name)) continue;
      const rel = `${dir}/${name}`;
      const st = fs.statSync(path.join(ROOT, rel));
      if (st.isDirectory()) walk(rel, out);
      else if (/\.(ts|tsx|mts|js|mjs)$/.test(name)) out.push(rel);
    }
    return out;
  };
  const scoreboardSources = [
    ...walk('lib/scoreboard').filter((f) => !f.includes('__tests__')),
    'app/api/scoreboard/route.ts',
    'lambda/scoreboard/index.ts',
    'lib/runtime/lambda-pg-pool.ts',
  ];

  it('scoreboard code references only the display schema, never analytics/raw tables or model modules', () => {
    const withoutComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const f of scoreboardSources) {
      const src = read(f);
      const code = withoutComments(src);
      expect(code, f).not.toMatch(/\banalytics\.[a-z_]+|\braw\.(?:games|players|teams|player_\w+)\b|player_game_logs/);
      expect(code, f).not.toMatch(/@\/lib\/(betting\/projection|wowy|backtesting|context-projection|context-center|players|analytics|postgame)/);
      for (const m of src.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN|TABLE)\s+([a-z_]+)\.[a-z_]+/gi)) {
        expect(m[1], `${f}: ${m[0]}`).toBe('display');
      }
    }
    for (const f of ['lib/scoreboard/store.ts', 'lib/scoreboard/collector.ts']) {
      const code = withoutComments(read(f));
      expect(code, f).not.toMatch(/\banalytics\.|player_game_logs|projection_ledger/);
    }
  });

  it('nothing outside the scoreboard reads display tables or imports scoreboard modules', () => {
    const presentationImport = /@\/lib\/scoreboard\/(client|contract|slate-merge|present)\b/;
    const others = ['lib', 'app', 'lambda', 'scripts']
      .flatMap((d) => walk(d))
      .filter((f) => !f.includes('/__tests__/'))
      .filter((f) => !f.startsWith('lib/scoreboard/') && !f.startsWith('lambda/scoreboard/') && f !== 'app/api/scoreboard/route.ts');
    for (const f of others) {
      const src = read(f);
      expect(src, f).not.toMatch(/display\.scoreboard_/);
      if (f === 'app/dashboard/page.tsx') {
        for (const imp of src.matchAll(/@\/lib\/scoreboard\/[A-Za-z0-9_-]+/g)) {
          expect(imp[0], f).toMatch(presentationImport);
        }
        expect(src, f).not.toMatch(/@\/lib\/scoreboard\/(collector|store|lambda|flags|normalize|planner)\b/);
        continue;
      }
      expect(src, f).not.toMatch(/lib\/scoreboard/);
    }
  });

  it('the website path never calls BDL: the route and serve logic import no provider or collector code', () => {
    for (const f of ['app/api/scoreboard/route.ts', 'lib/scoreboard/serve.ts', 'lib/scoreboard/response.ts', 'lib/scoreboard/store.ts']) {
      const src = read(f);
      expect(src, f).not.toMatch(/balldontlie|status-sync-acquisition|live-rate-limit|\.\/collector|\.\/lambda|fetch\(/);
    }
  });

  it('the prepared migration is display-only and not wired to analytics', () => {
    const sql = read('db/schemas/MIGRATION_display_scoreboard.sql');
    expect(sql).toMatch(/PREPARED ONLY \/ NOT APPLIED/);
    expect(sql).not.toMatch(/\banalytics\./);
    expect(sql).toMatch(/season_type_source\s+text not null check \(season_type_source = 'request_season_type'\)/);
    for (const m of sql.matchAll(/create table if not exists ([a-z_]+)\./g)) expect(m[1]).toBe('display');
  });

  it('game-status-sync cannot request preseason (boundary in the planner)', () => {
    const src = read('lib/games/status-sync-query.ts');
    expect(src).toContain("new Set(['regular', 'playin', 'playoffs'])");
    expect(src).not.toMatch(/PRESEASON_DISCOVERY/);
  });
});
