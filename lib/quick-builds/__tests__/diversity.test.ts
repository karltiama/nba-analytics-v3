import { describe, expect, it } from 'vitest';
import { americanToDecimal } from '@/lib/betting/odds-utils';
import { generateQuickBuilds, presetRange, type MarketObservationInput, type QuickBuildResult } from '../index';
import { diversityQualitySlack } from '../rank';

const ASOF = '2026-11-09T18:45:00.000Z';
const OBS = '2026-11-09T17:01:00.000Z';
const TIP = '2026-11-10T00:00:00.000Z';

function ou(input: {
  playerId: string;
  gameId: string;
  market: string;
  line: number;
  over: number;
}): MarketObservationInput[] {
  return (['over', 'under'] as const).map((side) => ({
    playerId: input.playerId,
    gameId: input.gameId,
    market: input.market,
    side,
    line: input.line,
    sportsbook: 'draftkings',
    oddsAmerican: side === 'over' ? input.over : 400,
    pullRunId: '2',
    observedAt: OBS,
    observationClock: 'RESPONSE_RECEIVED' as const,
  }));
}

function run(gameIds: string[], observations: MarketObservationInput[], range = presetRange('balanced')): QuickBuildResult {
  return generateQuickBuilds({
    sportsbook: 'draftkings',
    range,
    policy: { mode: 'research_snapshot', asOf: ASOF },
    games: gameIds.map((gameId) => ({ gameId, startTime: TIP, status: TIP })),
    attempts: gameIds.map((gameId) => ({
      pullRunId: '2',
      gameId,
      status: 'success' as const,
      rowsStored: 12,
      completedAt: OBS,
      observationClock: 'RESPONSE_RECEIVED' as const,
    })),
    observations,
  });
}

function legKey(leg: QuickBuildResult['builds'][number]['legs'][number]): string {
  return [leg.playerId, leg.gameId, leg.market, leg.side, String(leg.line)].join('|');
}

function maxCount(keys: string[]): number {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return Math.max(0, ...counts.values());
}

