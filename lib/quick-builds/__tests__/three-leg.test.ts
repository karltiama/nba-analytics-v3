import { describe, expect, it } from 'vitest';
import { combinedAmericanOdds } from '@/lib/parlay-xray/combined-odds';
import { combinedDecimal } from '@/lib/parlay/true-cost';
import { searchThreeLegCandidates } from '../generate-triples';
import { selectTripleShortlist, type RankedTriple } from '../rank';
import type { SideQuote } from '../markets';
import { buildTwoSidedMarkets } from '../markets';
import {
  generateQuickBuilds,
  QUICK_BUILD_THREE_LEG_PRESETS,
  QUICK_BUILD_TRIPLE_PROBE_BUDGET,
  type GamePullAttempt,
  type MarketObservationInput,
  type QuickBuildRequest,
} from '../index';

const ASOF = '2026-11-10T23:06:28.431Z';
const OBS = '2026-11-10T19:00:30.000Z';
const TIP = '2026-11-11T00:30:00.000Z';

function success(gameId: string): GamePullAttempt {
  return {
    pullRunId: '681',
    gameId,
    status: 'success',
    rowsStored: 4,
    completedAt: OBS,
    observationClock: 'RESPONSE_RECEIVED',
  };
}

function ou(input: {
  playerId: string;
  gameId: string;
  market?: string;
  line?: number;
  over: number;
  under: number;
  sportsbook?: string;
}): MarketObservationInput[] {
  return (['over', 'under'] as const).map((side) => ({
    playerId: input.playerId,
    gameId: input.gameId,
    market: input.market ?? 'points',
    side,
    line: input.line ?? 20.5,
    sportsbook: input.sportsbook ?? 'draftkings',
    oddsAmerican: side === 'over' ? input.over : input.under,
    pullRunId: '681',
    observedAt: OBS,
    observationClock: 'RESPONSE_RECEIVED' as const,
  }));
}

function request(overrides: Partial<QuickBuildRequest> & Pick<QuickBuildRequest, 'observations' | 'games'>): QuickBuildRequest {
  return {
    sportsbook: 'draftkings',
    range: QUICK_BUILD_THREE_LEG_PRESETS.midrange,
    policy: { mode: 'research_snapshot', asOf: ASOF },
    attempts: overrides.games.map((game) => success(game.gameId)),
    legCount: 3,
    ...overrides,
  };
}

