/**
 * Blind held-out fixtures for Availability / Team Injury Burden V2.
 * Frozen before final certification. Expected outputs from computeTeamGameAvailability.
 */
import type { TeamInjuryBurdenInput } from '@/lib/context-center';
import type { PlayerRoleEstimate } from '@/lib/context-center';

const TIP = '2024-03-01T00:00:00Z';
const AS_OF = '2024-02-29T23:00:00Z';

function est(
  eid: string,
  mins: number,
  fga: number,
  pts: number
): PlayerRoleEstimate {
  return {
    playerEntityId: eid,
    season: '2023',
    teamId: '7',
    historyN: 4,
    expectedMinutes: mins,
    expectedFga: fga,
    expectedPoints: pts,
    historyMaxGameStart: '2024-02-20T00:00:00Z',
    targetGameStart: TIP,
    roleExpectationVersion: 'player-role-expectation-v1',
  };
}

export type HeldOutCase = {
  id: string;
  category: string;
  input: TeamInjuryBurdenInput;
  expected: {
    completeness: string;
    healthOutCount: number | null;
    healthOutSourceCount: number | null;
    healthOutUnresolvedCount: number | null;
    expectedMissingMinutes: number | null;
    expectedMissingFga: number | null;
    expectedMissingPoints: number | null;
    missingRotationShare: number | null;
    maxMissingPriorMpg: number | null;
    rotationPlayersOutCount: number | null;
    duplicateBurdenContributions: number;
  };
};

function base(
  id: string,
  category: string,
  overrides: Partial<TeamInjuryBurdenInput>,
  expected: HeldOutCase['expected']
): HeldOutCase {
  return {
    id,
    category,
    input: {
      gameId: id,
      teamId: '7',
      season: '2023',
      gameStart: TIP,
      asOf: AS_OF,
      injuryReportPublishedAt: '2024-02-29T22:30:00.000Z',
      teamState: 'SUBMITTED_WITH_PLAYER_ROWS',
      healthOutContributors: [],
      healthQuestionableCount: 0,
      healthDoubtfulCount: 0,
      healthProbableCount: 0,
      nonHealthOutCount: 0,
      ...overrides,
    },
    expected,
  };
}

