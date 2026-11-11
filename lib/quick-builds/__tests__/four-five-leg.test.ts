import { describe, expect, it } from 'vitest';
import { combinedAmericanOdds } from '@/lib/parlay-xray/combined-odds';
import { combinationCount, searchTupleCandidates } from '../generate-tuples';
import { buildTwoSidedMarkets } from '../markets';
import { generateQuickBuilds } from '../index';
import {
  QUICK_BUILD_FIVE_LEG_PRESETS,
  QUICK_BUILD_FOUR_LEG_PRESETS,
  QUICK_BUILD_TUPLE_PROBE_BUDGET,
  QUICK_BUILD_TUPLE_RETAIN,
  QUICK_BUILD_TUPLE_VISIT_CAP,
  type GamePullAttempt,
  type MarketObservationInput,
  type QuickBuildRequest,
} from '../types';

const ASOF = '2026-11-11T13:05:58.687Z';
const OBS = '2026-11-11T12:00:30.000Z';
const TIP = '2026-11-12T00:00:00.000Z';

function success(gameId: string): GamePullAttempt {
  return {
    pullRunId: '692',
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
}): MarketObservationInput[] {
  return (['over', 'under'] as const).map((side) => ({
    playerId: input.playerId,
    gameId: input.gameId,
    market: input.market ?? 'points',
    side,
    line: input.line ?? 20.5,
    sportsbook: 'draftkings',
    oddsAmerican: side === 'over' ? input.over : input.under,
    pullRunId: '692',
    observedAt: OBS,
    observationClock: 'RESPONSE_RECEIVED' as const,
  }));
}

function games(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    gameId: `g${index + 1}`,
    startTime: TIP,
    status: TIP,
  }));
}

function request(legCount: 4 | 5, observations: MarketObservationInput[], range = legCount === 4
  ? QUICK_BUILD_FOUR_LEG_PRESETS.four_middle
  : QUICK_BUILD_FIVE_LEG_PRESETS.five_middle): QuickBuildRequest {
  const slate = games(legCount);
  return {
    sportsbook: 'draftkings',
    range,
    policy: { mode: 'research_snapshot', asOf: ASOF },
    games: slate,
    attempts: slate.map((game) => success(game.gameId)),
    observations,
    legCount,
  };
}

