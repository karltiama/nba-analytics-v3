import { describe, expect, it } from 'vitest';
import {
  assertRegistryIntegrity,
  CONTEXT_DEFINITIONS,
  CONTEXT_DISPLAY_STATUS,
  CONTEXT_KIND,
  CONTEXT_PREDICTIVE_STATUS,
  estimatePlayerRole,
  isRotationPlayer,
  computeTeamGameAvailability,
  assertCompletenessInvariants,
  buildTeamGameAvailabilitySnapshot,
  REGULATION_TEAM_MINUTES,
  type RoleHistoryGame,
  type HealthOutContributor,
  type PlayerRoleEstimate,
} from '@/lib/context-center';

const TIP = '2024-01-15T00:30:00Z';
const AS_OF = '2024-01-14T23:30:00Z';

function est(
  eid: string,
  mins: number,
  fga: number,
  pts: number,
  n = 5,
  maxStart = '2024-01-10T00:00:00Z'
): PlayerRoleEstimate {
  return {
    playerEntityId: eid,
    season: '2023',
    teamId: '10',
    historyN: n,
    expectedMinutes: mins,
    expectedFga: fga,
    expectedPoints: pts,
    historyMaxGameStart: maxStart,
    targetGameStart: TIP,
    roleExpectationVersion: 'player-role-expectation-v1',
  };
}

function baseInput(overrides: Partial<Parameters<typeof computeTeamGameAvailability>[0]> = {}) {
  return {
    gameId: 'g1',
    teamId: '10',
    season: '2023',
    gameStart: TIP,
    asOf: AS_OF,
    injuryReportPublishedAt: '2024-01-14T23:00:00.000Z',
    teamState: 'SUBMITTED_WITH_PLAYER_ROWS',
    healthOutContributors: [] as HealthOutContributor[],
    healthQuestionableCount: 0,
    healthDoubtfulCount: 0,
    healthProbableCount: 0,
    nonHealthOutCount: 0,
    ...overrides,
  };
}

describe('Context Center registry', () => {
  it('has unique ids, versions, and separated display/predictive status', () => {
    const r = assertRegistryIntegrity();
    expect(r.ok).toBe(true);
    expect(r.count).toBeGreaterThanOrEqual(14);

    const ids = CONTEXT_DEFINITIONS.map((d) => d.contextId);
    expect(new Set(ids).size).toBe(ids.length);

    for (const d of CONTEXT_DEFINITIONS) {
      expect(d.version.length).toBeGreaterThan(0);
      expect(Object.values(CONTEXT_DISPLAY_STATUS)).toContain(d.displayStatus);
      expect(Object.values(CONTEXT_PREDICTIVE_STATUS)).toContain(d.predictiveStatus);
      if (d.contextId.startsWith('injury.')) {
        expect(d.kind).toBe(CONTEXT_KIND.DERIVED_CONTEXT);
        expect(d.predictiveStatus).toBe(CONTEXT_PREDICTIVE_STATUS.NOT_TESTED);
      }
    }

    const wowy = CONTEXT_DEFINITIONS.find(
      (d) => d.contextId === 'research.individual_teammate_injury_wowy'
    );
    expect(wowy?.predictiveStatus).toBe(CONTEXT_PREDICTIVE_STATUS.NOT_SUPPORTED);
    expect(wowy?.mayAdjustProjection).toBe(false);
  });
});