export const HELDOUT_CASES: HeldOutCase[] = [
  base(
    'ho-zero-out',
    'zero_Out',
    {},
    {
      completeness: 'COMPLETE',
      healthOutCount: 0,
      healthOutSourceCount: 0,
      healthOutUnresolvedCount: 0,
      expectedMissingMinutes: 0,
      expectedMissingFga: 0,
      expectedMissingPoints: 0,
      missingRotationShare: 0,
      maxMissingPriorMpg: null,
      rotationPlayersOutCount: 0,
      duplicateBurdenContributions: 0,
    }
  ),
  base(
    'ho-single-out',
    'single_Out',
    {
      healthOutContributors: [
        { sourceKey: 'A', playerEntityId: 'A', canonical: true, roleEstimate: est('A', 32, 14, 18) },
      ],
    },
    {
      completeness: 'COMPLETE',
      healthOutCount: 1,
      healthOutSourceCount: 1,
      healthOutUnresolvedCount: 0,
      expectedMissingMinutes: 32,
      expectedMissingFga: 14,
      expectedMissingPoints: 18,
      missingRotationShare: 32 / 240,
      maxMissingPriorMpg: 32,
      rotationPlayersOutCount: 1,
      duplicateBurdenContributions: 0,
    }
  ),
  base(
    'ho-multi-out',
    'multi_Out',
    {
      healthOutContributors: [
        { sourceKey: 'A', playerEntityId: 'A', canonical: true, roleEstimate: est('A', 30, 15, 20) },
        { sourceKey: 'B', playerEntityId: 'B', canonical: true, roleEstimate: est('B', 20, 8, 10) },
      ],
    },
    {
      completeness: 'COMPLETE',
      healthOutCount: 2,
      healthOutSourceCount: 2,
      healthOutUnresolvedCount: 0,
      expectedMissingMinutes: 50,
      expectedMissingFga: 23,
      expectedMissingPoints: 30,
      missingRotationShare: 50 / 240,
      maxMissingPriorMpg: 30,
      rotationPlayersOutCount: 2,
      duplicateBurdenContributions: 0,
    }
  ),
  base(
    'ho-cold-start',
    'cold_start',
    {
      healthOutContributors: [
        { sourceKey: 'A', playerEntityId: 'A', canonical: true, roleEstimate: null },
      ],
    },
    {
      completeness: 'SOURCE_ONLY',
      healthOutCount: 1,
      healthOutSourceCount: 1,
      healthOutUnresolvedCount: 0,
      expectedMissingMinutes: null,
      expectedMissingFga: null,
      expectedMissingPoints: null,
      missingRotationShare: null,
      maxMissingPriorMpg: null,
      rotationPlayersOutCount: null,
      duplicateBurdenContributions: 0,
    }
  ),
  base(
    'ho-partial',
    'partial_role_coverage',
    {
      healthOutContributors: [
        { sourceKey: 'A', playerEntityId: 'A', canonical: true, roleEstimate: est('A', 28, 12, 16) },
        { sourceKey: 'B', playerEntityId: 'B', canonical: true, roleEstimate: null },
      ],
    },
    {
      completeness: 'PARTIAL',
      healthOutCount: 2,
      healthOutSourceCount: 2,
      healthOutUnresolvedCount: 0,
      expectedMissingMinutes: 28,
      expectedMissingFga: 12,
      expectedMissingPoints: 16,
      missingRotationShare: 28 / 240,
      maxMissingPriorMpg: 28,
      rotationPlayersOutCount: 1,
      duplicateBurdenContributions: 0,
    }
  ),
  base(
    'ho-unresolved',
    'unresolved_identity',
    {
      healthOutContributors: [
        { sourceKey: 'raw', playerEntityId: null, canonical: false, roleEstimate: null },
        { sourceKey: 'A', playerEntityId: 'A', canonical: true, roleEstimate: est('A', 24, 9, 11) },
      ],
    },
    {
      completeness: 'PARTIAL',
      healthOutCount: 1,
      healthOutSourceCount: 2,
      healthOutUnresolvedCount: 1,
      expectedMissingMinutes: 24,
      expectedMissingFga: 9,
      expectedMissingPoints: 11,
      missingRotationShare: 24 / 240,
      maxMissingPriorMpg: 24,
      rotationPlayersOutCount: 1,
      duplicateBurdenContributions: 0,
    }
  ),
  base(
    'ho-qdp',
    'Q_D_P',
    {
      healthQuestionableCount: 3,
      healthDoubtfulCount: 1,
      healthProbableCount: 2,
    },
    {
      completeness: 'COMPLETE',
      healthOutCount: 0,
      healthOutSourceCount: 0,
      healthOutUnresolvedCount: 0,
      expectedMissingMinutes: 0,
      expectedMissingFga: 0,
      expectedMissingPoints: 0,
      missingRotationShare: 0,
      maxMissingPriorMpg: null,
      rotationPlayersOutCount: 0,
      duplicateBurdenContributions: 0,
    }
  ),
  base(
    'ho-nonhealth',
    'non_health_Out',
    {
      nonHealthOutCount: 4,
      healthOutContributors: [
        { sourceKey: 'A', playerEntityId: 'A', canonical: true, roleEstimate: est('A', 22, 7, 9) },
      ],
    },
    {
      completeness: 'COMPLETE',
      healthOutCount: 1,
      healthOutSourceCount: 1,
      healthOutUnresolvedCount: 0,
      expectedMissingMinutes: 22,
      expectedMissingFga: 7,
      expectedMissingPoints: 9,
      missingRotationShare: 22 / 240,
      maxMissingPriorMpg: 22,
      rotationPlayersOutCount: 1,
      duplicateBurdenContributions: 0,
    }
  ),
  base(
    'ho-source-unknown',
    'source_unknown',
    { teamState: 'NOT_YET_SUBMITTED' },
    {
      completeness: 'SOURCE_UNKNOWN',
      healthOutCount: null,
      healthOutSourceCount: null,
      healthOutUnresolvedCount: null,
      expectedMissingMinutes: null,
      expectedMissingFga: null,
      expectedMissingPoints: null,
      missingRotationShare: null,
      maxMissingPriorMpg: null,
      rotationPlayersOutCount: null,
      duplicateBurdenContributions: 0,
    }
  ),
  base(
    'ho-mpg-19.9',
    'boundary_19.9',
    {
      healthOutContributors: [
        { sourceKey: 'A', playerEntityId: 'A', canonical: true, roleEstimate: est('A', 19.9, 6, 8) },
      ],
    },
    {
      completeness: 'COMPLETE',
      healthOutCount: 1,
      healthOutSourceCount: 1,
      healthOutUnresolvedCount: 0,
      expectedMissingMinutes: 19.9,
      expectedMissingFga: 6,
      expectedMissingPoints: 8,
      missingRotationShare: 19.9 / 240,
      maxMissingPriorMpg: 19.9,
      rotationPlayersOutCount: 0,
      duplicateBurdenContributions: 0,
    }
  ),
  base(
    'ho-mpg-20',
    'boundary_20',
    {
      healthOutContributors: [
        { sourceKey: 'A', playerEntityId: 'A', canonical: true, roleEstimate: est('A', 20.0, 6, 8) },
      ],
    },
    {
      completeness: 'COMPLETE',
      healthOutCount: 1,
      healthOutSourceCount: 1,
      healthOutUnresolvedCount: 0,
      expectedMissingMinutes: 20,
      expectedMissingFga: 6,
      expectedMissingPoints: 8,
      missingRotationShare: 20 / 240,
      maxMissingPriorMpg: 20,
      rotationPlayersOutCount: 1,
      duplicateBurdenContributions: 0,
    }
  ),
  base(
    'ho-duplicate',
    'duplicate_input',
    {
      healthOutContributors: [
        { sourceKey: 'A1', playerEntityId: 'A', canonical: true, roleEstimate: est('A', 30, 10, 12) },
        { sourceKey: 'A2', playerEntityId: 'A', canonical: true, roleEstimate: est('A', 30, 10, 12) },
      ],
    },
    {
      completeness: 'COMPLETE',
      healthOutCount: 1,
      healthOutSourceCount: 2,
      healthOutUnresolvedCount: 0,
      expectedMissingMinutes: 30,
      expectedMissingFga: 10,
      expectedMissingPoints: 12,
      missingRotationShare: 30 / 240,
      maxMissingPriorMpg: 30,
      rotationPlayersOutCount: 1,
      duplicateBurdenContributions: 1,
    }
  ),
  base(
    'ho-zero-complete',
    'zero_Out_completeness',
    {},
    {
      completeness: 'COMPLETE',
      healthOutCount: 0,
      healthOutSourceCount: 0,
      healthOutUnresolvedCount: 0,
      expectedMissingMinutes: 0,
      expectedMissingFga: 0,
      expectedMissingPoints: 0,
      missingRotationShare: 0,
      maxMissingPriorMpg: null,
      rotationPlayersOutCount: 0,
      duplicateBurdenContributions: 0,
    }
  ),
  base(
    'ho-source-absent',
    'source_unknown_absent',
    { teamState: 'SOURCE_ABSENT' },
    {
      completeness: 'SOURCE_UNKNOWN',
      healthOutCount: null,
      healthOutSourceCount: null,
      healthOutUnresolvedCount: null,
      expectedMissingMinutes: null,
      expectedMissingFga: null,
      expectedMissingPoints: null,
      missingRotationShare: null,
      maxMissingPriorMpg: null,
      rotationPlayersOutCount: null,
      duplicateBurdenContributions: 0,
    }
  ),
  base(
    'ho-block-missing',
    'source_unknown_block',
    { teamState: 'TEAM_BLOCK_MISSING' },
    {
      completeness: 'SOURCE_UNKNOWN',
      healthOutCount: null,
      healthOutSourceCount: null,
      healthOutUnresolvedCount: null,
      expectedMissingMinutes: null,
      expectedMissingFga: null,
      expectedMissingPoints: null,
      missingRotationShare: null,
      maxMissingPriorMpg: null,
      rotationPlayersOutCount: null,
      duplicateBurdenContributions: 0,
    }
  ),
];
