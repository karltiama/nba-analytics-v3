import { describe, expect, it } from 'vitest';
import {
  FROZEN_PTS_C,
  FROZEN_REB_C,
  MODEL_D,
  MODEL_LIFECYCLE_STATUS,
  PRODUCTION_CONTROL,
  TRAINING_DATA_FREEZE,
  WOWY_AVAILABILITY,
  assertFrozenCandidateUnchanged,
  frozenCandidateFingerprint,
  getLifecycleEntry,
} from '@/lib/model-lab/lifecycle-registry';
import { computeProjection } from '@/lib/betting/player-prop-model';
import { SHADOW_FEATURE_SPEC_VERSION, SHADOW_MODEL_VERSION } from '@/lib/betting/player-projection-shadow-protocol';
import { asString, isRecord, readJsonIfExists } from '@/lib/model-lab/fs';

describe('frozen model registry', () => {
  it('records production control and frozen candidates without certifying C as production', () => {
    expect(PRODUCTION_CONTROL.status).toBe(MODEL_LIFECYCLE_STATUS.PRODUCTION_CONTROL);
    expect(PRODUCTION_CONTROL.last10Weight).toBe(0.7);
    expect(PRODUCTION_CONTROL.seasonWeight).toBe(0.3);
    expect(computeProjection(10, 20)).toBeCloseTo(13, 10);
    expect(FROZEN_PTS_C.status).toBe(MODEL_LIFECYCLE_STATUS.FROZEN_SHADOW_CANDIDATE);
    expect(FROZEN_REB_C.status).toBe(MODEL_LIFECYCLE_STATUS.FROZEN_SHADOW_CANDIDATE);
    expect(FROZEN_PTS_C.productionCertified).toBe(false);
    expect(FROZEN_REB_C.productionCertified).toBe(false);
    expect(MODEL_D.status).toBe(MODEL_LIFECYCLE_STATUS.RESEARCH_ONLY_NOT_PROMOTED);
    expect(WOWY_AVAILABILITY.status).toBe(MODEL_LIFECYCLE_STATUS.RESEARCH_INCONCLUSIVE);
    expect(WOWY_AVAILABILITY.note).toMatch(/inconclusive/i);
    expect(WOWY_AVAILABILITY.status).not.toMatch(/FAIL/);
    expect(getLifecycleEntry('pts_c')?.status).toBe(MODEL_LIFECYCLE_STATUS.FROZEN_SHADOW_CANDIDATE);
  });

  it('pins model and feature versions to the freeze manifest', () => {
    expect(FROZEN_PTS_C.modelVersion).toBe(SHADOW_MODEL_VERSION);
    expect(FROZEN_REB_C.featureSpecVersion).toBe(SHADOW_FEATURE_SPEC_VERSION);
    expect(() => assertFrozenCandidateUnchanged()).not.toThrow();
    const manifest = readJsonIfExists<unknown>('reports/modeling/shadow-pts-reb-c-r1/manifest.json');
    expect(isRecord(manifest)).toBe(true);
    if (!isRecord(manifest) || !isRecord(manifest.model_sha256)) return;
    expect(asString(manifest.model_sha256.points)).toBe(FROZEN_PTS_C.sha256);
    expect(asString(manifest.model_sha256.rebounds)).toBe(FROZEN_REB_C.sha256);
    expect(asString(manifest.dataset_sha256)).toBe(TRAINING_DATA_FREEZE.datasetSha256);
  });

  it('keeps artifact fingerprints stable without retraining', () => {
    const pts = frozenCandidateFingerprint(FROZEN_PTS_C);
    const reb = frozenCandidateFingerprint(FROZEN_REB_C);
    expect(pts).toHaveLength(64);
    expect(reb).toHaveLength(64);
    expect(pts).not.toBe(reb);
    expect(frozenCandidateFingerprint(FROZEN_PTS_C)).toBe(pts);
    expect(TRAINING_DATA_FREEZE.modelsRetrainedInFreeze).toBe(false);
  });
});
