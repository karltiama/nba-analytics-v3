import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROPS_DAILY_HTTP_ATTEMPT_CAP } from '../attempt-budget';
import {
  bestBaseline,
  broadWaveAt,
  BROAD_BASELINE_EVIDENCE_SQL,
  classifyBaseline,
  closingGamesBeforeTip,
  closingLastResponseMs,
  planBroadWave,
  simulateEarlyDay,
  stampFromRows,
  type BaselineObservation,
  type EarlyDayGame,
  type WaveBoard,
} from '../early-baseline';
import { easternWallTimeToUtc, planPregameRefresh } from '../pregame-refresh';

const DATE = '2026-11-24';
const TIP = easternWallTimeToUtc(DATE, 19, 0);
const MORNING = easternWallTimeToUtc(DATE, 8, 0);
const NOON = easternWallTimeToUtc(DATE, 12, 0);
const AFTERNOON = easternWallTimeToUtc(DATE, 14, 0);

function observation(overrides: Partial<BaselineObservation> = {}): BaselineObservation {
  return {
    gameId: '101',
    status: 'success',
    archiveStatus: 'archived',
    rowsFetched: 100,
    rowsArchived: 100,
    rowsStored: 0,
    stamp: { books: 4, dkMarkets: 8, dkTwoSided: 5 },
    ...overrides,
  };
}

function games(count: number, tipMs: number, board: WaveBoard): EarlyDayGame[] {
  return Array.from({ length: count }, (_, index) => ({
    gameId: String(1000 + index),
    tipMs,
    morning: board,
    midday: board,
    afternoon: board,
  }));
}

function plan(args: {
  nowMs: number;
  tipMs?: number;
  evidence?: BaselineObservation[];
  consumedAttempts?: number;
  closingGames?: number;
  nearTipGames?: number;
  started?: boolean;
}) {
  return planBroadWave({
    nowMs: args.nowMs,
    games: [{ gameId: '101', tipMs: args.tipMs ?? TIP }],
    evidence: args.evidence ?? [],
    runs: args.started
      ? [{ gameId: '101', universe: 'broad', status: 'started', errorMessage: null, startedAtMs: args.nowMs, providerAttempts: 1 }]
      : [],
    consumedAttempts: args.consumedAttempts ?? 0,
    planningPages: 1,
    inFlight: [],
    closingGames: args.closingGames ?? 1,
    nearTipGames: args.nearTipGames ?? 1,
    storage: 'admit',
  });
}

