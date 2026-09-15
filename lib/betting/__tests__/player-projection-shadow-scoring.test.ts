import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));
import { FEATURE_C_ALLOWLIST } from '@/lib/betting/player-projection-learned-features';
import { SHADOW_FEATURE_ORDER } from '@/lib/betting/player-projection-shadow-protocol';
import {
  appendPredictionSnapshot,
  applyTipoffRevision,
  assertFeatureOrder,
  buildShadowCandidateRow,
  canWriteProductionSnapshots,
  classifyDelivery,
  classifyShadowDueWindow,
  conditionalOnPlayingMetrics,
  generateShadowCandidates,
  intendedCutoff,
  observationUsableByCutoff,
  observedRosterForTeam,
  predictionCoverage,
  settlePrediction,
  type ShadowPredictionRecord,
} from '@/lib/betting/player-projection-shadow-scoring';
import { isPregameLineupKnowledge, isPostTipConfirmedLineup } from '@/lib/context/collection-asof';
import { planInjuryCollectorExtras, injuryPullHealthClass } from '@/lib/injuries/collector-persist';
import { shouldSkipLiveMutations } from '@/lib/runtime/ingestion-mode';

const tip = '2026-10-21T00:00:00.000Z'; // cutoff 23:00Z

function rec(partial: Partial<ShadowPredictionRecord> & Pick<ShadowPredictionRecord, 'playerId' | 'gameId' | 'generatedAt'>): Omit<ShadowPredictionRecord, 'logicalKey' | 'late' | 'delivery'> {
  return {
    scheduledTipoff: tip,
    intendedCutoffAt: intendedCutoff(tip),
    modelVersion: 'player-projection-learned-r1-pts-reb-c',
    featureSpecVersion: 'player-projection-learned-features-r1',
    featureOrder: SHADOW_FEATURE_ORDER,
    featureValues: { pts_l10: 20 },
    featureChecksum: 'abc',
    modelChecksums: { points: 'p', rebounds: 'r' },
    predA: { points: 20, rebounds: 7 },
    predB: { points: 20, rebounds: 7 },
    predC: { points: 19, rebounds: 6.5 },
    eligibility: 'ok',
    sourceFreshness: {},
    tipoffRevision: 0,
    ...partial,
  };
}

describe('frozen feature order', () => {
  it('rejects a mismatched artifact order', () => {
    expect(SHADOW_FEATURE_ORDER).toEqual([...FEATURE_C_ALLOWLIST]);
    expect(() => assertFeatureOrder(['pts_l10', ...FEATURE_C_ALLOWLIST.slice(1)])).toThrow(/Feature ordering/);
  });
});

describe('cutoff and future observations', () => {
  it('excludes observations after the intended cutoff', () => {
    const cutoff = intendedCutoff(tip);
    expect(observationUsableByCutoff('2026-10-20T22:59:00.000Z', cutoff)).toBe(true);
    expect(observationUsableByCutoff('2026-10-20T23:00:01.000Z', cutoff)).toBe(false);
  });
});

describe('scheduler windows for mixed tipoffs', () => {
  it('scores each game on its own cutoff, not a shared batch time', () => {
    const earlyTip = '2026-10-21T00:00:00.000Z';
    const lateTip = '2026-10-21T03:00:00.000Z';
    const now = '2026-10-20T23:00:00.000Z';
    expect(classifyShadowDueWindow({ scheduledTipoff: earlyTip, now })).toBe('due');
    expect(classifyShadowDueWindow({ scheduledTipoff: lateTip, now })).toBe('too_early');
  });
});

