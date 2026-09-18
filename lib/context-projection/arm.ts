/**
 * Thin ops entry to arm prospective PTS shadow collection.
 * Does NOT wire into Props Explorer request path.
 * Live DB writes require applied migration + SUPABASE_DB_URL.
 */

import { createHash, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CONTEXT_INTEGRATION_VERSION,
  PROD_PTS_CONTEXT_MODEL_VERSION,
  PROSPECTIVE_WINDOW_ID,
} from '@/lib/context-projection/protocol';
import {
  predictPtsContextShadow,
  eligibilityForShadow,
  type ShadowModelBundle,
} from '@/lib/context-projection/predict';
import type { RidgeModel } from '@/lib/context-projection/ridge';
import {
  canonicalSnapshotIdentity,
  intendedCutoffIso,
  isOnTimePrediction,
  isPregame,
} from '@/lib/context-projection/window';
import type { ProspectiveShadowRecord } from '@/lib/context-projection/store';

function loadFrozenBundle(root = process.cwd()): ShadowModelBundle {
  const art = JSON.parse(
    readFileSync(
      join(root, 'lib/context-projection/artifacts/model_artifact.json'),
      'utf8'
    )
  );
  const toModel = (m: {
    feature_names: string[];
    intercept: number;
    feature_betas: number[];
    coefficients: number[];
    alpha: number;
    training_rows: number;
  }): RidgeModel => ({
    alpha: m.alpha,
    featureNames: m.feature_names,
    intercept: m.intercept,
    featureBetas: m.feature_betas,
    coefficients: m.coefficients,
    trainingRows: m.training_rows,
    featureStandardization: 'NONE',
  });
  return {
    joint: toModel(art.primary),
    roleOnly: toModel(art.role_only),
    formOnly: toModel(art.form_only),
    featureManifestSha: art.feature_manifest_sha,
    trainingManifestSha: art.training_manifest_sha,
    modelArtifactSha: art.model_artifact_sha,
    contextModelVersion: PROD_PTS_CONTEXT_MODEL_VERSION,
    contextIntegrationVersion: CONTEXT_INTEGRATION_VERSION,
    productionBaselineId: art.production_baseline_id,
    productionBaselineVersion: art.production_baseline_version,
  };
}

export interface ArmShadowCandidate {
  gameId: string;
  playerEntityId: string;
  teamId: string;
  gameStart: string;
  predictionCreatedAt: string;
  last10Avg: number;
  seasonAvg: number;
  last5Avg?: number;
  roleRecentFga?: number | null;
  roleSeasonFga?: number | null;
  formRecentPoints?: number | null;
  formSeasonPoints?: number | null;
}

/** Build an immutable prospective shadow record (no DB write). */
export function buildProspectiveShadowRecord(
  candidate: ArmShadowCandidate,
  bundle?: ShadowModelBundle
): ProspectiveShadowRecord {
  const models = bundle ?? loadFrozenBundle();
  const tip = candidate.gameStart;
  const created = candidate.predictionCreatedAt;
  const cutoff = intendedCutoffIso(tip);
  const late = !isOnTimePrediction(created, cutoff);
  const pregame = isPregame(created, tip);
  if (!pregame) {
    throw new Error('POST_TIP_PREDICTION_REJECTED');
  }
  const pred = predictPtsContextShadow({
    baseline: {
      last10Avg: candidate.last10Avg,
      seasonAvg: candidate.seasonAvg,
      last5Avg: candidate.last5Avg,
    },
    contexts: {
      roleRecentFga: candidate.roleRecentFga,
      roleSeasonFga: candidate.roleSeasonFga,
      formRecentPoints: candidate.formRecentPoints,
      formSeasonPoints: candidate.formSeasonPoints,
    },
    models,
  });
  const eligibility = eligibilityForShadow({
    primaryEligible: pred.primaryEligible && !late,
    branch: pred.branch,
    late,
    versionMismatch: false,
  });
  const identity = canonicalSnapshotIdentity({
    prospectiveWindowId: PROSPECTIVE_WINDOW_ID,
    playerEntityId: candidate.playerEntityId,
    gameId: candidate.gameId,
    contextModelVersion: models.contextModelVersion,
  });
  const idSeed = `${identity}|${created}`;
  const shadowPredictionId = createHash('sha256').update(idSeed).digest('hex').slice(0, 32);
  return {
    shadowPredictionId: shadowPredictionId || randomUUID(),
    prospectiveWindowId: PROSPECTIVE_WINDOW_ID,
    gameId: candidate.gameId,
    playerEntityId: candidate.playerEntityId,
    teamId: candidate.teamId,
    gameStart: tip,
    predictionCreatedAt: created,
    productionBaselineId: pred.productionBaselineId,
    productionBaselineVersion: pred.productionBaselineVersion,
    productionBaselinePts: pred.productionBaselinePts,
    contextIntegrationVersion: models.contextIntegrationVersion,
    contextModelVersion: models.contextModelVersion,
    shadowContextPts: pred.shadowContextPts,
    contextAdjustment: pred.contextAdjustment,
    branch: pred.branch,
    roleFgaDelta: pred.roleFgaDelta,
    formPointsDelta: pred.formPointsDelta,
    roleContextVersion: pred.roleContextVersion,
    formContextVersion: pred.formContextVersion,
    featureManifestSha: models.featureManifestSha,
    trainingManifestSha: models.trainingManifestSha,
    modelArtifactSha: models.modelArtifactSha,
    eligibilityStatus: eligibility,
    canonicalSnapshotIdentity: identity,
    intendedCutoffAt: cutoff,
    late,
    provenance: { source: 'arm-prospective-pts-shadow' },
  };
}

export { loadFrozenBundle };