describe('early baseline policy', () => {
  it('keeps 8:00, 12:00, and 14:00 on the existing broad waves', () => {
    expect(broadWaveAt(new Date(MORNING))).toBe('morning');
    expect(broadWaveAt(new Date(NOON))).toBe('midday');
    expect(broadWaveAt(new Date(AFTERNOON))).toBe('afternoon');
  });

  it('treats a useful DraftKings board at 8 AM as the baseline', () => {
    const first = plan({ nowMs: MORNING });
    expect(first.admit).toEqual(['101']);
    const repeat = plan({ nowMs: MORNING, evidence: [observation()] });
    expect(repeat.admit).toEqual([]);
    expect(repeat.skipped).toEqual([{ gameId: '101', reason: 'usable_baseline' }]);
  });

  it('does not treat an empty 8 AM board as a usable baseline', () => {
    const empty = observation({ rowsFetched: 0, rowsArchived: 0, stamp: { books: 0, dkMarkets: 0, dkTwoSided: 0 } });
    expect(classifyBaseline(empty)).toBe('empty_board');
    const noon = plan({ nowMs: NOON, evidence: [empty] });
    expect(noon.admit).toEqual(['101']);
  });

  it('retries at noon after an empty morning and then stops', () => {
    const day = simulateEarlyDay({
      etDate: DATE,
      games: [{ gameId: '101', tipMs: TIP, morning: 'empty', midday: 'usable', afternoon: 'usable' }],
      planningPages: 1,
      actualPages: 1,
    });
    expect(day.broad.filter((item) => item.admitted).map((item) => item.wave)).toEqual(['morning', 'midday']);
    expect(day.broad.find((item) => item.wave === 'afternoon')?.reason).toBe('usable_baseline');
  });

  it('keeps collecting until DraftKings markets exist at 2 PM', () => {
    const day = simulateEarlyDay({
      etDate: DATE,
      games: [{ gameId: '101', tipMs: TIP, morning: 'no_dk', midday: 'no_dk', afternoon: 'usable' }],
      planningPages: 1,
      actualPages: 1,
    });
    expect(day.broad.filter((item) => item.admitted)).toHaveLength(3);
    expect(day.broad.find((item) => item.wave === 'afternoon')?.quality).toBe('no_draftkings');
  });

  it('retries after an incomplete early archive', () => {
    expect(classifyBaseline(observation({ status: 'error', archiveStatus: 'failed', stamp: null }))).toBe('failed');
    const noon = plan({
      nowMs: NOON,
      evidence: [observation({ status: 'error', archiveStatus: 'failed', rowsFetched: 0, rowsArchived: 0, stamp: null })],
    });
    expect(noon.admit).toEqual(['101']);
  });

  it('retries a complete archive that has no two-sided DraftKings market', () => {
    const oneSided = observation({ stamp: { books: 2, dkMarkets: 3, dkTwoSided: 0 } });
    expect(classifyBaseline(oneSided)).toBe('draftkings_without_two_sided');
    expect(plan({ nowMs: NOON, evidence: [oneSided] }).admit).toEqual(['101']);
    const noDk = observation({ stamp: { books: 2, dkMarkets: 0, dkTwoSided: 0 } });
    expect(classifyBaseline(noDk)).toBe('no_draftkings');
  });

  it('skips noon and afternoon after a successful baseline', () => {
    const day = simulateEarlyDay({
      etDate: DATE,
      games: games(1, TIP, 'usable'),
      planningPages: 1,
      actualPages: 1,
    });
    expect(day.broadAttempts).toBe(1);
    expect(day.broad.filter((item) => item.wave !== 'morning').every((item) => item.reason === 'usable_baseline')).toBe(true);
  });

  it('lets the midday fallback become the usable baseline', () => {
    const day = simulateEarlyDay({
      etDate: DATE,
      games: [{ gameId: '101', tipMs: TIP, morning: 'empty', midday: 'usable', afternoon: 'usable' }],
      planningPages: 1,
      actualPages: 1,
    });
    expect(day.broad.find((item) => item.wave === 'midday')).toMatchObject({ admitted: true, quality: 'empty_board' });
    expect(day.broad.find((item) => item.wave === 'afternoon')?.reason).toBe('usable_baseline');
  });

  it('does not broad-fetch a game already inside the T-120 window', () => {
    const tip = easternWallTimeToUtc(DATE, 16, 0);
    const afternoon = plan({ nowMs: AFTERNOON, tipMs: tip });
    expect(afternoon.admit).toEqual([]);
    expect(afternoon.skipped[0]?.reason).toBe('pregame_window');
  });

  it('gives the 2 PM observation to refresh when broad and refresh overlap', () => {
    const tip = easternWallTimeToUtc(DATE, 16, 0);
    const day = simulateEarlyDay({
      etDate: DATE,
      games: [{ gameId: '101', tipMs: tip, morning: 'usable', midday: 'usable', afternoon: 'usable' }],
      planningPages: 1,
      actualPages: 1,
    });
    expect(day.broad.find((item) => item.wave === 'afternoon')?.reason).toBe('pregame_window');
    const refreshAtTwo = day.pregame.collections.filter(
      (item) => item.universe === 'pregame_refresh' && item.tickMs === AFTERNOON && item.success
    );
    expect(refreshAtTwo.map((item) => item.gameId)).toEqual(['101']);
  });

  it('does not admit a second morning collection after the baseline exists', () => {
    const first = plan({ nowMs: MORNING });
    const second = plan({ nowMs: MORNING + 60_000, evidence: [observation()] });
    expect(first.admit).toEqual(['101']);
    expect(second.admit).toEqual([]);
    expect(second.skipped[0]?.reason).toBe('usable_baseline');
  });

  it('does not admit a game whose run is still started', () => {
    const blocked = plan({ nowMs: NOON, started: true });
    expect(blocked.admit).toEqual([]);
    expect(blocked.skipped).toEqual([{ gameId: '101', reason: 'started_run' }]);
  });

  it('drops the afternoon fallback before it spends the closing hold', () => {
    const pressed = planBroadWave({
      nowMs: AFTERNOON,
      games: [{ gameId: '101', tipMs: TIP }],
      evidence: [],
      runs: [],
      consumedAttempts: 294,
      planningPages: 1,
      inFlight: [],
      closingGames: 2,
      nearTipGames: 0,
      storage: 'admit',
    });
    expect(pressed.chargePages).toBe(3);
    expect(pressed.admit).toEqual([]);
    expect(pressed.skipped[0]?.reason).toBe('closing_reserve');
    const refresh = planPregameRefresh({
      nowMs: AFTERNOON,
      candidates: [{ gameId: '101', tipMs: easternWallTimeToUtc(DATE, 16, 0), status: 'scheduled', lastSuccessAtMs: null }],
      runs: [],
      consumedAttempts: 294,
      planningPages: 1,
      inFlight: [],
      closingGames: 2,
      nearTipGames: 0,
      storage: 'admit',
    });
    expect(refresh.admit).toEqual([]);
    expect(refresh.skipped[0]?.reason).toBe('closing_reserve');
    expect(294 + 2 * pressed.chargePages).toBe(PROPS_DAILY_HTTP_ATTEMPT_CAP);
  });

  it('keeps a 3, 10, and 15 game slate inside 300 attempts for one through four pages', () => {
    for (const count of [3, 10, 15]) {
      for (const pages of [1, 2, 3, 4] as const) {
        const day = simulateEarlyDay({
          etDate: DATE,
          games: games(count, TIP, 'usable'),
          planningPages: 1,
          actualPages: pages,
        });
        expect(day.attempts).toBeLessThanOrEqual(300);
        expect(day.broadAttempts).toBe(count * pages);
        expect(day.broad.filter((item) => item.wave === 'morning' && item.admitted)).toHaveLength(count);
        expect(day.pregame.closingCollections + day.pregame.closingShortfall).toBe(count);
        if (pages <= 3) expect(day.pregame.closingCollections).toBe(count);
        if (count === 3 && pages === 1) expect(day.attempts).toBe(27);
        if (count === 10 && pages === 1) expect(day.attempts).toBe(90);
        if (count === 10 && pages === 3) expect(day.attempts).toBe(270);
        if (count === 15 && pages === 1) expect(day.attempts).toBe(135);
        if (count === 15 && pages === 2) expect(day.attempts).toBe(270);
        if (count === 15 && pages === 1) expect(day.pregame.refreshCollections).toBe(90);
        if (count === 15 && pages === 3) {
          expect(day.pregame.refreshCollections).toBe(55);
          expect(day.attempts).toBe(300);
        }
        if (count === 15 && pages === 4) {
          expect(day.pregame.refreshCollections).toBe(30);
          expect(day.pregame.nearTipCollections).toBe(15);
          expect(day.pregame.closingCollections).toBe(11);
          expect(day.pregame.closingShortfall).toBe(4);
        }
      }
    }
    const retry = simulateEarlyDay({
      etDate: DATE,
      games: Array.from({ length: 15 }, (_, index) => ({
        gameId: String(2000 + index),
        tipMs: TIP,
        morning: 'empty' as const,
        midday: 'no_dk' as const,
        afternoon: 'usable' as const,
      })),
      planningPages: 1,
      actualPages: 3,
    });
    expect(retry.broadAttempts).toBe(135);
    expect(retry.pregame.refreshCollections).toBe(25);
    expect(retry.pregame.nearTipCollections).toBe(15);
    expect(retry.pregame.closingCollections).toBe(15);
    expect(retry.attempts).toBe(300);
  });

  it('does not call a delayed post-tip response a verified closing quote', () => {
    const day = simulateEarlyDay({
      etDate: DATE,
      games: games(1, TIP, 'usable'),
      planningPages: 1,
      actualPages: 1,
      workerDelayMs: 11 * 60_000,
    });
    const closings = day.pregame.collections.filter((item) => item.universe === 'closing');
    expect(closings.length).toBeGreaterThan(0);
    expect(closings.every((item) => item.success === false)).toBe(true);
    expect(day.pregame.closingCollections).toBe(0);
  });

  it('shows a 15-game three-page closing wave fits only the request spacing', () => {
    expect(closingGamesBeforeTip({ msUntilTip: 10 * 60_000, pages: 3 })).toBe(15);
    expect(closingGamesBeforeTip({ msUntilTip: 10 * 60_000, pages: 4 })).toBe(11);
    expect(15 * 3 * 13_000).toBe(585_000);
    expect(10 * 60_000 - 585_000).toBe(15_000);
  });

  it('keeps the same broad decision when an 8 AM invocation is delayed', () => {
    const evidence = [observation()];
    const morning = plan({ nowMs: MORNING + 40 * 60_000, evidence });
    const noon = plan({ nowMs: NOON + 40 * 60_000, evidence });
    const afternoon = plan({ nowMs: AFTERNOON + 40 * 60_000, evidence });
    expect(morning.skipped[0]?.reason).toBe('usable_baseline');
    expect(noon.skipped[0]?.reason).toBe('usable_baseline');
    expect(afternoon.skipped[0]?.reason).toBe('usable_baseline');
    const lateNearTip = plan({ nowMs: AFTERNOON, tipMs: easternWallTimeToUtc(DATE, 16, 0), evidence });
    expect(lateNearTip.skipped[0]?.reason).toBe('pregame_window');
  });

  it('retries only the games that missed, not the whole slate', () => {
    const day = simulateEarlyDay({
      etDate: DATE,
      games: [
        { gameId: '1', tipMs: TIP, morning: 'usable', midday: 'usable', afternoon: 'usable' },
        { gameId: '2', tipMs: TIP, morning: 'empty', midday: 'usable', afternoon: 'usable' },
        { gameId: '3', tipMs: TIP, morning: 'incomplete', midday: 'no_dk', afternoon: 'usable' },
      ],
      planningPages: 1,
      actualPages: 1,
    });
    const admitted = (wave: 'morning' | 'midday' | 'afternoon') =>
      day.broad.filter((item) => item.wave === wave && item.admitted).map((item) => item.gameId);
    expect(admitted('morning')).toEqual(['1', '2', '3']);
    expect(admitted('midday')).toEqual(['2', '3']);
    expect(admitted('afternoon')).toEqual(['3']);
  });

  it('reports which closing slates finish before tip once response time is included', () => {
    const windowMs = 10 * 60_000;
    const cases = [3, 5, 10, 15].flatMap((games) =>
      [1, 2, 3, 4].map((pages) => ({
        games,
        pages,
        lastMs: closingLastResponseMs({ games, pages, responseMs: 0 }),
      }))
    );
    expect(cases.find((item) => item.games === 15 && item.pages === 3)?.lastMs).toBe(44 * 13_000);
    expect(cases.find((item) => item.games === 15 && item.pages === 4)?.lastMs).toBeGreaterThan(windowMs);
    expect(cases.filter((item) => item.lastMs < windowMs).map((item) => `${item.games}x${item.pages}`)).toEqual([
      '3x1', '3x2', '3x3', '3x4',
      '5x1', '5x2', '5x3', '5x4',
      '10x1', '10x2', '10x3', '10x4',
      '15x1', '15x2', '15x3',
    ]);
    const withOneSecondResponse = closingLastResponseMs({ games: 15, pages: 3, responseMs: 1_000, queueDelayMs: 30_000 });
    expect(withOneSecondResponse).toBeGreaterThan(windowMs);
    expect(closingLastResponseMs({ games: 15, pages: 3 })).toBe(closingLastResponseMs({ games: 15, pages: 3, responseMs: 0 }));
  });

  it('admits nothing when the daily attempt ledger is exhausted', () => {
    const exhausted = plan({ nowMs: MORNING, consumedAttempts: 300, closingGames: 0, nearTipGames: 0 });
    expect(exhausted.admit).toEqual([]);
    expect(exhausted.skipped[0]?.reason).toBe('budget');
  });

  it('does not read rows_stored as market coverage', () => {
    expect(classifyBaseline(observation({ rowsStored: 0 }))).toBe('usable');
    expect(classifyBaseline(observation({ rowsFetched: 0, rowsArchived: 0, rowsStored: 40, stamp: null }))).toBe('empty_board');
    expect(classifyBaseline(observation({ rowsStored: 0, stamp: null }))).toBe('coverage_unknown');
    const stamp = stampFromRows([
      { sportsbook: 'draftkings', market_type: 'over_under', side: 'over', player_id: 7, prop_type: 'points', line_value: 10.5 },
      { sportsbook: 'draftkings', market_type: 'over_under', side: 'under', player_id: 7, prop_type: 'points', line_value: 10.5 },
      { sportsbook: 'fanduel', market_type: 'over_under', side: 'over', player_id: 7, prop_type: 'points', line_value: 10.5 },
    ]);
    expect(stamp).toEqual({ books: 2, dkMarkets: 2, dkTwoSided: 1 });
  });

  it('still fallbacks an off-quarter tip that is outside the refresh window', () => {
    const outside = plan({ nowMs: AFTERNOON, tipMs: easternWallTimeToUtc(DATE, 16, 7) });
    const inside = plan({ nowMs: AFTERNOON, tipMs: easternWallTimeToUtc(DATE, 16, 0) });
    expect(outside.admit).toEqual(['101']);
    expect(inside.skipped[0]?.reason).toBe('pregame_window');
  });

  it('treats missing historical coverage as unknown and does not call it usable', () => {
    expect(classifyBaseline(null)).toBe('no_observation');
    expect(bestBaseline([])).toBe('no_observation');
    const unknown = observation({ stamp: null });
    expect(classifyBaseline(unknown)).toBe('coverage_unknown');
    expect(plan({ nowMs: NOON, evidence: [unknown] }).admit).toEqual(['101']);
    expect(BROAD_BASELINE_EVIDENCE_SQL).toContain('metadata');
    expect(BROAD_BASELINE_EVIDENCE_SQL).not.toContain('CREATE TABLE');
    const migration = readFileSync('db/schemas/MIGRATION_player_prop_pregame_refresh_universe.sql', 'utf8');
    expect(migration).toContain('pregame_refresh');
    expect(migration).not.toContain('dk_two_sided');
  });
});