describe('player-role-expectation-v1', () => {
  const hist = (rows: Partial<RoleHistoryGame>[]): RoleHistoryGame[] =>
    rows.map((r, i) => ({
      gameId: r.gameId ?? `h${i}`,
      gameStart: r.gameStart ?? '2024-01-01T00:00:00Z',
      season: r.season ?? '2023',
      teamId: r.teamId ?? '10',
      minutes: r.minutes ?? 30,
      points: r.points ?? 20,
      field_goals_attempted: r.field_goals_attempted ?? 15,
      ...r,
    }));

  it('uses expanding mean of prior played same-season/team games', () => {
    const r = estimatePlayerRole({
      playerEntityId: 'A',
      season: '2023',
      teamId: '10',
      targetGameStart: TIP,
      history: hist([
        { gameStart: '2024-01-01T00:00:00Z', minutes: 20, points: 10, field_goals_attempted: 8 },
        { gameStart: '2024-01-05T00:00:00Z', minutes: 40, points: 30, field_goals_attempted: 22 },
      ]),
    });
    expect(r.status).toBe('OK');
    if (r.status !== 'OK') return;
    expect(r.estimate.historyN).toBe(2);
    expect(r.estimate.expectedMinutes).toBe(30);
    expect(r.estimate.expectedFga).toBe(15);
    expect(r.estimate.expectedPoints).toBe(20);
    expect(r.estimate.historyMaxGameStart < TIP).toBe(true);
  });

  it('excludes same-tip, target, and future games', () => {
    const r = estimatePlayerRole({
      playerEntityId: 'A',
      season: '2023',
      teamId: '10',
      targetGameStart: TIP,
      history: hist([
        { gameId: 'earlier', gameStart: '2024-01-14T00:00:00Z', minutes: 30 },
        { gameId: 'same', gameStart: TIP, minutes: 99 },
        { gameId: 'later', gameStart: '2024-01-16T00:00:00Z', minutes: 99 },
      ]),
    });
    expect(r.status).toBe('OK');
    if (r.status !== 'OK') return;
    expect(r.estimate.historyN).toBe(1);
    expect(r.estimate.expectedMinutes).toBe(30);
  });

  it('excludes DNP 00 and does not use previous team/season', () => {
    const noTeam = estimatePlayerRole({
      playerEntityId: 'A',
      season: '2023',
      teamId: '10',
      targetGameStart: TIP,
      history: hist([{ teamId: '99', minutes: 36 }]),
    });
    expect(noTeam.status).toBe('NO_HISTORY');

    const noSeason = estimatePlayerRole({
      playerEntityId: 'A',
      season: '2023',
      teamId: '10',
      targetGameStart: TIP,
      history: hist([{ season: '2022', minutes: 36 }]),
    });
    expect(noSeason.status).toBe('NO_HISTORY');

    const dnp = estimatePlayerRole({
      playerEntityId: 'A',
      season: '2023',
      teamId: '10',
      targetGameStart: TIP,
      history: hist([{ minutes: '00' }]),
    });
    expect(dnp.status).toBe('NO_HISTORY');
  });

  it('treats minutes token 0 as played (canonical WOWY rule)', () => {
    const r = estimatePlayerRole({
      playerEntityId: 'A',
      season: '2023',
      teamId: '10',
      targetGameStart: TIP,
      history: hist([{ minutes: '0', points: 0, field_goals_attempted: 0 }]),
    });
    expect(r.status).toBe('OK');
    if (r.status !== 'OK') return;
    expect(r.estimate.expectedMinutes).toBe(0);
  });

  it('future mutation does not change historical estimate', () => {
    const baseHist = hist([
      { gameId: 'h1', gameStart: '2024-01-01T00:00:00Z', minutes: 30, points: 20, field_goals_attempted: 15 },
    ]);
    const a = estimatePlayerRole({
      playerEntityId: 'A',
      season: '2023',
      teamId: '10',
      targetGameStart: TIP,
      history: baseHist,
    });
    const b = estimatePlayerRole({
      playerEntityId: 'A',
      season: '2023',
      teamId: '10',
      targetGameStart: TIP,
      history: [
        ...baseHist,
        {
          gameId: 'future',
          gameStart: '2024-02-01T00:00:00Z',
          season: '2023',
          teamId: '10',
          minutes: 48,
          points: 50,
          field_goals_attempted: 40,
        },
      ],
    });
    expect(a).toEqual(b);
  });
});

describe('rotation threshold', () => {
  it('19.9 is not rotation; 20.0 is', () => {
    expect(isRotationPlayer(19.9)).toBe(false);
    expect(isRotationPlayer(19.999)).toBe(false);
    expect(isRotationPlayer(20.0)).toBe(true);
  });
});

