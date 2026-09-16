/**
 * Model Lab lifecycle source of truth for STEP 14M.C1.
 * Does not change production serving. Does not retrain PTS C / REB C.
 * Experiment catalog (`registry.ts`) remains the scored-artifact list; this file
 * is the model-status registry.
 */

import { createHash } from 'crypto';
import {
  SHADOW_FEATURE_SPEC_VERSION,
  SHADOW_MODEL_VERSION,
  SHADOW_PROTOCOL_AMENDMENT,
  SHADOW_PROTOCOL_VERSION,
} from '@/lib/betting/player-projection-shadow-protocol';
import { asString, isRecord, readJsonIfExists } from '@/lib/model-lab/fs';

export const LIFECYCLE_REGISTRY_ID = 'court-context-model-lifecycle-c1';
export const LIFECYCLE_REGISTRY_VERSION = 'court-context-model-lifecycle-c1.0';

export const MODEL_LIFECYCLE_STATUS = {
  PRODUCTION_CONTROL: 'PRODUCTION_CONTROL',
  FROZEN_SHADOW_CANDIDATE: 'FROZEN_SHADOW_CANDIDATE',
  RESEARCH_ONLY_NOT_PROMOTED: 'RESEARCH_ONLY_NOT_PROMOTED',
  RESEARCH_INCONCLUSIVE: 'RESEARCH_INCONCLUSIVE',
} as const;

export type ModelLifecycleStatus = (typeof MODEL_LIFECYCLE_STATUS)[keyof typeof MODEL_LIFECYCLE_STATUS];

/** Production 70/30 lives in computeProjection. Weights are documented, not retuned here. */
export const PRODUCTION_CONTROL = {
  id: 'production_70_30',
  label: '70/30 last-10 / season average',
  status: MODEL_LIFECYCLE_STATUS.PRODUCTION_CONTROL,
  implementation: 'computeProjection',
  implementationPath: 'lib/betting/player-prop-model.ts',
  formula: '0.7 * last10Avg + 0.3 * seasonAvg',
  last10Weight: 0.7,
  seasonWeight: 0.3,
  dnpInclusive: true,
  note: 'Current production control. Played-only research Track A is not this control.',
  productionCertified: true,
} as const;

export const FROZEN_PTS_C = {
  id: 'pts_c',
  label: 'PTS C',
  status: MODEL_LIFECYCLE_STATUS.FROZEN_SHADOW_CANDIDATE,
  market: 'points',
  featureSet: 'C',
  modelVersion: SHADOW_MODEL_VERSION,
  featureSpecVersion: SHADOW_FEATURE_SPEC_VERSION,
  protocolVersion: SHADOW_PROTOCOL_VERSION,
  protocolAmendment: SHADOW_PROTOCOL_AMENDMENT,
  artifactPath: 'reports/modeling/shadow-pts-reb-c-r1/c_points.cbm',
  sourceTrainingPath: 'reports/modeling/learned-r1/artifacts/c_points.cbm',
  sha256: '23176a81b41c2c9cfb614d57268aafb93c04c57ae0d9e0d869c1417d87321421',
  trainingConfig: {
    config_id: 1,
    depth: 6,
    learning_rate: 0.08,
    l2_leaf_reg: 3,
    iterations: 500,
    best_iteration: 171,
    tree_count: 172,
    seed: 20260914,
    loss: 'RMSE',
  },
  trainedAt: '2026-09-15T02:24:00.000Z',
  productionCertified: false,
  note: 'Frozen shadow candidate. Historical nomination is not production certification.',
} as const;

export const FROZEN_REB_C = {
  id: 'reb_c',
  label: 'REB C',
  status: MODEL_LIFECYCLE_STATUS.FROZEN_SHADOW_CANDIDATE,
  market: 'rebounds',
  featureSet: 'C',
  modelVersion: SHADOW_MODEL_VERSION,
  featureSpecVersion: SHADOW_FEATURE_SPEC_VERSION,
  protocolVersion: SHADOW_PROTOCOL_VERSION,
  protocolAmendment: SHADOW_PROTOCOL_AMENDMENT,
  artifactPath: 'reports/modeling/shadow-pts-reb-c-r1/c_rebounds.cbm',
  sourceTrainingPath: 'reports/modeling/learned-r1/artifacts/c_rebounds.cbm',
  sha256: '2acd2b6cefc39841dfa87dfc74e4816c291fba3f9b347dc32c4a59dcc8bc6469',
  trainingConfig: {
    config_id: 3,
    depth: 6,
    learning_rate: 0.03,
    l2_leaf_reg: 3,
    iterations: 800,
    best_iteration: 294,
    tree_count: 295,
    seed: 20260914,
    loss: 'RMSE',
  },
  trainedAt: '2026-09-15T02:24:00.000Z',
  productionCertified: false,
  note: 'Frozen shadow candidate. Historical nomination is not production certification.',
} as const;

export const MODEL_D = {
  id: 'model_d',
  label: 'Model D',
  status: MODEL_LIFECYCLE_STATUS.RESEARCH_ONLY_NOT_PROMOTED,
  featureSet: 'D',
  note: 'Additional schedule/team/opponent context did not show consistent incremental gain over C. Not promoted. Not a shadow candidate.',
  productionCertified: false,
} as const;

