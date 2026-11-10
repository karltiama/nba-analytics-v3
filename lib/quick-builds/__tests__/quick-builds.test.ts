import { describe, expect, it } from 'vitest';
import { americanToDecimal } from '@/lib/betting/odds-utils';
import { combinedAmericanOdds } from '@/lib/parlay-xray/combined-odds';
import { combinedDecimal } from '@/lib/parlay/true-cost';
import { noVigProbability, rawImpliedProbFromMoneyline } from '@/lib/betting/market-probability';
import {
  generateQuickBuilds,
  presetRange,
  QUICK_BUILD_PRICE_NOTICE,
  QUICK_BUILD_SHORTLIST_CAP,
  QuickBuildInputError,
  type GamePullAttempt,
  type MarketObservationInput,
  type QuickBuildPolicy,
  type QuickBuildRequest,
} from '../index';

const ASOF = '2026-11-09T18:45:00.000Z';
const OBS = '2026-11-09T17:01:00.000Z';
const TIP = '2026-11-10T00:00:00.000Z';

function research(): QuickBuildPolicy {
  return { mode: 'research_snapshot', asOf: ASOF };
}

function recent(maxObservationAgeMs: number): QuickBuildPolicy {
  return { mode: 'recently_observed', asOf: ASOF, maxObservationAgeMs };
}

function success(pullRunId: string, gameId: string, completedAt: string, rowsStored = 12): GamePullAttempt {
  return {
    pullRunId,
    gameId,
    status: 'success',
    rowsStored,
    completedAt,
    observationClock: 'RESPONSE_RECEIVED',
  };
}

function ou(input: {
  playerId: string;
  gameId: string;
  market?: string;
  line: number;
  pullRunId?: string;
  over: number;
  under: number;
  sportsbook?: string;
  observedAt?: string;
}): MarketObservationInput[] {
  return (['over', 'under'] as const).map((side) => ({
    playerId: input.playerId,
    gameId: input.gameId,
    market: input.market ?? 'points',
    side,
    line: input.line,
    sportsbook: input.sportsbook ?? 'draftkings',
    oddsAmerican: side === 'over' ? input.over : input.under,
    pullRunId: input.pullRunId ?? '2',
    observedAt: input.observedAt ?? OBS,
    observationClock: 'RESPONSE_RECEIVED' as const,
  }));
}

function board(extra?: Partial<QuickBuildRequest>): QuickBuildRequest {
  return {
    sportsbook: 'draftkings',
    range: { minAmerican: -500, maxAmerican: 500 },
    policy: research(),
    games: [
      { gameId: 'g1', startTime: TIP, status: TIP },
      { gameId: 'g2', startTime: TIP, status: TIP },
    ],
    attempts: [success('2', 'g1', OBS), success('2', 'g2', OBS)],
    observations: [
      ...ou({ playerId: 'a', gameId: 'g1', line: 20.5, over: -110, under: -110 }),
      ...ou({ playerId: 'b', gameId: 'g2', line: 18.5, over: -110, under: -110 }),
    ],
    ...extra,
  };
}