describe('late generation and retries', () => {
  it('classifies post-cutoff generation as late and never backdates', () => {
    const cutoff = intendedCutoff(tip);
    expect(classifyDelivery('2026-10-20T23:20:00.000Z', cutoff)).toBe('late');
    const first = appendPredictionSnapshot({
      existing: [],
      candidate: rec({ playerId: 'p1', gameId: 'g1', generatedAt: '2026-10-20T23:20:00.000Z' }),
    });
    expect(first.accepted).toBe(true);
    expect(first.records[0].generatedAt).toBe('2026-10-20T23:20:00.000Z');
    expect(first.records[0].delivery).toBe('late');
    const retry = appendPredictionSnapshot({
      existing: first.records,
      candidate: rec({ playerId: 'p1', gameId: 'g1', generatedAt: '2026-10-20T23:25:00.000Z' }),
    });
    expect(retry.accepted).toBe(false);
    expect(retry.reason).toBe('duplicate_logical');
    expect(retry.records).toHaveLength(1);
    expect(retry.records[0].generatedAt).toBe('2026-10-20T23:20:00.000Z');
  });
});

describe('tipoff revision and postponement', () => {
  it('creates a new logical cutoff when tipoff changes and leaves the original snapshot', () => {
    const revision = applyTipoffRevision(tip, '2026-10-22T00:00:00.000Z');
    expect(revision.changed).toBe(true);
    expect(revision.nextIntendedCutoffAt).not.toBe(revision.previousIntendedCutoffAt);
    const first = appendPredictionSnapshot({
      existing: [],
      candidate: rec({ playerId: 'p1', gameId: 'g1', generatedAt: '2026-10-20T22:50:00.000Z' }),
    });
    const settled = settlePrediction({
      prediction: first.records[0],
      settlements: [],
      settledAt: '2026-10-21T04:00:00.000Z',
      outcome: 'postponed',
    });
    expect(settled.prediction.predC.points).toBe(19);
    expect(settled.settlements[0].outcome).toBe('postponed');
  });
});

describe('candidates, identity, and history', () => {
  it('builds roster from last observed team appearance, not the eventual box', () => {
    const roster = observedRosterForTeam({
      teamId: '1',
      cutoffAt: intendedCutoff(tip),
      appearances: [
        { playerId: 'p1', teamId: '1', startTime: '2026-10-18T00:00:00.000Z', played: true },
        { playerId: 'p2', teamId: '2', startTime: '2026-10-18T00:00:00.000Z', played: true },
        { playerId: 'box-only', teamId: '1', startTime: '2026-10-21T00:00:00.000Z', played: true },
      ],
    });
    expect(roster).toEqual(['p1']);
    const cands = generateShadowCandidates({
      game: {
        gameId: 'g1',
        season: '2026',
        scheduledTipoff: tip,
        homeTeamId: '1',
        awayTeamId: '2',
      },
      appearances: [
        { playerId: 'p1', teamId: '1', startTime: '2026-10-18T00:00:00.000Z', played: true },
        { playerId: 'p2', teamId: '2', startTime: '2026-10-18T00:00:00.000Z', played: true },
      ],
      unresolvedPlayerIds: ['p2'],
    });
    expect(cands.find((c) => c.playerId === 'p2')?.eligibility).toBe('unresolved_identity');
    const missing = buildShadowCandidateRow({
      playerId: 'new',
      teamId: '1',
      game: { gameId: 'g1', season: '2026', scheduledTipoff: tip, homeTeamId: '1', awayTeamId: '2' },
      allPlayerGames: [],
      tgsByGameTeam: new Map(),
      teamGamesByTeam: new Map(),
      liveSourceAvailableByCutoff: true,
    });
    expect(missing.eligibility).toBe('insufficient_history');
  });
});

describe('injury collector extras', () => {
  it('marks failed pulls degraded without inventing Available', () => {
    expect(injuryPullHealthClass({ status: 'error', complete: false })).toBe('degraded_failed_latest');
    const extras = planInjuryCollectorExtras({
      pullRunId: 9,
      observedAt: '2026-10-20T18:00:00.000Z',
      pullStatus: 'error',
      completed: true,
      rowsStored: 0,
      rowsReturned: 0,
      previousCompleteRowCount: 120,
      inReportPlayerIds: [],
    });
    expect(extras.healthClass).toBe('degraded_failed_latest');
    expect(extras.membership).toEqual([]);
  });
});