describe('team injury burden V2', () => {
  it('A. zero health Out → known zeros COMPLETE', () => {
    const snap = computeTeamGameAvailability(baseInput());
    assertCompletenessInvariants(snap);
    expect(snap.availability.healthOutCount).toBe(0);
    expect(snap.injuryBurden.expectedMissingMinutes).toBe(0);
    expect(snap.injuryBurden.expectedMissingFga).toBe(0);
    expect(snap.injuryBurden.expectedMissingPoints).toBe(0);
    expect(snap.injuryBurden.missingRotationShare).toBe(0);
    expect(snap.injuryBurden.rotationPlayersOutCount).toBe(0);
    expect(snap.injuryBurden.maxMissingPriorMpg).toBeNull();
    expect(snap.completeness.status).toBe('COMPLETE');
  });

  it('synthetic exact output: A=30/15/20 + B=20/8/10', () => {
    const snap = computeTeamGameAvailability(
      baseInput({
        healthOutContributors: [
          { sourceKey: 'A', playerEntityId: 'A', canonical: true, roleEstimate: est('A', 30, 15, 20) },
          { sourceKey: 'B', playerEntityId: 'B', canonical: true, roleEstimate: est('B', 20, 8, 10) },
        ],
      })
    );
    assertCompletenessInvariants(snap);
    expect(snap.availability.healthOutCount).toBe(2);
    expect(snap.injuryBurden.expectedMissingMinutes).toBe(50);
    expect(snap.injuryBurden.expectedMissingFga).toBe(23);
    expect(snap.injuryBurden.expectedMissingPoints).toBe(30);
    expect(snap.injuryBurden.missingRotationShare).toBe(50 / REGULATION_TEAM_MINUTES);
    expect(snap.injuryBurden.maxMissingPriorMpg).toBe(30);
    expect(snap.injuryBurden.rotationPlayersOutCount).toBe(2);
    expect(snap.completeness.status).toBe('COMPLETE');
    expect(snap.predictiveStatus).toBe('NOT_TESTED');
  });

  it('D. health Out with no role history → SOURCE_ONLY null burden', () => {
    const snap = computeTeamGameAvailability(
      baseInput({
        healthOutContributors: [
          { sourceKey: 'A', playerEntityId: 'A', canonical: true, roleEstimate: null },
        ],
      })
    );
    assertCompletenessInvariants(snap);
    expect(snap.completeness.status).toBe('SOURCE_ONLY');
    expect(snap.injuryBurden.expectedMissingMinutes).toBeNull();
    expect(snap.injuryBurden.maxMissingPriorMpg).toBeNull();
  });

  it('E. mixed role coverage → PARTIAL', () => {
    const snap = computeTeamGameAvailability(
      baseInput({
        healthOutContributors: [
          { sourceKey: 'A', playerEntityId: 'A', canonical: true, roleEstimate: est('A', 30, 15, 20) },
          { sourceKey: 'B', playerEntityId: 'B', canonical: true, roleEstimate: null },
        ],
      })
    );
    assertCompletenessInvariants(snap);
    expect(snap.completeness.status).toBe('PARTIAL');
    expect(snap.injuryBurden.expectedMissingMinutes).toBe(30);
    expect(snap.completeness.roleEstimatedCount).toBe(1);
    expect(snap.completeness.roleRequiredCount).toBe(2);
  });

  it('F. unresolved health Out identity', () => {
    const snap = computeTeamGameAvailability(
      baseInput({
        healthOutContributors: [
          { sourceKey: 'raw1', playerEntityId: null, canonical: false, roleEstimate: null },
          { sourceKey: 'A', playerEntityId: 'A', canonical: true, roleEstimate: est('A', 25, 10, 12) },
        ],
      })
    );
    assertCompletenessInvariants(snap);
    expect(snap.availability.healthOutSourceCount).toBe(2);
    expect(snap.availability.healthOutCanonicalCount).toBe(1);
    expect(snap.availability.healthOutUnresolvedCount).toBe(1);
    expect(snap.completeness.status).toBe('PARTIAL');
  });

  it('G. Q/D/P only — not in burden', () => {
    const snap = computeTeamGameAvailability(
      baseInput({
        healthQuestionableCount: 2,
        healthDoubtfulCount: 1,
        healthProbableCount: 1,
      })
    );
    expect(snap.availability.healthOutCount).toBe(0);
    expect(snap.injuryBurden.expectedMissingMinutes).toBe(0);
    expect(snap.availability.healthQuestionableCount).toBe(2);
  });

  it('H. health Out + non-health Out stay separate', () => {
    const snap = computeTeamGameAvailability(
      baseInput({
        nonHealthOutCount: 3,
        healthOutContributors: [
          { sourceKey: 'A', playerEntityId: 'A', canonical: true, roleEstimate: est('A', 22, 9, 11) },
        ],
      })
    );
    expect(snap.availability.nonHealthOutCount).toBe(3);
    expect(snap.availability.healthOutCount).toBe(1);
    expect(snap.injuryBurden.expectedMissingMinutes).toBe(22);
  });

  it('I. SOURCE_UNKNOWN fails closed', () => {
    for (const teamState of ['NOT_YET_SUBMITTED', 'SOURCE_ABSENT', 'TEAM_BLOCK_MISSING']) {
      const snap = computeTeamGameAvailability(baseInput({ teamState }));
      expect(snap.completeness.status).toBe('SOURCE_UNKNOWN');
      expect(snap.injuryBurden.expectedMissingMinutes).toBeNull();
      expect(snap.availability.healthOutCount).toBeNull();
      assertCompletenessInvariants(snap);
    }
  });

  it('M. duplicate canonical contribution counted once', () => {
    const snap = computeTeamGameAvailability(
      baseInput({
        healthOutContributors: [
          { sourceKey: 'A1', playerEntityId: 'A', canonical: true, roleEstimate: est('A', 30, 15, 20) },
          { sourceKey: 'A2', playerEntityId: 'A', canonical: true, roleEstimate: est('A', 30, 15, 20) },
        ],
      })
    );
    expect(snap.availability.healthOutCanonicalCount).toBe(1);
    expect(snap.duplicateBurdenContributions).toBe(1);
    expect(snap.injuryBurden.expectedMissingMinutes).toBe(30);
  });

  it('N/O. rotation boundary via burden count', () => {
    const low = computeTeamGameAvailability(
      baseInput({
        healthOutContributors: [
          { sourceKey: 'A', playerEntityId: 'A', canonical: true, roleEstimate: est('A', 19.9, 8, 10) },
        ],
      })
    );
    expect(low.injuryBurden.rotationPlayersOutCount).toBe(0);

    const hi = computeTeamGameAvailability(
      baseInput({
        healthOutContributors: [
          { sourceKey: 'A', playerEntityId: 'A', canonical: true, roleEstimate: est('A', 20.0, 8, 10) },
        ],
      })
    );
    expect(hi.injuryBurden.rotationPlayersOutCount).toBe(1);
  });
});

describe('buildTeamGameAvailabilitySnapshot integration', () => {
  it('J. trade/new-team cold start → no estimate', () => {
    const pgl = new Map<string, RoleHistoryGame[]>([
      [
        'A',
        [
          {
            gameId: 'old',
            gameStart: '2024-01-01T00:00:00Z',
            season: '2023',
            teamId: '99',
            minutes: 36,
            points: 20,
            field_goals_attempted: 15,
          },
        ],
      ],
    ]);
    const snap = buildTeamGameAvailabilitySnapshot({
      gameId: 'g1',
      teamId: '10',
      season: '2023',
      gameStart: TIP,
      asOf: AS_OF,
      injuryReportPublishedAt: null,
      teamState: 'SUBMITTED_WITH_PLAYER_ROWS',
      playerRows: [
        {
          sourceKey: 'A',
          statusRaw: 'Out',
          healthRelation: 'HEALTH_RELATED',
          playerEntityId: 'A',
          canonicalModelEligible: true,
        },
      ],
      pglByEntity: pgl,
    });
    expect(snap.completeness.status).toBe('SOURCE_ONLY');
  });
});
