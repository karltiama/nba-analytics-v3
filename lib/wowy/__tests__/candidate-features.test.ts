import { describe, expect, it } from 'vitest';
import { selectObservedPregameScenario } from '../availability-gate';
import {
  buildWowyCandidateFeatures,
  rankTeammatesByPriorMinutes,
  type WowyRosterAppearance,
} from '../candidate-features';
import type { WowyLoadedGame } from '../types';

const cutoff = '2025-01-10T17:00:00.000Z';

function appearance(
  playerId: string,
  gameId: string,
  startTime: string,
  minutes: string,
  teamId = '8'
): WowyRosterAppearance {
  return { playerId, gameId, startTime, teamId, minutes };
}

function pairGame(
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
    subjectReb: 8,
    subjectAst: 6,
    subjectTpm: 1,
    subjectFga: 14,
    subjectTpa: 4,
    subjectFta: 3,
    teammateRowPresent: true,
    teammateTeamId: '8',
    teammateMinutes: '28',
    teammatePts: 10,
    teammateReb: 4,
    teammateAst: 5,
    teammateTpm: 1,
    teammateFga: 9,
    teammateFta: 2,
    homeTeamId: '8',
    teamPts: null,
    teamReb: null,
    teamAst: null,
    teamTpm: null,
    teamFga: null,
    teamTpa: null,
    teamFta: null,
    teamOppPts: null,
    ...extra,
  };
}

/** Two shared played games so primary minutes clear the 50/2 floor. */
function priorAppearances(teammateId: string, minutes = '30'): WowyRosterAppearance[] {
  return [
    appearance('A', 'g1', '2025-01-04T00:00:00.000Z', '30'),
    appearance(teammateId, 'g1', '2025-01-04T00:00:00.000Z', minutes),
    appearance('A', 'g2', '2025-01-06T00:00:00.000Z', '30'),
    appearance(teammateId, 'g2', '2025-01-06T00:00:00.000Z', minutes),
  ];
}

function priorPairGames(opts?: { withPts?: number; withoutPts?: number }): WowyLoadedGame[] {
  return [
    pairGame('g1', '2025-01-04T00:00:00.000Z', { subjectPts: opts?.withPts ?? 18 }),
    pairGame('g2', '2025-01-06T00:00:00.000Z', { subjectPts: opts?.withPts ?? 18 }),
    pairGame('g3', '2025-01-08T00:00:00.000Z', {
      teammateMinutes: '00',
      subjectPts: opts?.withoutPts ?? 24,
    }),
    pairGame('g4', '2025-01-09T00:00:00.000Z', {
      teammateMinutes: '00',
      subjectPts: opts?.withoutPts ?? 24,
    }),
  ];
}

describe('rankTeammatesByPriorMinutes', () => {
  it('ranks by prior shared minutes, not by historical scoring gap', () => {
    const appearances: WowyRosterAppearance[] = [
      ...priorAppearances('STARTER', '32'),
      appearance('A', 'g1', '2025-01-04T00:00:00.000Z', '30'),
      appearance('BENCH', 'g1', '2025-01-04T00:00:00.000Z', '8'),
      appearance('A', 'g2', '2025-01-06T00:00:00.000Z', '30'),
      appearance('BENCH', 'g2', '2025-01-06T00:00:00.000Z', '8'),
    ];
    const ranked = rankTeammatesByPriorMinutes({
      subjectPlayerId: 'A',
      teamId: '8',
      cutoffStartTime: cutoff,
      appearances,
    });
    expect(ranked[0]?.playerId).toBe('STARTER');
    expect(ranked[0]?.priorPlayedMinutes).toBeGreaterThan(ranked[1]?.priorPlayedMinutes ?? 0);
  });

  it('does not pool a later team stint into the queried team', () => {
    const appearances: WowyRosterAppearance[] = [
      ...priorAppearances('B', '30'),
      appearance('A', 'trade-game', '2025-01-08T00:00:00.000Z', '40', '14'),
      appearance('STAR', 'trade-game', '2025-01-08T00:00:00.000Z', '40', '14'),
    ];
    const ranked = rankTeammatesByPriorMinutes({
      subjectPlayerId: 'A',
      teamId: '8',
      cutoffStartTime: cutoff,
      appearances,
    });
    expect(ranked.map((r) => r.playerId)).toEqual(['B']);
  });

  it('excludes the target game and same-ET-date appearances', () => {
    const appearances: WowyRosterAppearance[] = [
      appearance('A', 'target', cutoff, '30'),
      appearance('NEW', 'target', cutoff, '40'),
      appearance('A', 'same-et', '2025-01-10T16:00:00.000Z', '30'),
      appearance('NEW', 'same-et', '2025-01-10T16:00:00.000Z', '40'),
    ];
    const ranked = rankTeammatesByPriorMinutes({
      subjectPlayerId: 'A',
      teamId: '8',
      cutoffStartTime: cutoff,
      appearances,
    });
    expect(ranked).toEqual([]);
  });
});

