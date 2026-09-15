import { describe, expect, it } from 'vitest';
import {
  buildPredictionSnapshot,
  intendedCutoffFromTip,
  isHeuristicLineup,
  isPostTipConfirmedLineup,
  isPregameLineupKnowledge,
  lineupSnapshotIdentity,
  resolveInjuryAsOf,
  type InjuryObservation,
  type InjuryPullRun,
} from '@/lib/context/collection-asof';

const cutoff = '2026-10-20T23:00:00.000Z';

function run(partial: Partial<InjuryPullRun> & Pick<InjuryPullRun, 'pullRunId' | 'observedAt'>): InjuryPullRun {
  return {
    status: 'success',
    complete: true,
    completenessReason: 'successful complete pull',
    memberPlayerIds: ['p1'],
    ...partial,
  };
}

function obs(partial: Partial<InjuryObservation> = {}): InjuryObservation {
  return {
    playerId: 'p1',
    providerStatus: 'Out',
    description: 'knee',
    returnDateRaw: null,
    teamId: '1',
    observedAt: '2026-10-20T18:00:00.000Z',
    sourcePublishedAt: '2026-10-20T17:55:00.000Z',
    pullRunId: 2,
    reportMembership: 'in_report',
    gameId: 'g1',
    gameLinkProvenance: 'scheduled_slate_join',
    ...partial,
  };
}

describe('injury as-of', () => {
  it('keeps last successful observation when the latest fetch fails', () => {
    const resolved = resolveInjuryAsOf({
      playerId: 'p1',
      cutoffAt: cutoff,
      runs: [
        run({ pullRunId: 1, observedAt: '2026-10-20T12:00:00.000Z' }),
        run({
          pullRunId: 2,
          observedAt: '2026-10-20T18:00:00.000Z',
          memberPlayerIds: ['p1'],
        }),
        run({
          pullRunId: 3,
          observedAt: '2026-10-20T22:00:00.000Z',
          status: 'error',
          complete: false,
          completenessReason: 'pull status is not success',
          memberPlayerIds: [],
        }),
      ],
      observations: [obs({ pullRunId: 2 })],
    });
    expect(resolved.latestPullFailed).toBe(true);
    expect(resolved.collectionHealth).toBe('degraded_failed_latest');
    expect(resolved.providerStatus).toBe('Out');
    expect(resolved.reportMembership).toBe('in_report');
    expect(resolved.observedAt).toBe('2026-10-20T18:00:00.000Z');
    expect(resolved.sourcePublishedAt).toBe('2026-10-20T17:55:00.000Z');
    expect(resolved.lastSuccessfulPullRunId).toBe(2);
  });

  it('does not treat not-in-report as healthy/available', () => {
    const resolved = resolveInjuryAsOf({
      playerId: 'p2',
      cutoffAt: cutoff,
      runs: [run({ pullRunId: 1, observedAt: '2026-10-20T18:00:00.000Z', memberPlayerIds: ['p1'] })],
      observations: [obs({ playerId: 'p1', pullRunId: 1 })],
    });
    expect(resolved.providerStatus).toBeNull();
    expect(resolved.reportMembership).toBe('not_in_report');
    expect(resolved.providerStatus).not.toBe('Available');
  });

  it('preserves RemovedFromReport instead of Available', () => {
    const resolved = resolveInjuryAsOf({
      playerId: 'p1',
      cutoffAt: cutoff,
      runs: [run({ pullRunId: 4, observedAt: '2026-10-20T18:00:00.000Z', memberPlayerIds: [] })],
      observations: [
        obs({
          pullRunId: 4,
          providerStatus: 'RemovedFromReport',
          reportMembership: 'removed_from_report',
          sourcePublishedAt: null,
        }),
      ],
    });
    expect(resolved.providerStatus).toBe('RemovedFromReport');
    expect(resolved.reportMembership).toBe('removed_from_report');
  });
});

describe('lineup snapshots', () => {
  it('separates heuristic projected from post-tip confirmed and scores team/game completeness', () => {
    const heuristic = lineupSnapshotIdentity({
      snapshotId: 's1',
      gameId: 'g1',
      teamId: '1',
      sourceKind: 'heuristic_projected',
      observedAt: cutoff,
      sourcePublishedAt: null,
      expectedStarters: 5,
      players: [
        { playerId: 'a', role: 'projected_starter' },
        { playerId: 'b', role: 'projected_starter' },
      ],
    });
    const confirmed = lineupSnapshotIdentity({
      snapshotId: 's2',
      gameId: 'g1',
      teamId: '1',
      sourceKind: 'provider_post_tip_confirmed',
      observedAt: cutoff,
      sourcePublishedAt: '2026-10-20T23:05:00.000Z',
      expectedStarters: 5,
      players: Array.from({ length: 5 }, (_, i) => ({
        playerId: `s${i}`,
        role: 'confirmed_starter' as const,
      })),
    });
    expect(isHeuristicLineup(heuristic.sourceKind)).toBe(true);
    expect(heuristic.completeness).toBe('partial');
    expect(isPostTipConfirmedLineup(confirmed.sourceKind)).toBe(true);
    expect(confirmed.completeness).toBe('complete_starters');
  });
});

describe('prediction snapshots', () => {
  it('never backdates a late generation to the intended cutoff', () => {
    const tip = '2026-10-21T00:00:00.000Z';
    const intended = intendedCutoffFromTip(tip, 60);
    expect(intended).toBe('2026-10-20T23:00:00.000Z');
    const snap = buildPredictionSnapshot({
      playerId: 'p1',
      gameId: 'g1',
      scheduledTipoff: tip,
      intendedCutoffAt: intended,
      generatedAt: '2026-10-20T23:20:00.000Z',
      modelVersion: 'learned-r1',
      featureSpecVersion: 'player-projection-learned-features-r1',
      featureRef: 'hash:abc',
      predictions: { points: 18.2 },
    });
    expect(snap.late).toBe(true);
    expect(snap.actualGeneratedAt).toBe('2026-10-20T23:20:00.000Z');
    expect(snap.actualGeneratedAt).not.toBe(intended);
    expect(snap.intendedCutoffAt).toBe(intended);
    expect(snap.freshness.minutesLate).toBe(20);
  });
});

describe('lineup knowledge classes', () => {
  it('does not treat heuristic or post-tip confirmed as pregame provider knowledge', () => {
    expect(isPregameLineupKnowledge('heuristic_projected')).toBe(false);
    expect(isPregameLineupKnowledge('provider_post_tip_confirmed')).toBe(false);
    expect(isPregameLineupKnowledge('provider_projected')).toBe(true);
  });
});