describe('three-leg quick builds', () => {
  it('keeps an omitted leg count on the two-leg path', () => {
    const two = generateQuickBuilds({
      sportsbook: 'draftkings',
      range: { minAmerican: -110, maxAmerican: 125 },
      policy: { mode: 'research_snapshot', asOf: ASOF },
      games: [
        { gameId: 'g1', startTime: TIP, status: TIP },
        { gameId: 'g2', startTime: TIP, status: TIP },
      ],
      attempts: [success('g1'), success('g2')],
      observations: [
        ...ou({ playerId: 'a', gameId: 'g1', over: -200, under: -200 }),
        ...ou({ playerId: 'b', gameId: 'g2', over: -200, under: -200 }),
      ],
    });
    const explicit = generateQuickBuilds({
      sportsbook: 'draftkings',
      range: { minAmerican: -110, maxAmerican: 125 },
      policy: { mode: 'research_snapshot', asOf: ASOF },
      legCount: 2,
      games: [
        { gameId: 'g1', startTime: TIP, status: TIP },
        { gameId: 'g2', startTime: TIP, status: TIP },
      ],
      attempts: [success('g1'), success('g2')],
      observations: [
        ...ou({ playerId: 'a', gameId: 'g1', over: -200, under: -200 }),
        ...ou({ playerId: 'b', gameId: 'g2', over: -200, under: -200 }),
      ],
    });
    expect(explicit).toEqual(two);
    expect(two.searchComplete).toBeUndefined();
    expect(two.builds[0]?.legs).toHaveLength(2);
    expect(two.priceNotice).toContain('two leg prices');
  });

  it('includes an exact payout boundary and excludes the next price', () => {
    const games = ['g1', 'g2', 'g3'].map((gameId) => ({ gameId, startTime: TIP, status: TIP }));
    const observations = [
      ...ou({ playerId: 'a', gameId: 'g1', over: -115, under: -115 }),
      ...ou({ playerId: 'b', gameId: 'g2', over: -115, under: -115 }),
      ...ou({ playerId: 'c', gameId: 'g3', over: -115, under: -115 }),
    ];
    const exact = combinedAmericanOdds([-115, -115, -115]);
    expect(exact).not.toBeNull();
    const inside = generateQuickBuilds(request({
      games,
      observations,
      range: { minAmerican: exact!, maxAmerican: exact! },
    }));
    expect(inside.builds.some((build) => build.combinedAmerican === exact)).toBe(true);
    const outside = generateQuickBuilds(request({
      games,
      observations,
      range: { minAmerican: exact! + 1, maxAmerican: exact! + 1 },
    }));
    expect(outside.builds.every((build) => build.combinedAmerican !== exact)).toBe(true);
    if (outside.builds.length === 0) {
      expect(['NO_COMBINATIONS_IN_BAND', 'SEARCH_BUDGET_REACHED']).toContain(outside.emptyReason);
      if (outside.emptyReason === 'NO_COMBINATIONS_IN_BAND') expect(outside.searchComplete).toBe(true);
      if (outside.emptyReason === 'SEARCH_BUDGET_REACHED') expect(outside.searchComplete).toBe(false);
    }
  });

  it('returns three different games, players, and in-band prices', () => {
    const observations = [
      ...ou({ playerId: 'a', gameId: 'g1', market: 'points', over: -115, under: -115 }),
      ...ou({ playerId: 'b', gameId: 'g2', market: 'rebounds', over: -115, under: -115 }),
      ...ou({ playerId: 'c', gameId: 'g3', market: 'assists', over: -115, under: -115 }),
      ...ou({ playerId: 'd', gameId: 'g1', market: 'threes', over: -120, under: -110, sportsbook: 'fanduel' }),
    ];
    const result = generateQuickBuilds(request({
      games: ['g1', 'g2', 'g3'].map((gameId) => ({ gameId, startTime: TIP, status: TIP })),
      observations,
    }));
    expect(result.status).toBe('ok');
    expect(result.searchComplete).toBe(false);
    expect(result.builds.length).toBeGreaterThan(0);
    expect(result.builds.length).toBeLessThanOrEqual(5);
    for (const build of result.builds) {
      expect(build.legs).toHaveLength(3);
      expect(new Set(build.legs.map((leg) => leg.playerId)).size).toBe(3);
      expect(new Set(build.legs.map((leg) => leg.gameId)).size).toBe(3);
      expect(build.legs.every((leg) => leg.sportsbook === 'draftkings')).toBe(true);
      expect(build.legs.every((leg) => leg.observedAt === OBS)).toBe(true);
      const prices = build.legs.map((leg) => leg.oddsAmerican);
      expect(combinedAmericanOdds(prices)).toBe(build.combinedAmerican);
      expect(build.combinedAmerican).toBeGreaterThanOrEqual(400);
      expect(build.combinedAmerican).toBeLessThanOrEqual(699);
      const decimal = combinedDecimal(prices);
      expect(decimal).not.toBeNull();
      expect(build.breakEvenProbability).toBeCloseTo(1 / decimal!, 10);
      expect(Math.max(...build.legs.map((leg) => leg.ageMs))).toBe(build.maxAgeMs);
    }
  });

  it('needs three games and does not call that an empty payout band', () => {
    const result = generateQuickBuilds(request({
      games: ['g1', 'g2'].map((gameId) => ({ gameId, startTime: TIP, status: TIP })),
      observations: [
        ...ou({ playerId: 'a', gameId: 'g1', over: -115, under: -115 }),
        ...ou({ playerId: 'b', gameId: 'g2', over: -115, under: -115 }),
      ],
    }));
    expect(result.emptyReason).toBe('NO_CROSS_GAME');
    expect(result.builds).toEqual([]);
  });

  it('is stable when observation order changes and stops at the probe budget', () => {
    const games = ['g1', 'g2', 'g3', 'g4'].map((gameId) => ({ gameId, startTime: TIP, status: TIP }));
    const observations = games.flatMap((game, gameIndex) => (
      ['a', 'b', 'c', 'd'].flatMap((player, playerIndex) => ou({
        playerId: `${player}${gameIndex}`,
        gameId: game.gameId,
        market: playerIndex % 2 === 0 ? 'points' : 'assists',
        over: -110 - playerIndex,
        under: -110,
      }))
    ));
    const forward = generateQuickBuilds(request({ games, observations }));
    const reverse = generateQuickBuilds(request({ games, observations: observations.slice().reverse() }));
    expect(reverse.builds.map((build) => build.id)).toEqual(forward.builds.map((build) => build.id));

    const markets = buildTwoSidedMarkets({
      observations: observations.map((row) => ({ ...row, line: Number(row.line) })),
      sportsbook: 'draftkings',
      asOfMs: Date.parse(ASOF),
    });
    const started = Date.now();
    const limited = searchThreeLegCandidates(markets, QUICK_BUILD_THREE_LEG_PRESETS.midrange, 25);
    const elapsed = Date.now() - started;
    expect(limited.probes).toBeLessThanOrEqual(25);
    expect(limited.complete).toBe(false);
    expect(elapsed).toBeLessThan(1000);
    if (limited.triples.length === 0) {
      const empty = generateQuickBuilds(request({
        games,
        observations,
        range: { minAmerican: 100, maxAmerican: 101 },
      }));
      expect(['NO_COMBINATIONS_IN_BAND', 'SEARCH_BUDGET_REACHED']).toContain(empty.emptyReason);
    }
    expect(QUICK_BUILD_TRIPLE_PROBE_BUDGET).toBeGreaterThan(25);
  });

  it('does not invent a build when the budget stops before any in-band triple', () => {
    const games = Array.from({ length: 8 }, (_, index) => ({
      gameId: `g${index}`,
      startTime: TIP,
      status: TIP,
    }));
    const observations = games.flatMap((game) => (
      ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((player) => ou({
        playerId: `${player}-${game.gameId}`,
        gameId: game.gameId,
        over: -110,
        under: -110,
      }))
    ));
    const markets = buildTwoSidedMarkets({
      observations: observations.map((row) => ({ ...row, line: Number(row.line) })),
      sportsbook: 'draftkings',
      asOfMs: Date.parse(ASOF),
    });
    const started = Date.now();
    const search = searchThreeLegCandidates(markets, QUICK_BUILD_THREE_LEG_PRESETS.midrange, 0);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(search.probes).toBe(0);
    expect(search.triples).toEqual([]);
    expect(search.complete).toBe(false);
  });

  it('keeps a varied shortlist inside the quality window', () => {
    const side = (playerId: string, gameId: string, market: SideQuote['market'], line = 10.5): SideQuote => ({
      playerId,
      gameId,
      market,
      side: 'over',
      line,
      sportsbook: 'draftkings',
      oddsAmerican: -110,
      oppositeAmerican: -110,
      noVigProbability: 0.5,
      pullRunId: '681',
      observedAt: OBS,
      ageMs: 1,
    });
    const triple = (
      id: string,
      legs: [SideQuote, SideQuote, SideQuote],
      distance: number,
    ): RankedTriple => ({
      id,
      legs,
      combinedAmerican: 550,
      breakEvenProbability: 0.15,
      distanceToMidpoint: distance,
      nearKey: legs.map((leg) => `${leg.playerId}|${leg.market}|${leg.side}`).sort().join('~'),
      gameSet: legs.map((leg) => leg.gameId).sort().join('|'),
      tieKey: id,
    });
    const close = triple('close-points', [
      side('p1', 'g1', 'points'),
      side('p2', 'g2', 'points'),
      side('p3', 'g3', 'points'),
    ], 0.01);
    const repeat = triple('repeat-line', [
      side('p1', 'g1', 'points', 12.5),
      side('p2', 'g2', 'points', 12.5),
      side('p3', 'g3', 'points', 12.5),
    ], 0.02);
    const varied = triple('varied', [
      side('p4', 'g4', 'rebounds'),
      side('p5', 'g5', 'assists'),
      side('p6', 'g6', 'threes'),
    ], 0.2);
    const far = triple('far', [
      side('p7', 'g7', 'points'),
      side('p8', 'g8', 'rebounds'),
      side('p9', 'g9', 'assists'),
    ], 50);
    const selected = selectTripleShortlist([far, repeat, close, varied], 2, QUICK_BUILD_THREE_LEG_PRESETS.midrange);
    expect(selected.map((row) => row.id)).toEqual(['close-points', 'varied']);
    expect(selected.some((row) => row.id === 'far')).toBe(false);
    expect(selected.some((row) => row.id === 'repeat-line')).toBe(false);
  });

  it('stops a wide synthetic board at the probe budget', () => {
    const games = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'].map((gameId) => ({ gameId, startTime: TIP, status: TIP }));
    const observations = games.flatMap((game) => (
      Array.from({ length: 30 }, (_, index) => `p${index}`).flatMap((player) => ou({
        playerId: `${player}-${game.gameId}`,
        gameId: game.gameId,
        over: -110,
        under: -110,
      }))
    ));
    const markets = buildTwoSidedMarkets({
      observations: observations.map((row) => ({ ...row, line: Number(row.line) })),
      sportsbook: 'draftkings',
      asOfMs: Date.parse(ASOF),
    });
    const before = process.memoryUsage().heapUsed;
    const started = Date.now();
    const search = searchThreeLegCandidates(markets, QUICK_BUILD_THREE_LEG_PRESETS.midrange);
    const elapsed = Date.now() - started;
    const heap = process.memoryUsage().heapUsed - before;
    expect(search.probes).toBe(QUICK_BUILD_TRIPLE_PROBE_BUDGET);
    expect(search.complete).toBe(false);
    expect(search.triples.length).toBeGreaterThan(0);
    expect(search.triples.length).toBeLessThanOrEqual(5);
    expect(search.triples.every((triple) => (
      triple.combinedAmerican >= 400 && triple.combinedAmerican <= 699
    ))).toBe(true);
    expect(elapsed).toBeLessThan(5_000);
    expect(heap).toBeLessThan(80 * 1024 * 1024);
  }, 20_000);
});