describe('four- and five-leg quick builds', () => {
  it('keeps two-leg responses free of extended completeness metadata', () => {
    const slate = games(2);
    const result = generateQuickBuilds({
      sportsbook: 'draftkings',
      range: { minAmerican: -110, maxAmerican: 125 },
      policy: { mode: 'research_snapshot', asOf: ASOF },
      games: slate,
      attempts: slate.map((game) => success(game.gameId)),
      observations: [
        ...ou({ playerId: 'a', gameId: 'g1', over: -200, under: -200 }),
        ...ou({ playerId: 'b', gameId: 'g2', over: -200, under: -200 }),
      ],
    });
    expect(result.searchComplete).toBeUndefined();
    expect(result.builds[0]?.legs).toHaveLength(2);
    expect(result.priceNotice).toContain('two leg prices');
  });

  it('prices four and five even-money legs inside the middle presets', () => {
    const fourPrice = combinedAmericanOdds([-110, -110, -110, -110]);
    const fivePrice = combinedAmericanOdds([-110, -110, -110, -110, -110]);
    expect(fourPrice).toBeGreaterThanOrEqual(1000);
    expect(fourPrice).toBeLessThanOrEqual(1399);
    expect(fivePrice).toBeGreaterThanOrEqual(2000);
    expect(fivePrice).toBeLessThanOrEqual(2599);
    const four = generateQuickBuilds(request(4, [1, 2, 3, 4].flatMap((index) => ou({
      playerId: `p${index}`,
      gameId: `g${index}`,
      market: index % 2 === 0 ? 'points' : 'rebounds',
      over: -110,
      under: -110,
    }))));
    expect(four.status).toBe('ok');
    expect(four.builds[0]?.combinedAmerican).toBe(fourPrice);
    expect(four.builds[0]?.legs).toHaveLength(4);
    expect(new Set(four.builds[0]?.legs.map((leg) => leg.gameId)).size).toBe(4);
    expect(four.priceNotice).toContain('four leg prices');
    expect(four.searchComplete).toBe(false);
  });

  it('accepts an inclusive boundary and rejects the next American price', () => {
    const exact = combinedAmericanOdds([-110, -110, -110, -110])!;
    const observations = [1, 2, 3, 4].flatMap((index) => ou({
      playerId: `p${index}`,
      gameId: `g${index}`,
      over: -110,
      under: -110,
    }));
    const inside = generateQuickBuilds(request(4, observations, { minAmerican: exact, maxAmerican: exact }));
    expect(inside.builds.some((build) => build.combinedAmerican === exact)).toBe(true);
    const outside = generateQuickBuilds(request(4, observations, { minAmerican: exact + 1, maxAmerican: exact + 1 }));
    expect(outside.builds).toHaveLength(0);
    expect(outside.emptyReason).toBe('SEARCH_BUDGET_REACHED');
    expect(outside.searchComplete).toBe(false);
  });

  it('does not call a short slate an empty payout band', () => {
    const observations = [1, 2, 3].flatMap((index) => ou({
      playerId: `p${index}`,
      gameId: `g${index}`,
      over: -110,
      under: -110,
    }));
    const result = generateQuickBuilds({
      ...request(4, observations),
      games: games(3),
      attempts: games(3).map((game) => success(game.gameId)),
    });
    expect(result.emptyReason).toBe('NO_CROSS_GAME');
    expect(result.builds).toHaveLength(0);
    expect(result.searchComplete).toBe(true);
  });

  it('keeps the same build ids when source rows are reversed and stops at the work bounds', () => {
    const observations = [1, 2, 3, 4, 5].flatMap((index) => ou({
      playerId: `p${index}`,
      gameId: `g${index}`,
      over: -110,
      under: -110,
    }));
    const forward = generateQuickBuilds(request(5, observations));
    const reversed = generateQuickBuilds(request(5, observations.slice().reverse()));
    expect(reversed.builds.map((build) => build.id)).toEqual(forward.builds.map((build) => build.id));
    expect(forward.builds[0]?.legs).toHaveLength(5);
    expect(new Set(forward.builds[0]?.legs.map((leg) => leg.playerId)).size).toBe(5);

    const markets = buildTwoSidedMarkets({
      observations,
      sportsbook: 'draftkings',
      asOfMs: Date.parse(ASOF),
    });
    const limited = searchTupleCandidates(markets, QUICK_BUILD_FIVE_LEG_PRESETS.five_middle, 5, 3);
    expect(limited.probes).toBeLessThanOrEqual(3);
    expect(limited.complete).toBe(false);
    expect(limited.tuples.length).toBeLessThanOrEqual(QUICK_BUILD_TUPLE_RETAIN);
    expect(combinationCount(32, 5)).toBeGreaterThan(QUICK_BUILD_TUPLE_VISIT_CAP);
    const wide = searchTupleCandidates(markets, QUICK_BUILD_FIVE_LEG_PRESETS.five_middle, 5, QUICK_BUILD_TUPLE_PROBE_BUDGET);
    expect(wide.probes).toBeLessThanOrEqual(QUICK_BUILD_TUPLE_PROBE_BUDGET);
    expect(wide.tuplesVisited).toBeLessThanOrEqual(QUICK_BUILD_TUPLE_VISIT_CAP);
  });

  it('still reaches a later game tuple instead of spending the budget on the first group', () => {
    const observations = [
      ...[1, 2].flatMap((index) => ou({ playerId: `early${index}`, gameId: `g${index}`, over: -500, under: -500 })),
      ...[3, 4, 5, 6].flatMap((index) => ou({ playerId: `late${index}`, gameId: `g${index}`, over: -110, under: -110 })),
    ];
    const slate = games(6);
    const result = generateQuickBuilds({
      sportsbook: 'draftkings',
      range: QUICK_BUILD_FOUR_LEG_PRESETS.four_middle,
      policy: { mode: 'research_snapshot', asOf: ASOF },
      games: slate,
      attempts: slate.map((game) => success(game.gameId)),
      observations,
      legCount: 4,
    });
    expect(result.status).toBe('ok');
    expect(result.builds.some((build) => build.legs.every((leg) => leg.playerId.startsWith('late')))).toBe(true);
    expect(result.builds.every((build) => build.combinedAmerican >= 1000 && build.combinedAmerican <= 1399)).toBe(true);
  });
});