describe('generateQuickBuilds', () => {
  it('builds one cross-game pair and reuses the shared price math', () => {
    const result = generateQuickBuilds(board());
    expect(result.status).toBe('ok');
    expect(result.emptyReason).toBeNull();
    expect(result.priceNotice).toBe(QUICK_BUILD_PRICE_NOTICE);
    expect(result.builds).toHaveLength(4);
    const build = result.builds.find((row) => row.legs.every((leg) => leg.side === 'over'))!;
    expect(build.combinedAmerican).toBe(combinedAmericanOdds([-110, -110]));
    expect(build.breakEvenProbability).toBeCloseTo(1 / combinedDecimal([-110, -110])!, 12);
    expect(result.builds.every((row) => row.combinedAmerican === build.combinedAmerican)).toBe(true);
    const leg = build.legs[0]!;
    expect(leg.noVigProbability).toBeCloseTo(
      noVigProbability(rawImpliedProbFromMoneyline(-110), rawImpliedProbFromMoneyline(-110))!,
      12
    );
    expect(leg.oppositeAmerican).toBe(-110);
    expect(leg.sportsbook).toBe('draftkings');
    expect(leg.pullRunId).toBe('2');
    expect(JSON.stringify(result)).not.toMatch(/jointFair|expectedValue|modelEv/i);
  });

  it('rejects two legs from the same game', () => {
    const result = generateQuickBuilds(
      board({
        games: [{ gameId: 'g1', startTime: TIP, status: TIP }],
        attempts: [success('2', 'g1', OBS)],
        observations: [
          ...ou({ playerId: 'a', gameId: 'g1', line: 20.5, over: -110, under: -110 }),
          ...ou({ playerId: 'b', gameId: 'g1', line: 8.5, over: -110, under: -110 }),
        ],
      })
    );
    expect(result.emptyReason).toBe('NO_CROSS_GAME');
    expect(result.builds).toEqual([]);
  });

  it('does not mix sportsbooks on one ticket', () => {
    const result = generateQuickBuilds(
      board({
        observations: [
          ...ou({ playerId: 'a', gameId: 'g1', line: 20.5, over: -110, under: -110, sportsbook: 'draftkings' }),
          ...ou({ playerId: 'b', gameId: 'g2', line: 18.5, over: -110, under: -110, sportsbook: 'fanduel' }),
        ],
      })
    );
    expect(result.emptyReason).toBe('NO_CROSS_GAME');
  });

  it('drops a market that has no opposite side', () => {
    const [over] = ou({ playerId: 'a', gameId: 'g1', line: 20.5, over: -110, under: -110 });
    const result = generateQuickBuilds(
      board({
        observations: [
          over!,
          ...ou({ playerId: 'b', gameId: 'g2', line: 18.5, over: -110, under: -110 }),
        ],
      })
    );
    expect(result.emptyReason).toBe('NO_CROSS_GAME');
    expect(result.builds).toEqual([]);
  });

  it('drops invalid American prices', () => {
    const result = generateQuickBuilds(
      board({
        observations: [
          ...ou({ playerId: 'a', gameId: 'g1', line: 20.5, over: 50, under: -110 }),
          ...ou({ playerId: 'b', gameId: 'g2', line: 18.5, over: -110, under: -50 }),
        ],
      })
    );
    expect(result.emptyReason).toBe('NO_ELIGIBLE_MARKETS');
  });

  it('drops unsupported markets', () => {
    const result = generateQuickBuilds(
      board({
        observations: [
          ...ou({ playerId: 'a', gameId: 'g1', market: 'steals', line: 1.5, over: -110, under: -110 }),
          ...ou({ playerId: 'b', gameId: 'g2', market: 'points_1q', line: 6.5, over: -110, under: -110 }),
        ],
      })
    );
    expect(result.emptyReason).toBe('NO_ELIGIBLE_MARKETS');
  });

  it('uses only the latest complete pull when a current-table superset still has the old line', () => {
    const early = '2026-11-09T13:00:39.000Z';
    const noon = '2026-11-09T17:01:10.000Z';
    const result = generateQuickBuilds(
      board({
        attempts: [
          success('1', 'g1', early),
          success('2', 'g1', noon),
          success('1', 'g2', early),
          success('2', 'g2', noon),
        ],
        observations: [
          ...ou({ playerId: 'a', gameId: 'g1', line: 19.5, pullRunId: '1', observedAt: early, over: -115, under: -105 }),
          ...ou({ playerId: 'a', gameId: 'g1', line: 20.5, pullRunId: '2', observedAt: noon, over: -110, under: -110 }),
          ...ou({ playerId: 'b', gameId: 'g2', line: 17.5, pullRunId: '1', observedAt: early, over: -120, under: -100 }),
          ...ou({ playerId: 'b', gameId: 'g2', line: 18.5, pullRunId: '2', observedAt: noon, over: -110, under: -110 }),
        ],
      })
    );
    expect(result.status).toBe('ok');
    expect(result.games.map((game) => game.eligiblePullRunId)).toEqual(['2', '2']);
    const lines = result.builds.flatMap((build) => build.legs.map((leg) => leg.line));
    expect(lines.every((line) => line === 20.5 || line === 18.5)).toBe(true);
    expect(lines).not.toContain(19.5);
    expect(lines).not.toContain(17.5);
    expect(result.builds.every((build) => build.legs.every((leg) => leg.pullRunId === '2'))).toBe(true);
  });

  it('does not keep an older board after a newer failed pull when the policy is recently observed', () => {
    const result = generateQuickBuilds(
      board({
        policy: recent(6 * 60 * 60 * 1000),
        attempts: [
          success('2', 'g1', OBS),
          success('2', 'g2', OBS),
          {
            pullRunId: '3',
            gameId: 'g1',
            status: 'error',
            rowsStored: 0,
            completedAt: '2026-11-09T18:00:00.000Z',
            observationClock: null,
          },
          {
            pullRunId: '3',
            gameId: 'g2',
            status: 'error',
            rowsStored: 0,
            completedAt: '2026-11-09T18:00:00.000Z',
            observationClock: null,
          },
        ],
      })
    );
    expect(result.emptyReason).toBe('NO_SUCCESSFUL_PULL');
    expect(result.games.find((game) => game.gameId === 'g1')).toMatchObject({
      eligiblePullRunId: null,
      rejection: 'NEWER_UNSUCCESSFUL_ATTEMPT',
      newerUnsuccessfulAttempt: { pullRunId: '3', kind: 'failed', status: 'error' },
    });
    expect(result.builds).toEqual([]);
  });

  it('reports a newer failure and still uses the last complete pull for a research snapshot', () => {
    const result = generateQuickBuilds(
      board({
        attempts: [
          success('2', 'g1', OBS),
          success('2', 'g2', OBS),
          {
            pullRunId: '3',
            gameId: 'g1',
            status: 'error',
            rowsStored: 0,
            completedAt: '2026-11-09T18:00:00.000Z',
            observationClock: null,
          },
        ],
      })
    );
    expect(result.status).toBe('ok');
    expect(result.games.find((game) => game.gameId === 'g1')?.newerUnsuccessfulAttempt?.kind).toBe('failed');
    expect(result.builds[0]?.legs.every((leg) => leg.pullRunId === '2')).toBe(true);
  });

  it('treats a later zero-row success as a post-tip skip, not a current board', () => {
    const result = generateQuickBuilds(
      board({
        policy: recent(6 * 60 * 60 * 1000),
        attempts: [
          success('2', 'g1', OBS),
          success('2', 'g2', OBS),
          {
            pullRunId: '4',
            gameId: 'g1',
            status: 'success',
            rowsStored: 0,
            completedAt: '2026-11-09T18:30:00.000Z',
            observationClock: null,
          },
          {
            pullRunId: '4',
            gameId: 'g2',
            status: 'success',
            rowsStored: 0,
            completedAt: '2026-11-09T18:30:00.000Z',
            observationClock: null,
          },
        ],
      })
    );
    expect(result.emptyReason).toBe('NO_SUCCESSFUL_PULL');
    expect(result.games.find((game) => game.gameId === 'g2')?.newerUnsuccessfulAttempt?.kind).toBe('zero_row');
  });

  it('collapses identical prices and drops a conflicting duplicate', () => {
    const kept = generateQuickBuilds(
      board({
        observations: [
          ...ou({ playerId: 'a', gameId: 'g1', line: 20.5, over: -110, under: -110 }),
          ...ou({ playerId: 'a', gameId: 'g1', line: 20.5, over: -110, under: -110 }),
          ...ou({ playerId: 'b', gameId: 'g2', line: 18.5, over: -110, under: -110 }),
        ],
      })
    );
    expect(kept.builds).toHaveLength(4);
    expect(new Set(kept.builds.map((build) => build.id)).size).toBe(4);

    const conflict = generateQuickBuilds(
      board({
        observations: [
          ...ou({ playerId: 'a', gameId: 'g1', line: 20.5, over: -110, under: -110 }),
          ...ou({ playerId: 'a', gameId: 'g1', line: 20.5, over: -120, under: -110 }),
          ...ou({ playerId: 'b', gameId: 'g2', line: 18.5, over: -110, under: -110 }),
        ],
      })
    );
    expect(conflict.emptyReason).toBe('NO_CROSS_GAME');
  });

  it('keeps alternate lines until the band filter, then one nearest the midpoint', () => {
    const result = generateQuickBuilds(
      board({
        range: { minAmerican: 200, maxAmerican: 300 },
        observations: [
          ...ou({ playerId: 'a', gameId: 'g1', line: 10.5, over: -110, under: -110 }),
          ...ou({ playerId: 'a', gameId: 'g1', line: 22.5, over: -150, under: 130 }),
          ...ou({ playerId: 'b', gameId: 'g2', line: 18.5, over: -110, under: -110 }),
        ],
      })
    );
    expect(combinedAmericanOdds([-110, -110])).toBeGreaterThan(200);
    expect(result.builds.length).toBeGreaterThan(0);
    expect(result.builds.every((build) => build.legs.every((leg) => leg.line !== 22.5))).toBe(true);
    const overOver = result.builds.find((build) => build.legs.every((leg) => leg.side === 'over'))!;
    expect(overOver.legs.find((leg) => leg.playerId === 'a')?.line).toBe(10.5);
    const decimalMidpoint = (americanToDecimal(200)! + americanToDecimal(300)!) / 2;
    expect(overOver.distanceToMidpoint).toBeCloseTo(
      Math.abs(americanToDecimal(overOver.combinedAmerican)! - decimalMidpoint),
      12
    );
  });

  it('ranks a band that crosses zero by decimal odds, not by the invalid American average', () => {
    const arithmeticMidpoint = (-110 + 125) / 2;
    expect(arithmeticMidpoint).toBe(7.5);
    expect(Math.abs(100 - arithmeticMidpoint)).toBeLessThan(Math.abs(108 - arithmeticMidpoint));

    const decimalMidpoint = (americanToDecimal(-110)! + americanToDecimal(125)!) / 2;
    expect(decimalMidpoint).toBeGreaterThan(2);
    expect(Math.abs(americanToDecimal(108)! - decimalMidpoint)).toBeLessThan(
      Math.abs(americanToDecimal(100)! - decimalMidpoint)
    );

    const result = generateQuickBuilds(
      board({
        range: { minAmerican: -200, maxAmerican: -110 },
        observations: [
          ...ou({ playerId: 'a', gameId: 'g1', line: 10.5, over: -400, under: 500 }),
          ...ou({ playerId: 'a', gameId: 'g1', line: 22.5, over: -238, under: 500 }),
          ...ou({ playerId: 'b', gameId: 'g2', line: 18.5, over: -400, under: 500 }),
        ],
      })
    );
    const overOver = result.builds.find((build) => build.legs.every((leg) => leg.side === 'over'))!;
    expect(overOver.combinedAmerican).toBe(combinedAmericanOdds([-238, -400]));
    expect(overOver.legs.find((leg) => leg.playerId === 'a')?.line).toBe(22.5);
    expect(Math.abs(combinedAmericanOdds([-400, -400])! - -155)).toBeLessThan(
      Math.abs(overOver.combinedAmerican - -155)
    );
  });

  it('includes exact preset boundaries and leaves the other presets empty when nothing qualifies', () => {
    expect(combinedAmericanOdds([-200, -200])).toBe(125);
    expect(combinedAmericanOdds([-300, -800])).toBe(-200);
    expect(combinedAmericanOdds([-200, 100])).toBe(200);

    const boundary = board({
      observations: [
        ...ou({ playerId: 'a', gameId: 'g1', line: 30.5, over: -200, under: 170 }),
        ...ou({ playerId: 'b', gameId: 'g2', line: 12.5, over: -200, under: 170 }),
      ],
    });
    expect(generateQuickBuilds({ ...boundary, range: presetRange('balanced') }).builds[0]?.combinedAmerican).toBe(125);
    expect(generateQuickBuilds({ ...boundary, range: presetRange('higher_payout') }).builds[0]?.combinedAmerican).toBe(125);
    expect(generateQuickBuilds({ ...boundary, range: presetRange('higher_hit_chance') }).emptyReason).toBe(
      'NO_PAIRS_IN_BAND'
    );

    const short = board({
      observations: [
        ...ou({ playerId: 'a', gameId: 'g1', line: 8.5, over: -300, under: 240 }),
        ...ou({ playerId: 'b', gameId: 'g2', line: 9.5, over: -800, under: 600 }),
      ],
    });
    expect(generateQuickBuilds({ ...short, range: presetRange('higher_hit_chance') }).builds[0]?.combinedAmerican).toBe(
      -200
    );
    expect(generateQuickBuilds({ ...short, range: presetRange('balanced') }).emptyReason).toBe('NO_PAIRS_IN_BAND');
  });

  it('returns no upcoming games, no pull, and no band as different reasons', () => {
    expect(
      generateQuickBuilds(board({ games: [], attempts: [], observations: [] })).emptyReason
    ).toBe('NO_UPCOMING_GAMES');

    const tipped = generateQuickBuilds(
      board({
        games: [
          { gameId: 'g1', startTime: '2026-11-09T00:00:00.000Z', status: 'Final' },
          { gameId: 'g2', startTime: TIP, status: 'Final' },
        ],
      })
    );
    expect(tipped.emptyReason).toBe('NO_UPCOMING_GAMES');

    const noPull = generateQuickBuilds(
      board({
        attempts: [
          {
            pullRunId: '9',
            gameId: 'g1',
            status: 'error',
            rowsStored: 0,
            completedAt: OBS,
            observationClock: null,
          },
        ],
      })
    );
    expect(noPull.emptyReason).toBe('NO_SUCCESSFUL_PULL');

    const outside = generateQuickBuilds(board({ range: presetRange('higher_hit_chance') }));
    expect(outside.emptyReason).toBe('NO_PAIRS_IN_BAND');
  });

  it('excludes the same player across games', () => {
    const result = generateQuickBuilds(
      board({
        observations: [
          ...ou({ playerId: 'a', gameId: 'g1', line: 20.5, over: -110, under: -110 }),
          ...ou({ playerId: 'a', gameId: 'g2', line: 18.5, over: -110, under: -110 }),
        ],
      })
    );
    expect(result.emptyReason).toBe('NO_ELIGIBLE_MARKETS');
  });

  it('ranks deterministically, keeps a closer pair ahead of a farther game pair, and stops at five', () => {
    const games = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map((gameId) => ({
      gameId,
      startTime: TIP,
      status: TIP,
    }));
    const attempts = games.map((game) => success('2', game.gameId, OBS));
    const prices = [-110, -115, -120, -125, -130, -135];
    const observations = games.flatMap((game, index) =>
      ou({
        playerId: `p${index}`,
        gameId: game.gameId,
        line: 10 + index,
        over: prices[index]!,
        under: -110,
      })
    );
    const once = generateQuickBuilds(
      board({
        games,
        attempts,
        observations,
        range: { minAmerican: -500, maxAmerican: 800 },
      })
    );
    const twice = generateQuickBuilds(
      board({
        games,
        attempts,
        observations,
        range: { minAmerican: -500, maxAmerican: 800 },
      })
    );
    expect(once.builds).toHaveLength(QUICK_BUILD_SHORTLIST_CAP);
    expect(once.builds.map((build) => build.id)).toEqual(twice.builds.map((build) => build.id));
    const gamePairs = once.builds.map((build) => build.legs.map((leg) => leg.gameId).sort().join('|'));
    // Six single-player games can supply three disjoint pairs before a player has to repeat.
    expect(new Set(gamePairs).size).toBeGreaterThanOrEqual(3);

    const diverse = generateQuickBuilds(
      board({
        games: [
          { gameId: 'g1', startTime: TIP, status: TIP },
          { gameId: 'g2', startTime: TIP, status: TIP },
          { gameId: 'g3', startTime: TIP, status: TIP },
          { gameId: 'g4', startTime: TIP, status: TIP },
        ],
        attempts: [success('2', 'g1', OBS), success('2', 'g2', OBS), success('2', 'g3', OBS), success('2', 'g4', OBS)],
        range: { minAmerican: 200, maxAmerican: 400 },
        observations: [
          ...ou({ playerId: 'a', gameId: 'g1', line: 10.5, over: -110, under: -110 }),
          ...ou({ playerId: 'b', gameId: 'g2', line: 11.5, over: -110, under: -110 }),
          ...ou({ playerId: 'c', gameId: 'g1', line: 12.5, over: -120, under: -120 }),
          ...ou({ playerId: 'd', gameId: 'g2', line: 13.5, over: -120, under: -120 }),
          ...ou({ playerId: 'e', gameId: 'g3', line: 14.5, over: -135, under: -135 }),
          ...ou({ playerId: 'f', gameId: 'g4', line: 15.5, over: -135, under: -135 }),
        ],
      })
    );
    expect(diverse.builds.length).toBeGreaterThanOrEqual(2);
    expect(diverse.builds[0]?.legs.map((leg) => leg.playerId).sort()).toEqual(['a', 'b']);
    expect(diverse.builds[0]?.legs.map((leg) => leg.gameId).sort()).toEqual(['g1', 'g2']);
    // The −135 pair is a worse decimal-odds match, so it does not jump ahead of the closer g1/g2 pair.
    expect(diverse.builds[1]?.legs.map((leg) => leg.gameId).sort()).toEqual(['g1', 'g2']);
  });

  it('rejects a stale observation under a short window without using an older pull', () => {
    const result = generateQuickBuilds(
      board({
        policy: recent(15 * 60 * 1000),
        attempts: [success('1', 'g1', '2026-11-09T13:00:00.000Z'), success('1', 'g2', '2026-11-09T13:00:00.000Z')],
        observations: [
          ...ou({
            playerId: 'a',
            gameId: 'g1',
            line: 19.5,
            pullRunId: '1',
            observedAt: '2026-11-09T13:00:39.000Z',
            over: -110,
            under: -110,
          }),
          ...ou({
            playerId: 'b',
            gameId: 'g2',
            line: 18.5,
            pullRunId: '1',
            observedAt: '2026-11-09T13:00:39.000Z',
            over: -110,
            under: -110,
          }),
        ],
      })
    );
    expect(result.emptyReason).toBe('NO_SUCCESSFUL_PULL');
    expect(result.games.every((game) => game.rejection === 'STALE_OBSERVATION')).toBe(true);
    expect(result.builds).toEqual([]);
  });

  it('throws on malformed requests and on an oversized observation list', () => {
    expect(() => generateQuickBuilds(board({ range: { minAmerican: 200, maxAmerican: -110 } }))).toThrow(
      QuickBuildInputError
    );
    expect(() => generateQuickBuilds(board({ sportsbook: 'bet365' }))).toThrow(QuickBuildInputError);
    expect(() =>
      generateQuickBuilds(board({ policy: { mode: 'recently_observed', asOf: ASOF } }))
    ).toThrow(QuickBuildInputError);
    expect(() =>
      generateQuickBuilds(
        board({
          attempts: [
            {
              pullRunId: '2',
              gameId: 'g1',
              status: 'nope' as 'error',
              rowsStored: 1,
              completedAt: OBS,
              observationClock: null,
            },
          ],
        })
      )
    ).toThrow(QuickBuildInputError);

    const oversized = board({
      observations: Array.from({ length: 4001 }, () => ou({ playerId: 'a', gameId: 'g1', line: 1, over: -110, under: -110 })[0]!),
    });
    expect(() => generateQuickBuilds(oversized)).toThrow(QuickBuildInputError);
    try {
      generateQuickBuilds(oversized);
    } catch (error) {
      expect(error).toBeInstanceOf(QuickBuildInputError);
      expect((error as QuickBuildInputError).code).toBe('LIMIT_EXCEEDED');
    }
  });
});