describe('selectObservedPregameScenario', () => {
  it('keeps availability unknown when there is no pre-cutoff observation', () => {
    const gate = selectObservedPregameScenario({
      teammatePlayerId: 'B',
      cutoffStartTime: cutoff,
      observations: [
        { playerId: 'B', teamId: '8', status: 'Out', snapshotAt: cutoff },
        { playerId: 'B', teamId: '8', status: 'Out', snapshotAt: '2025-01-10T18:00:00.000Z' },
      ],
    });
    expect(gate.scenario.status).toBe('unknown');
    expect(gate.predictiveEligible).toBe(false);
    expect(gate.reason).toBe('observation_on_or_after_cutoff');
  });

  it('does not treat Questionable as a with/without scenario', () => {
    const gate = selectObservedPregameScenario({
      teammatePlayerId: 'B',
      cutoffStartTime: cutoff,
      observations: [{ playerId: 'B', teamId: '8', status: 'Questionable', snapshotAt: '2025-01-10T12:00:00.000Z' }],
    });
    expect(gate.scenario.status).toBe('unknown');
    expect(gate.reason).toBe('status_not_binary');
  });

  it('selects without from a timestamped Out status before cutoff', () => {
    const gate = selectObservedPregameScenario({
      teammatePlayerId: 'B',
      cutoffStartTime: cutoff,
      observations: [{ playerId: 'B', teamId: '8', status: 'Out', snapshotAt: '2025-01-10T12:00:00.000Z' }],
    });
    expect(gate.scenario).toMatchObject({ status: 'observed_pregame', choice: 'without' });
    expect(gate.predictiveEligible).toBe(true);
  });
});

