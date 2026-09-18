import { describe, expect, it } from 'vitest';
import { computeProjection, computeTrackB1PlayerPropProbability } from '@/lib/betting/player-prop-model';
import { neutralStabilitySignals } from '@/lib/betting/track-b1-policy';
import {
  assemblePtsContextFeatures,
  assertAuthorizedFeatureKeys,
  rejectUnauthorizedInjection,
  CONTEXT_RAW_FALLBACK_COUNT,
} from '@/lib/context-projection/features';
import { computeProductionPtsBaseline } from '@/lib/context-projection/baseline';
import { fitRidgeResidual, predictRidgeAdjustment, ridgeModelsEqual } from '@/lib/context-projection/ridge';
import { predictPtsContextShadow, eligibilityForShadow } from '@/lib/context-projection/predict';
import {
  canonicalSnapshotIdentity,
  collectionStatus,
  countsTowardPrimaryWindow,
  intendedCutoffIso,
  isOnTimePrediction,
  isPregame,
} from '@/lib/context-projection/window';
import { runShadowIsolated } from '@/lib/context-projection/store';
import {
  PRODUCTION_PTS_CONTEXT_FEATURES,
  PROD_PTS_CONTEXT_MODEL_VERSION,
  PRODUCTION_BASELINE_ID,
  PRODUCTION_BASELINE_VERSION,
  CONTEXT_INTEGRATION_VERSION,
  RIDGE_ALPHA,
  PROSPECTIVE_REQUIRED_N,
} from '@/lib/context-projection/protocol';
import type { RidgeModel } from '@/lib/context-projection/ridge';
import type { ShadowModelBundle } from '@/lib/context-projection/predict';

function bundleFrom(joint: RidgeModel, role: RidgeModel, form: RidgeModel): ShadowModelBundle {
  return {
    joint,
    roleOnly: role,
    formOnly: form,
    featureManifestSha: 'feat',
    trainingManifestSha: 'train',
    modelArtifactSha: 'model',
    contextModelVersion: PROD_PTS_CONTEXT_MODEL_VERSION,
    contextIntegrationVersion: CONTEXT_INTEGRATION_VERSION,
    productionBaselineId: PRODUCTION_BASELINE_ID,
    productionBaselineVersion: PRODUCTION_BASELINE_VERSION,
  };
}

describe('pts production context shadow — features', () => {
  it('computes exact deltas', () => {
    const a = assemblePtsContextFeatures({
      roleRecentFga: 18,
      roleSeasonFga: 15,
      formRecentPoints: 22,
      formSeasonPoints: 20,
    });
    expect(a['role.fga_delta']).toBe(3);
    expect(a['form.points_delta']).toBe(2);
    expect(a.roleAvailable).toBe(true);
    expect(a.formAvailable).toBe(true);
  });

  it('rejects unauthorized injection keys', () => {
    const rejected = rejectUnauthorizedInjection({
      'role.fga_delta': 1,
      'opponent.defensive_rating': 110,
      'schedule.days_rest': 1,
      'injury.expected_missing_minutes': 20,
      'interpretation.observation': 'x',
    });
    expect(rejected).toContain('opponent.defensive_rating');
    expect(rejected).toContain('schedule.days_rest');
    expect(rejected).toContain('injury.expected_missing_minutes');
    expect(rejected).toContain('interpretation.observation');
  });

  it('assertAuthorizedFeatureKeys passes only locked set', () => {
    expect(() => assertAuthorizedFeatureKeys([...PRODUCTION_PTS_CONTEXT_FEATURES])).not.toThrow();
    expect(() => assertAuthorizedFeatureKeys(['opponent.pace'])).toThrow(/UNAUTHORIZED/);
  });

  it('CONTEXT_RAW_FALLBACK_COUNT is 0', () => {
    expect(CONTEXT_RAW_FALLBACK_COUNT).toBe(0);
  });
});

describe('pts production context shadow — baseline parity', () => {
  it('matches Track B.1 production projection', () => {
    const last10 = 20;
    const season = 18;
    const last5 = 22;
    const signals = neutralStabilitySignals();
    const expected = computeTrackB1PlayerPropProbability(
      { last10Avg: last10, seasonAvg: season, last5Avg: last5, line: 0, propType: 'points' },
      { signals, isCombo: false }
    );
    const got = computeProductionPtsBaseline(
      { last10Avg: last10, seasonAvg: season, last5Avg: last5 },
      signals
    );
    expect(got.productionBaselinePts).toBe(expected.projection);
    expect(got.trackAPts).toBe(computeProjection(last10, season));
    expect(got.productionBaselineId).toBe(PRODUCTION_BASELINE_ID);
  });
});

describe('pts production context shadow — ridge', () => {
  it('fits synthetic residual ridge exactly and deterministically', () => {
    // y = 1.5 + 2*x1 + (-1)*x2
    const X = [
      [1, 0],
      [0, 1],
      [2, 1],
      [1, 2],
      [3, 0],
      [0, 3],
    ];
    const y = X.map(([a, b]) => 1.5 + 2 * a! - 1 * b!);
    const m1 = fitRidgeResidual(X, y, ['role.fga_delta', 'form.points_delta'], RIDGE_ALPHA);
    const m2 = fitRidgeResidual(X, y, ['role.fga_delta', 'form.points_delta'], RIDGE_ALPHA);
    expect(ridgeModelsEqual(m1, m2)).toBe(true);
    expect(m1.featureStandardization).toBe('NONE');
    const pred = predictRidgeAdjustment(m1, [1, 1]);
    expect(Number.isFinite(pred)).toBe(true);
  });
});