describe('post-tip lineups are not pregame knowledge', () => {
  it('keeps BDL confirmed lineups out of pregame features', () => {
    expect(isPostTipConfirmedLineup('provider_post_tip_confirmed')).toBe(true);
    expect(isPregameLineupKnowledge('provider_post_tip_confirmed')).toBe(false);
    expect(isPregameLineupKnowledge('heuristic_projected')).toBe(false);
  });
});

describe('guards vs research writes', () => {
  it('replay freeze blocks production snapshot writes even if SHADOW_SNAPSHOT_WRITES=1', () => {
    expect(
      shouldSkipLiveMutations({ DATA_MODE: 'replay', OFFSEASON_MODE: '1', CRON_DRY_RUN: '1' })
    ).toBe(true);
    expect(
      canWriteProductionSnapshots({
        DATA_MODE: 'replay',
        OFFSEASON_MODE: '1',
        CRON_DRY_RUN: '1',
        SHADOW_SNAPSHOT_WRITES: '1',
      })
    ).toBe(false);
    expect(
      canWriteProductionSnapshots({
        DATA_MODE: 'live_api',
        OFFSEASON_MODE: '0',
        CRON_DRY_RUN: '0',
        SHADOW_SNAPSHOT_WRITES: '1',
      })
    ).toBe(true);
  });
});

describe('end-to-end local fixture: score, snapshot, settle', () => {
  it('keeps the original prediction immutable after replay settlement', () => {
    const gameA = { gameId: 'g-early', season: '2026', scheduledTipoff: '2026-10-21T00:00:00.000Z', homeTeamId: '1', awayTeamId: '2' };
    const gameB = { gameId: 'g-late', season: '2026', scheduledTipoff: '2026-10-21T03:00:00.000Z', homeTeamId: '1', awayTeamId: '2' };
    const appearances = [
      { playerId: 'p1', teamId: '1', startTime: '2026-10-18T00:00:00.000Z', played: true },
    ];
    const intended = [
      { playerId: 'p1', gameId: 'g-early' },
      { playerId: 'p1', gameId: 'g-late' },
    ];
    expect(generateShadowCandidates({ game: gameA, appearances })).toHaveLength(1);
    expect(generateShadowCandidates({ game: gameB, appearances })).toHaveLength(1);
    let records: ShadowPredictionRecord[] = [];
    const first = appendPredictionSnapshot({
      existing: records,
      candidate: rec({
        playerId: 'p1',
        gameId: 'g-early',
        scheduledTipoff: gameA.scheduledTipoff,
        intendedCutoffAt: intendedCutoff(gameA.scheduledTipoff),
        generatedAt: '2026-10-20T22:50:00.000Z',
        predC: { points: 18.2, rebounds: 6.1 },
      }),
    });
    records = first.records;
    const coverage = predictionCoverage({
      intendedPopulation: intended,
      records,
    });
    expect(coverage.missing).toBeGreaterThan(0);
    const settled = settlePrediction({
      prediction: records[0],
      settlements: [],
      settledAt: '2026-10-21T03:00:00.000Z',
      outcome: 'played',
      actualPts: 22,
      actualReb: 8,
    });
    expect(records[0].predC.points).toBe(18.2);
    expect(settled.prediction.predC.points).toBe(18.2);
    const replay = settlePrediction({
      prediction: records[0],
      settlements: settled.settlements,
      settledAt: '2026-10-22T00:00:00.000Z',
      outcome: 'dnp',
      actualPts: 0,
      actualReb: 0,
    });
    expect(replay.accepted).toBe(false);
    expect(replay.settlements[0].outcome).toBe('played');
    const cond = conditionalOnPlayingMetrics([
      { y: 22, p: 18.2, played: true },
      { y: 0, p: 18.2, played: false },
    ]);
    expect(cond.n).toBe(1);
    expect(cond.mae).toBeCloseTo(3.8, 6);
  });
});