describe('buildWowyCandidateFeatures', () => {
  it('excludes future games and is unchanged when the target box is mutated', () => {
    const appearances = [
      ...priorAppearances('B'),
      appearance('A', 'target', cutoff, '30'),
      appearance('B', 'target', cutoff, '00'),
      appearance('A', 'future', '2025-01-12T00:00:00.000Z', '30'),
      appearance('B', 'future', '2025-01-12T00:00:00.000Z', '30'),
    ];
    const baseGames = [
      ...priorPairGames(),
      pairGame('target', cutoff, { subjectPts: 99, teammateMinutes: '00' }),
      pairGame('future', '2025-01-12T00:00:00.000Z', { subjectPts: 50 }),
    ];
    const first = buildWowyCandidateFeatures({
      subjectPlayerId: 'A',
      subjectName: 'A',
      teamId: '8',
      season: '2024',
      cutoffStartTime: cutoff,
      appearances,
      gamesByTeammate: { B: baseGames },
    });
    const mutated = buildWowyCandidateFeatures({
      subjectPlayerId: 'A',
      subjectName: 'A',
      teamId: '8',
      season: '2024',
      cutoffStartTime: cutoff,
      appearances: [
        ...priorAppearances('B'),
        appearance('A', 'target', cutoff, '40'),
        appearance('B', 'target', cutoff, '00'),
        appearance('A', 'future', '2025-01-12T00:00:00.000Z', '12'),
        appearance('B', 'future', '2025-01-12T00:00:00.000Z', '00'),
      ],
      gamesByTeammate: {
        B: [
          ...priorPairGames(),
          pairGame('target', cutoff, { subjectPts: 3, teammateMinutes: '00', teammateRowPresent: true }),
          pairGame('future', '2025-01-12T00:00:00.000Z', { subjectPts: 4, teammateMinutes: '00' }),
        ],
      },
    });
    expect(first.primaryTeammateId).toBe('B');
    expect(first.features.wowy_primary_with_pts).toBe(18);
    expect(first.features.wowy_primary_without_pts).toBe(24);
    expect(first.features.wowy_primary_with_games).toBe(2);
    expect(first.features.wowy_primary_without_games).toBe(2);
    expect(mutated.features).toEqual(first.features);
    expect(mutated.primaryTeammateId).toBe(first.primaryTeammateId);
    expect(first.scenario.status).toBe('unknown');
  });

  it('does not select a scenario from realized target-game teammate participation', () => {
    const row = buildWowyCandidateFeatures({
      subjectPlayerId: 'A',
      subjectName: 'A',
      teamId: '8',
      season: '2024',
      cutoffStartTime: cutoff,
      appearances: priorAppearances('B'),
      gamesByTeammate: {
        B: [...priorPairGames(), pairGame('target', cutoff, { teammateMinutes: '00' })],
      },
    });
    expect(row.scenario.status).toBe('unknown');
    expect(row.features.wowy_scenario_without).toBeNull();
    expect(row.predictiveEligible).toBe(false);
  });

  it('selects the higher-prior-minutes teammate even when the other has a larger historical PTS gap', () => {
    const appearances: WowyRosterAppearance[] = [
      ...priorAppearances('STARTER', '32'),
      appearance('A', 'g1', '2025-01-04T00:00:00.000Z', '30'),
      appearance('SPARK', 'g1', '2025-01-04T00:00:00.000Z', '10'),
      appearance('A', 'g2', '2025-01-06T00:00:00.000Z', '30'),
      appearance('SPARK', 'g2', '2025-01-06T00:00:00.000Z', '10'),
    ];
    const row = buildWowyCandidateFeatures({
      subjectPlayerId: 'A',
      subjectName: 'A',
      teamId: '8',
      season: '2024',
      cutoffStartTime: cutoff,
      appearances,
      gamesByTeammate: {
        STARTER: priorPairGames({ withPts: 20, withoutPts: 21 }),
        SPARK: priorPairGames({ withPts: 10, withoutPts: 40 }),
      },
    });
    expect(row.primaryTeammateId).toBe('STARTER');
    expect(row.features.wowy_primary_delta_pts).toBeCloseTo(-1);
    expect(row.trackedTeammateIds).toEqual(['STARTER', 'SPARK']);
    expect(row.features.wowy_overlap_flag).toBe(1);
  });

  it('leaves diffs missing when WOWY support is insufficient instead of filling zero', () => {
    const row = buildWowyCandidateFeatures({
      subjectPlayerId: 'A',
      subjectName: 'A',
      teamId: '8',
      season: '2024',
      cutoffStartTime: cutoff,
      appearances: priorAppearances('B'),
      gamesByTeammate: {
        B: [pairGame('g1', '2025-01-04T00:00:00.000Z'), pairGame('g3', '2025-01-08T00:00:00.000Z', { teammateMinutes: '00' })],
      },
    });
    expect(row.supportTier).toBe('insufficient');
    expect(row.features.wowy_primary_delta_pts).toBeNull();
    expect(row.features.wowy_primary_with_pts).toBe(20);
    expect(row.features.wowy_primary_without_pts).toBe(20);
  });

  it('keeps unknown comparisons unknown and does not treat missing observations as zero effect', () => {
    const row = buildWowyCandidateFeatures({
      subjectPlayerId: 'A',
      subjectName: 'A',
      teamId: '8',
      season: '2024',
      cutoffStartTime: cutoff,
      appearances: priorAppearances('B'),
      gamesByTeammate: { B: priorPairGames() },
      observations: [],
    });
    expect(row.scenario.status).toBe('unknown');
    expect(row.features.wowy_scenario_known).toBe(0);
    expect(row.features.wowy_scenario_without).toBeNull();
    expect(row.features.wowy_predictive_eligible).toBe(0);
    expect(row.unavailableReason).toBe('pregame_availability_unknown');
  });

  it('marks a row predictive-eligible only from pre-cutoff Out observations', () => {
    const row = buildWowyCandidateFeatures({
      subjectPlayerId: 'A',
      subjectName: 'A',
      teamId: '8',
      season: '2024',
      cutoffStartTime: cutoff,
      appearances: priorAppearances('B'),
      gamesByTeammate: { B: priorPairGames() },
      observations: [{ playerId: 'B', teamId: '8', status: 'Out', snapshotAt: '2025-01-09T12:00:00.000Z' }],
    });
    expect(row.scenario.status).toBe('observed_pregame');
    expect(row.predictiveEligible).toBe(true);
    expect(row.features.wowy_scenario_without).toBe(1);
  });

  it('labels an explicit hypothetical without making it predictive-eligible', () => {
    const row = buildWowyCandidateFeatures({
      subjectPlayerId: 'A',
      subjectName: 'A',
      teamId: '8',
      season: '2024',
      cutoffStartTime: cutoff,
      appearances: priorAppearances('B'),
      gamesByTeammate: { B: priorPairGames() },
      hypotheticalChoice: 'without',
    });
    expect(row.scenario.status).toBe('hypothetical');
    expect(row.predictiveEligible).toBe(false);
    expect(row.features.wowy_predictive_eligible).toBe(0);
  });

  it('does not emit summed multi-teammate diffs on the allowlist', () => {
    const appearances: WowyRosterAppearance[] = [
      ...priorAppearances('B', '30'),
      appearance('C', 'g1', '2025-01-04T00:00:00.000Z', '20'),
      appearance('C', 'g2', '2025-01-06T00:00:00.000Z', '20'),
    ];
    const row = buildWowyCandidateFeatures({
      subjectPlayerId: 'A',
      subjectName: 'A',
      teamId: '8',
      season: '2024',
      cutoffStartTime: cutoff,
      appearances,
      gamesByTeammate: {
        B: priorPairGames({ withPts: 20, withoutPts: 24 }),
        C: priorPairGames({ withPts: 20, withoutPts: 30 }),
      },
    });
    expect(row.overlapPolicy).toBe('primary_teammate_only');
    expect(row.primaryTeammateId).toBe('B');
    expect(row.features.wowy_primary_delta_pts).toBeCloseTo(-4);
    expect(Object.keys(row.features).some((k) => k.includes('sum') || k.includes('secondary_delta'))).toBe(
      false
    );
  });
});
