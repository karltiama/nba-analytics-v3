import { describe, expect, it } from 'vitest';
import { classifyWowyGames } from '../eligibility';
import { summarizeWowyPair } from '../aggregate';
import type { WowyLoadedGame, WowyPairQuery } from '../types';

const query: WowyPairQuery = {
  subjectPlayerId: 'A',
  teammatePlayerId: 'B',
  season: '2024',
  teamId: '8',
  seasonType: 'all',
};

function game(
  gameId: string,
  startTime: string,
  extra: Partial<WowyLoadedGame> = {}
): WowyLoadedGame {
  return {
    gameId,
    startTime,
    gameDate: startTime.slice(0, 10),
    season: '2024',
    status: 'Final',
    homeScore: 100,
    awayScore: 90,
    subjectTeamId: '8',
    opponentTeamId: '14',
    opponentAbbr: 'LAL',
    subjectMinutes: '30',
    subjectPts: 20,
    subjectReb: 10,
    subjectAst: 5,
    subjectTpm: 2,
    subjectFga: 16,
    subjectTpa: 6,
    subjectFta: 4,
    teammateRowPresent: true,
    teammateTeamId: '8',
    teammateMinutes: '28',
    teammatePts: 12,
    teammateReb: 3,
    teammateAst: 4,
    teammateTpm: 1,
    teammateFga: 10,
    teammateFta: 2,
    ...extra,
  };
}

describe('summarizeWowyPair', () => {
  it('reports per-game averages, per-minute rates, sample sizes, and included game ids', () => {
    const classified = classifyWowyGames(
      [
        game('w1', '2025-01-02T00:00:00.000Z', { subjectPts: 10, subjectMinutes: '20' }),
        game('w2', '2025-01-04T00:00:00.000Z', { subjectPts: 30, subjectMinutes: '40' }),
        game('wo1', '2025-01-06T00:00:00.000Z', {
          teammateMinutes: '00',
          subjectPts: 40,
          subjectMinutes: '40',
        }),
        game('wo2', '2025-01-08T00:00:00.000Z', {
          teammateMinutes: '00',
          subjectPts: 20,
          subjectMinutes: '20',
        }),
      ],
      query
    );
    const summary = summarizeWowyPair({
      query,
      classified,
      subjectName: 'Player A',
      teammateName: 'Player B',
    });

    expect(summary.with.gameCount).toBe(2);
    expect(summary.without.gameCount).toBe(2);
    expect(summary.with.gameIds).toEqual(['w1', 'w2']);
    expect(summary.without.gameIds).toEqual(['wo1', 'wo2']);
    expect(summary.with.perGame.pts).toBe(20);
    expect(summary.without.perGame.pts).toBe(30);
    expect(summary.diff.absolutePerGame.pts).toBe(-10);
    expect(summary.with.perMinuteEligible).toBe(true);
    expect(summary.with.perMinute.pts).toBeCloseTo(40 / 60, 8);
    expect(summary.support.tier).toBe('low_support');
    expect(summary.coverage.possessionDisclaimer).toMatch(/does not establish shared-court/);
  });

  it('retains counting outcomes when rounded minutes block per-minute rates', () => {
    const classified = classifyWowyGames(
      [
        game('z1', '2025-01-02T00:00:00.000Z', { subjectMinutes: '0', subjectPts: 2 }),
        game('z2', '2025-01-04T00:00:00.000Z', {
          subjectMinutes: '0',
          subjectPts: 4,
          teammateMinutes: '00',
        }),
      ],
      query
    );
    const summary = summarizeWowyPair({
      query,
      classified,
      subjectName: 'Player A',
      teammateName: 'Player B',
    });
    expect(summary.with.perGame.pts).toBe(2);
    expect(summary.without.perGame.pts).toBe(4);
    expect(summary.with.perMinuteEligible).toBe(false);
    expect(summary.with.countingRetainedDespiteIneligibleRates).toBe(true);
    expect(summary.with.perMinute.pts).toBeNull();
  });

  it('omits percentage diffs when the without baseline is too small', () => {
    const classified = classifyWowyGames(
      [
        game('w1', '2025-01-02T00:00:00.000Z', { subjectTpm: 0, subjectPts: 10 }),
        game('wo1', '2025-01-06T00:00:00.000Z', {
          teammateMinutes: '00',
          subjectTpm: 0,
          subjectPts: 0.2,
        }),
      ],
      query
    );
    const summary = summarizeWowyPair({
      query,
      classified,
      subjectName: 'A',
      teammateName: 'B',
    });
    expect(summary.diff.percentPerGame.tpm).toBeNull();
    expect(summary.diff.percentPerGame.pts).toBeNull();
  });

  it('counts unknown membership separately from with/without', () => {
    const classified = classifyWowyGames(
      [
        game('w1', '2025-01-02T00:00:00.000Z'),
        game('miss', '2025-01-04T00:00:00.000Z', {
          teammateRowPresent: false,
          teammateTeamId: null,
          teammateMinutes: null,
        }),
        game('wo1', '2025-01-06T00:00:00.000Z', { teammateMinutes: '00' }),
      ],
      query
    );
    const summary = summarizeWowyPair({
      query,
      classified,
      subjectName: 'A',
      teammateName: 'B',
    });
    expect(summary.with.gameCount).toBe(1);
    expect(summary.without.gameCount).toBe(1);
    expect(summary.unknownMembershipCount).toBe(1);
    expect(summary.exclusions.some((e) => e.reason === 'teammate_unknown_membership' && e.count === 1)).toBe(
      true
    );
  });
});