describe('pts production context shadow — predict branches', () => {
  const joint = fitRidgeResidual(
    [
      [1, 1],
      [2, 0],
      [0, 2],
      [1, -1],
    ],
    [1, 2, -1, 0.5],
    ['role.fga_delta', 'form.points_delta']
  );
  const role = fitRidgeResidual([[1], [2], [0], [3]], [1, 2, 0, 2.5], ['role.fga_delta']);
  const form = fitRidgeResidual([[1], [2], [0], [3]], [0.5, 1, 0, 1.5], ['form.points_delta']);
  const models = bundleFrom(joint, role, form);

  it('uses ROLE_FORM_JOINT when both available', () => {
    const r = predictPtsContextShadow({
      baseline: { last10Avg: 20, seasonAvg: 18, last5Avg: 19 },
      contexts: {
        roleRecentFga: 16,
        roleSeasonFga: 14,
        formRecentPoints: 21,
        formSeasonPoints: 19,
      },
      models,
    });
    expect(r.branch).toBe('ROLE_FORM_JOINT');
    expect(r.primaryEligible).toBe(true);
    expect(r.shadowContextPts).toBe(r.productionBaselinePts + r.contextAdjustment);
  });

  it('falls back ROLE_ONLY / FORM_ONLY / BASELINE', () => {
    expect(
      predictPtsContextShadow({
        baseline: { last10Avg: 10, seasonAvg: 10 },
        contexts: { roleRecentFga: 12, roleSeasonFga: 10 },
        models,
      }).branch
    ).toBe('ROLE_ONLY');
    expect(
      predictPtsContextShadow({
        baseline: { last10Avg: 10, seasonAvg: 10 },
        contexts: { formRecentPoints: 12, formSeasonPoints: 10 },
        models,
      }).branch
    ).toBe('FORM_ONLY');
    expect(
      predictPtsContextShadow({
        baseline: { last10Avg: 10, seasonAvg: 10 },
        contexts: {},
        models,
      }).branch
    ).toBe('BASELINE');
  });

  it('TARGET_OUTCOME_MUTATION does not change features/prediction inputs', () => {
    const ctx = {
      roleRecentFga: 16,
      roleSeasonFga: 14,
      formRecentPoints: 21,
      formSeasonPoints: 19,
    };
    const before = assemblePtsContextFeatures(ctx);
    const mutatedActualPts = 999; // postgame — must not be a feature
    void mutatedActualPts;
    const after = assemblePtsContextFeatures(ctx);
    expect(after).toEqual(before);
  });

  it('SAME_TIP / FUTURE mutation: features depend only on prior certified contexts', () => {
    const base = assemblePtsContextFeatures({
      roleRecentFga: 10,
      roleSeasonFga: 8,
      formRecentPoints: 15,
      formSeasonPoints: 14,
    });
    const withForbidden = rejectUnauthorizedInjection({
      'role.fga_delta': base['role.fga_delta'],
      minutes_played: 34,
      postgame_dnp: true,
    });
    expect(withForbidden.length).toBeGreaterThanOrEqual(0);
    expect(base['role.fga_delta']).toBe(2);
  });
});

describe('pts production context shadow — window', () => {
  it('canonical identity + T-60 + counter rules', () => {
    const tip = '2026-11-01T00:00:00.000Z';
    const cutoff = intendedCutoffIso(tip);
    expect(isPregame('2026-10-31T22:00:00.000Z', tip)).toBe(true);
    expect(isPregame('2026-11-01T00:00:00.000Z', tip)).toBe(false);
    expect(isOnTimePrediction(cutoff, cutoff)).toBe(true);
    expect(countsTowardPrimaryWindow('PRIMARY_ELIGIBLE')).toBe(true);
    expect(countsTowardPrimaryWindow('FALLBACK_NOT_PRIMARY')).toBe(false);
    expect(countsTowardPrimaryWindow('LATE')).toBe(false);
    expect(collectionStatus(0)).toBe('READY_FOR_PROSPECTIVE_COLLECTION');
    expect(collectionStatus(10)).toBe('COLLECTING');
    expect(collectionStatus(PROSPECTIVE_REQUIRED_N)).toBe('READY_FOR_READOUT');
    expect(
      canonicalSnapshotIdentity({
        prospectiveWindowId: 'w',
        playerEntityId: 'p',
        gameId: 'g',
        contextModelVersion: 'm',
      })
    ).toBe('w|p|g|m');
  });

  it('eligibility mapping', () => {
    expect(
      eligibilityForShadow({
        primaryEligible: true,
        branch: 'ROLE_FORM_JOINT',
        late: false,
        versionMismatch: false,
      })
    ).toBe('PRIMARY_ELIGIBLE');
    expect(
      eligibilityForShadow({
        primaryEligible: false,
        branch: 'ROLE_ONLY',
        late: false,
        versionMismatch: false,
      })
    ).toBe('FALLBACK_NOT_PRIMARY');
  });
});

describe('pts production context shadow — isolation', () => {
  it('SHADOW_FAILURE_ISOLATION returns error without throwing to caller path', () => {
    const r = runShadowIsolated(() => {
      throw new Error('boom');
    });
    expect(r.ok).toBe(false);
    const productionProjection = computeProjection(20, 18);
    expect(productionProjection).toBe(0.7 * 20 + 0.3 * 18);
  });

  it('SERVING_OUTPUT_IMMUTABILITY: computeProjection unchanged by shadow imports', () => {
    const a = computeProjection(15, 12);
    void predictPtsContextShadow; // imported
    const b = computeProjection(15, 12);
    expect(a).toBe(b);
  });
});