export const WOWY_AVAILABILITY = {
  id: 'wowy_availability',
  label: 'WOWY availability adjustment',
  status: MODEL_LIFECYCLE_STATUS.RESEARCH_INCONCLUSIVE,
  semantics: 'game-level participation WOWY v1',
  notPossessionOnOff: true,
  note: 'Historical teammate-absence experiment remains inconclusive. Do not classify as ineffective. Usable pregame availability history is the main limitation. Do not convert a WOWY difference into a projection adjustment.',
  productionCertified: false,
} as const;

export const TRAINING_DATA_FREEZE = {
  datasetSha256: '20d90fedd3b6e25047e81acf32d05aafbd470f1827e96916aaf38de0d556e5fa',
  featureSpecSha256: '7644e8191ed87737a2f6a0ae8f96fb18dca618c60aa2139d7286fb3efab4c8b3',
  featureOrderSha256: '1ad8e6196db2cba854426dcfa958fa58790a4d817b8a336815800dc88567e75b',
  sourceArchiveSha256: 'aa33738837e6c175191997bcdfd06b42e42d79a65ea6f81c9570ce7da590855a',
  codeCommit: 'da7763d9fa7f18ac0ad79b1e9ea16ff8940b0848',
  nPlayerGames: 83479,
  catboostVersion: '1.2.8',
  createdAt: '2026-09-15T02:24:00.000Z',
  modelsRetrainedInFreeze: false,
} as const;

export type FrozenCandidateId = typeof FROZEN_PTS_C.id | typeof FROZEN_REB_C.id;

export type LifecycleEntry =
  | typeof PRODUCTION_CONTROL
  | typeof FROZEN_PTS_C
  | typeof FROZEN_REB_C
  | typeof MODEL_D
  | typeof WOWY_AVAILABILITY;

export const MODEL_LIFECYCLE_REGISTRY = {
  id: LIFECYCLE_REGISTRY_ID,
  version: LIFECYCLE_REGISTRY_VERSION,
  productionControl: PRODUCTION_CONTROL,
  frozenShadowCandidates: [FROZEN_PTS_C, FROZEN_REB_C],
  modelD: MODEL_D,
  wowyAvailability: WOWY_AVAILABILITY,
  trainingData: TRAINING_DATA_FREEZE,
} as const;

export function getLifecycleEntry(id: string): LifecycleEntry | null {
  const all: LifecycleEntry[] = [
    PRODUCTION_CONTROL,
    FROZEN_PTS_C,
    FROZEN_REB_C,
    MODEL_D,
    WOWY_AVAILABILITY,
  ];
  return all.find((entry) => entry.id === id) ?? null;
}

export function frozenCandidateForMarket(market: 'points' | 'rebounds'): typeof FROZEN_PTS_C | typeof FROZEN_REB_C {
  return market === 'points' ? FROZEN_PTS_C : FROZEN_REB_C;
}

/**
 * Lightest deterministic fingerprint of the frozen candidate identity.
 * Uses already-recorded checksums; does not retrain or hash missing .cbm binaries.
 */
export function frozenCandidateFingerprint(candidate: typeof FROZEN_PTS_C | typeof FROZEN_REB_C): string {
  const payload = {
    id: candidate.id,
    market: candidate.market,
    modelVersion: candidate.modelVersion,
    featureSpecVersion: candidate.featureSpecVersion,
    sha256: candidate.sha256,
    datasetSha256: TRAINING_DATA_FREEZE.datasetSha256,
    featureSpecSha256: TRAINING_DATA_FREEZE.featureSpecSha256,
    featureOrderSha256: TRAINING_DATA_FREEZE.featureOrderSha256,
    trainingConfig: candidate.trainingConfig,
    trainedAt: candidate.trainedAt,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function assertFrozenCandidateUnchanged(): void {
  const manifest = readJsonIfExists<unknown>('reports/modeling/shadow-pts-reb-c-r1/manifest.json');
  if (!isRecord(manifest)) {
    throw new Error('Frozen shadow manifest.json is missing; cannot verify candidate identity.');
  }
  const hashes = isRecord(manifest.model_sha256) ? manifest.model_sha256 : {};
  if (asString(manifest.model_version) !== SHADOW_MODEL_VERSION) {
    throw new Error('Manifest model_version drifted from frozen PTS C / REB C identity.');
  }
  if (asString(manifest.feature_spec_version) !== SHADOW_FEATURE_SPEC_VERSION) {
    throw new Error('Manifest feature_spec_version drifted from frozen PTS C / REB C identity.');
  }
  if (asString(hashes.points) !== FROZEN_PTS_C.sha256) {
    throw new Error('PTS C artifact checksum drifted from the freeze record.');
  }
  if (asString(hashes.rebounds) !== FROZEN_REB_C.sha256) {
    throw new Error('REB C artifact checksum drifted from the freeze record.');
  }
  if (asString(manifest.dataset_sha256) !== TRAINING_DATA_FREEZE.datasetSha256) {
    throw new Error('Training-data checksum drifted from the freeze record.');
  }
}
