import { describe, expect, it } from 'vitest';
import {
  createProspectivePrediction,
  emptyProspectiveEvaluationReport,
  joinOutcome,
  rewritePredictionAfterOutcome,
  assertPtsAndRebRemainSeparate,
  assertSameExampleWowyComparison,
  assertWowyNotComparedToFullBaseline,
  FUTURE_ACTIVATION_SEQUENCE,
  SAMPLE_SIZE_POLICY,
  SHADOW_COHORT_IDS,
  SHADOW_INFRASTRUCTURE_READINESS,
  SHADOW_SCORING_STATUS,
  INJURY_COLLECTION_STATUS,
  PROVIDER_ENTITLEMENT,
  PROTOCOL_MACHINE_RECORD,
  materialChangeRequiresNewVersion,
  type ProspectivePredictionRecord,
} from '@/lib/model-lab/prospective-shadow-protocol';
import { datasetRoleForSplit, isPristineHoldout, markAsPristineHoldout } from '@/lib/model-lab/dataset-roles';
import { filterWalkForwardRows, futureRowsPresent } from '@/lib/model-lab/walk-forward';
import { SHADOW_MODEL_VERSION, SHADOW_FEATURE_SPEC_VERSION } from '@/lib/betting/player-projection-shadow-protocol';

const tip = '2026-10-21T00:00:00.000Z';
const cutoff = '2026-10-20T23:00:00.000Z';

function baseArgs(market: 'points' | 'rebounds') {
  return {
    generatedAt: '2026-10-20T22:50:00.000Z',
    contextCutoff: cutoff,
    gameId: 'g1',
    scheduledTip: tip,
    playerCanonicalId: 'p1',
    teamId: 'BOS',
    opponentTeamId: 'NYK',
    market,
    modelVersion: SHADOW_MODEL_VERSION,
    featureVersion: SHADOW_FEATURE_SPEC_VERSION,
    controlPrediction: 22.1,
    candidatePrediction: 21.4,
    capturedFeatureValues: { pts_l10: 21 },
    capturedFeatureEventTimestamps: ['2026-10-19T00:00:00.000Z'],
    candidateContextFieldsAvailable: ['pts_l10'],
    missingContextFields: ['primary_teammate_status'],
    dataFreshness: { injuries: 'blocked' },
    eligible: true,
  };
}

describe('prospective prediction timestamp and walk-forward', () => {
  it('requires generated_at to precede the game cutoff', () => {
    expect(() =>
      createProspectivePrediction({
        ...baseArgs('points'),
        generatedAt: '2026-10-20T23:01:00.000Z',
      })
    ).toThrow(/after context cutoff/);
    const row = createProspectivePrediction(baseArgs('points'));
    expect(row.generatedAt < row.contextCutoff).toBe(true);
    expect(row.outcomeForbidden).toBe(true);
  });

  it('rejects future rows from captured features', () => {
    expect(
      futureRowsPresent(
        [
          { timestamp: '2026-10-19T00:00:00.000Z' },
          { timestamp: '2026-10-20T23:30:00.000Z' },
        ],
        cutoff
      )
    ).toBe(true);
    expect(filterWalkForwardRows([{ timestamp: '2026-10-19T00:00:00.000Z' }, { timestamp: cutoff }], cutoff)).toHaveLength(
      1
    );
    expect(() =>
      createProspectivePrediction({
        ...baseArgs('points'),
        capturedFeatureEventTimestamps: ['2026-10-21T01:00:00.000Z'],
      })
    ).toThrow(/Walk-forward violation/);
  });
});

describe('prediction immutability after outcome join', () => {
  it('joins outcomes without rewriting prediction values', () => {
    const prediction = createProspectivePrediction(baseArgs('points'));
    const originalCandidate = prediction.candidatePrediction;
    const { prediction: after, outcome } = joinOutcome({
      prediction,
      joinedAt: '2026-10-21T04:00:00.000Z',
      actual: 25,
      outcomeClass: 'played',
      source: 'box_score',
    });
    expect(after).toBe(prediction);
    expect(after.candidatePrediction).toBe(originalCandidate);
    expect(outcome.actual).toBe(25);
    expect(outcome.predictionId).toBe(prediction.predictionId);
    expect(() => rewritePredictionAfterOutcome(prediction, { candidatePrediction: 99 } as Partial<ProspectivePredictionRecord>)).toThrow(
      /immutable after outcome join/
    );
  });
});

describe('market and WOWY cohorts', () => {
  it('keeps PTS and REB cohorts separate', () => {
    expect(() => assertPtsAndRebRemainSeparate(['points'])).not.toThrow();
    expect(() => assertPtsAndRebRemainSeparate(['points', 'rebounds'])).toThrow(/separately/);
    const pts = createProspectivePrediction(baseArgs('points'));
    const reb = createProspectivePrediction(baseArgs('rebounds'));
    expect(pts.experimentCohortFlags.ALL_ELIGIBLE_PTS_C).toBe(true);
    expect(pts.experimentCohortFlags.ALL_ELIGIBLE_REB_C).toBe(false);
    expect(reb.experimentCohortFlags.ALL_ELIGIBLE_REB_C).toBe(true);
    expect(pts.predictionId).not.toBe(reb.predictionId);
  });

  it('requires same-example WOWY comparison and forbids full-population substitution', () => {
    const id = 'p1|g1|points|m|c';
    expect(() => assertSameExampleWowyComparison({ controlPredictionIds: [id], candidatePredictionIds: [id] })).not.toThrow();
    expect(() =>
      assertSameExampleWowyComparison({ controlPredictionIds: [id], candidatePredictionIds: [`${id}|other`] })
    ).toThrow(/same qualified examples|populations differ/);
    expect(() =>
      assertWowyNotComparedToFullBaseline({ wowyCohort: true, comparedAgainstFullPopulation: true })
    ).toThrow(/full baseline population/);
    expect(SHADOW_COHORT_IDS.WOWY_QUALIFIED).toBe('WOWY_QUALIFIED');
  });
});

describe('dataset role defaults', () => {
  it('cannot mark previously inspected data as pristine holdout through default config', () => {
    expect(isPristineHoldout('historical_confirmation')).toBe(false);
    expect(datasetRoleForSplit('historical_confirmation').pristineHoldout).toBe(false);
    expect(() => markAsPristineHoldout('historical_confirmation')).toThrow(/pristine holdout/);
    expect(isPristineHoldout('selection')).toBe(false);
    expect(isPristineHoldout('prospective_shadow')).toBe(true);
    expect(markAsPristineHoldout('prospective_shadow').role).toBe('PROSPECTIVE');
  });
});

describe('activation remains blocked', () => {
  it('keeps scoring disabled and sample size uninvented', () => {
    expect(SHADOW_SCORING_STATUS).toBe('DISABLED');
    expect(INJURY_COLLECTION_STATUS).toBe('DISABLED');
    expect(PROVIDER_ENTITLEMENT).toBe('BLOCKED_BY_ENTITLEMENT');
    expect(SHADOW_INFRASTRUCTURE_READINESS).toBe('PARTIAL');
    expect(SAMPLE_SIZE_POLICY.nTarget).toBe('POWER_ANALYSIS_REQUIRED_BEFORE_ACTIVATION');
    expect(FUTURE_ACTIVATION_SEQUENCE).toHaveLength(15);
    expect(PROTOCOL_MACHINE_RECORD.liveScoring).toBe('DISABLED');
    expect(emptyProspectiveEvaluationReport().cherryPickedDateRemovalForbidden).toBe(true);
    expect(materialChangeRequiresNewVersion('model artifact')).toMatch(/new experiment/);
  });
});