export function shortlistMetrics(result: QuickBuildResult) {
  const legs = result.builds.flatMap((build) => build.legs);
  const exact = legs.map(legKey);
  const playerCounts = new Map<string, number>();
  for (const leg of legs) playerCounts.set(leg.playerId, (playerCounts.get(leg.playerId) ?? 0) + 1);
  const topPlayer = [...playerCounts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  return {
    builds: result.builds.length,
    emptyReason: result.emptyReason,
    players: new Set(legs.map((leg) => leg.playerId)).size,
    exactLegs: new Set(exact).size,
    markets: [...new Set(legs.map((leg) => leg.market))].sort(),
    threes: legs.filter((leg) => leg.market === 'threes').length,
    legs: legs.length,
    maxPlayer: maxCount(legs.map((leg) => leg.playerId)),
    maxExact: maxCount(exact),
    games: [...new Set(legs.map((leg) => leg.gameId))].sort(),
    meanDistance:
      result.builds.length === 0
        ? null
        : result.builds.reduce((sum, build) => sum + build.distanceToMidpoint, 0) / result.builds.length,
    maxDistance: result.builds.reduce((max, build) => Math.max(max, build.distanceToMidpoint), 0),
    cards: result.builds.map((build) => ({
      players: build.legs.map((leg) => leg.playerId).sort(),
      markets: build.legs.map((leg) => leg.market).sort(),
      games: build.legs.map((leg) => leg.gameId).sort(),
      price: build.combinedAmerican,
      distance: Number(build.distanceToMidpoint.toFixed(4)),
    })),
    topPlayer: topPlayer ? { id: topPlayer[0], count: topPlayer[1] } : null,
  };
}

function anchorBoard() {
  const observations = [
    ...ou({ playerId: 'anchor', gameId: 'g1', market: 'threes', line: 2.5, over: -226 }),
    ...ou({ playerId: 'p-points', gameId: 'g1', market: 'points', line: 20.5, over: -220 }),
    ...ou({ playerId: 'p-rebounds', gameId: 'g1', market: 'rebounds', line: 8.5, over: -220 }),
    ...ou({ playerId: 'p-assists', gameId: 'g1', market: 'assists', line: 6.5, over: -220 }),
    ...['g2', 'g3', 'g4', 'g5', 'g6'].flatMap((gameId, index) =>
      ou({ playerId: `t${index + 1}`, gameId, market: 'threes', line: 1.5, over: -226 })
    ),
  ];
  return run(['g1', 'g2', 'g3', 'g4', 'g5', 'g6'], observations);
}

const BALANCED = presetRange('balanced');

function expectIntact(result: QuickBuildResult) {
  expect(result.status).toBe('ok');
  expect(result.emptyReason).toBeNull();
  for (const build of result.builds) {
    expect(build.legs).toHaveLength(2);
    expect(build.combinedAmerican).toBeGreaterThanOrEqual(BALANCED.minAmerican);
    expect(build.combinedAmerican).toBeLessThanOrEqual(BALANCED.maxAmerican);
    expect(build.legs[0].gameId).not.toBe(build.legs[1].gameId);
    expect(build.legs[0].playerId).not.toBe(build.legs[1].playerId);
    expect(build.legs[0].sportsbook).toBe('draftkings');
    expect(build.legs[1].sportsbook).toBe('draftkings');
    expect(build.legs[0].observedAt).toBe(OBS);
    expect(build.legs[1].observedAt).toBe(OBS);
  }
}

describe('shortlist diversity', () => {
  it('uses one eighth of the preset decimal width as the quality guard', () => {
    const presets = ['higher_hit_chance', 'balanced', 'higher_payout'] as const;
    const slacks = presets.map((name) => {
      const range = presetRange(name);
      const low = americanToDecimal(range.minAmerican);
      const high = americanToDecimal(range.maxAmerican);
      expect(low).not.toBeNull();
      expect(high).toBeGreaterThan(low!);
      const width = high! - low!;
      expect(diversityQualitySlack(range)).toBeCloseTo(width / 8, 12);
      expect(diversityQualitySlack(range)).toBeLessThan(width / 2);
      return diversityQualitySlack(range);
    });
    expect(new Set(slacks.map((slack) => slack.toFixed(8))).size).toBe(3);
    expect((-110 + 125) / 2).toBe(7.5);
    expect(diversityQualitySlack(BALANCED)).not.toBeCloseTo(Math.abs(americanToDecimal(7.5)! - americanToDecimal(125)!), 2);
  });

  it('replaces a repeated threes anchor when competitive alternatives exist', () => {
    const first = anchorBoard();
    const second = anchorBoard();
    expectIntact(first);
    expect(first.builds.map((build) => build.id)).toEqual(second.builds.map((build) => build.id));
    const metrics = shortlistMetrics(first);
    expect(metrics.builds).toBe(5);
    expect(metrics.markets.length).toBeGreaterThan(1);
    expect(metrics.markets).toEqual(expect.arrayContaining(['threes', 'points', 'rebounds', 'assists']));
    expect(metrics.maxPlayer).toBeLessThan(4);
    expect(metrics.maxExact).toBeLessThan(4);
    expect(metrics.threes).toBeLessThan(metrics.legs);
  });

  it('shows other markets when they are close to the best threes pairs', () => {
    const threes = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].flatMap((gameId, index) =>
      ou({ playerId: `t${index + 1}`, gameId, market: 'threes', line: 1.5 + index, over: -226 })
    );
    const others = [
      ...ou({ playerId: 'points', gameId: 'g1', market: 'points', line: 24.5, over: -220 }),
      ...ou({ playerId: 'rebounds', gameId: 'g2', market: 'rebounds', line: 9.5, over: -220 }),
      ...ou({ playerId: 'assists', gameId: 'g3', market: 'assists', line: 7.5, over: -220 }),
    ];
    const result = run(['g1', 'g2', 'g3', 'g4', 'g5', 'g6'], [...threes, ...others]);
    expectIntact(result);
    const metrics = shortlistMetrics(result);
    expect(metrics.builds).toBe(5);
    expect(metrics.markets).toEqual(expect.arrayContaining(['threes', 'points', 'rebounds', 'assists']));
    expect(metrics.maxPlayer).toBeLessThan(5);
    expect(metrics.threes / metrics.legs).toBeLessThan(1);
  });

  it('does not invent markets when only threes qualify', () => {
    const observations = ['g1', 'g2', 'g3', 'g4'].flatMap((gameId, index) =>
      ou({ playerId: `t${index + 1}`, gameId, market: 'threes', line: 1.5, over: -226 })
    );
    const result = run(['g1', 'g2', 'g3', 'g4'], observations);
    expectIntact(result);
    const metrics = shortlistMetrics(result);
    expect(metrics.builds).toBe(5);
    expect(metrics.markets).toEqual(['threes']);
    expect(metrics.threes).toBe(metrics.legs);
  });

  it('returns the three valid builds and does not pad the shortlist', () => {
    const observations = ['g1', 'g2', 'g3'].flatMap((gameId, index) =>
      ou({ playerId: `p${index + 1}`, gameId, market: 'points', line: 15.5, over: -226 })
    );
    const result = run(['g1', 'g2', 'g3'], observations);
    expectIntact(result);
    expect(shortlistMetrics(result).builds).toBe(3);
    expect(result.builds.flatMap((build) => build.legs.map((leg) => leg.playerId)).sort()).toEqual([
      'p1',
      'p1',
      'p2',
      'p2',
      'p3',
      'p3',
    ]);
  });

  it('does not promote a much worse price just to change the market', () => {
    const close = [
      ...ou({ playerId: 'anchor', gameId: 'g1', market: 'threes', line: 2.5, over: -226 }),
      ...['g2', 'g3', 'g4', 'g5', 'g6'].flatMap((gameId, index) =>
        ou({ playerId: `t${index + 1}`, gameId, market: 'threes', line: 1.5, over: -226 })
      ),
    ];
    const far = ['g7', 'g8', 'g9', 'g10'].flatMap((gameId, index) =>
      ou({ playerId: `far${index + 1}`, gameId, market: 'points', line: 18.5, over: -200 })
    );
    const result = run(
      ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9', 'g10'],
      [...close, ...far]
    );
    expectIntact(result);
    const metrics = shortlistMetrics(result);
    expect(metrics.builds).toBe(5);
    expect(metrics.maxDistance).toBeLessThan(diversityQualitySlack(BALANCED));
    expect(result.builds.flatMap((build) => build.legs.map((leg) => leg.playerId)).some((id) => id.startsWith('far'))).toBe(
      false
    );
    expect(metrics.markets).toEqual(['threes']);
  });

  it('keeps every leg inside the selected games', () => {
    const selected = ['g1', 'g2', 'g3'].flatMap((gameId, index) =>
      ou({
        playerId: `in${index + 1}`,
        gameId,
        market: index === 0 ? 'points' : 'rebounds',
        line: 10.5 + index,
        over: -226,
      })
    );
    const extra = [
      ...ou({ playerId: 'in4', gameId: 'g1', market: 'assists', line: 5.5, over: -220 }),
      ...ou({ playerId: 'in5', gameId: 'g2', market: 'points', line: 12.5, over: -220 }),
      ...ou({ playerId: 'out1', gameId: 'g9', market: 'threes', line: 2.5, over: -226 }),
    ];
    const result = run(['g1', 'g2', 'g3'], [...selected, ...extra]);
    expectIntact(result);
    const metrics = shortlistMetrics(result);
    expect(metrics.games.every((gameId) => ['g1', 'g2', 'g3'].includes(gameId))).toBe(true);
    expect(result.builds.flatMap((build) => build.legs.map((leg) => leg.playerId))).not.toContain('out1');
    expect(metrics.builds).toBeGreaterThan(0);
    expect(metrics.builds).toBeLessThanOrEqual(5);
  });
});
