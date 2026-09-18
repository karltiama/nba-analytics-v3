/**
 * Phase 18B — Build immutable auxiliary MIN prospective shadow records.
 * Does NOT wire into Props Explorer. Does NOT touch PTS window/counter.
 */

import { createHash, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  AUX_MIN_INTEGRATION_VERSION,
  AUX_MIN_MODEL_VERSION,
  AUX_MIN_PROSPECTIVE_WINDOW,
  AUX_MIN_JOINT_FEATURES,
  FROZEN_AUX_MIN_MODEL_ARTIFACT_SHA,
  FROZEN_AUX_MIN_FEATURE_MANIFEST_SHA,
  FROZEN_AUX_MIN_TRAINING_MANIFEST_SHA,
  PRIMARY_AUX_MIN_BRANCH,
  PTS_PROSPECTIVE_WINDOW_ID,
  type AuxMinBranch,
} from '@/lib/context-projection/min/protocol';
import {
  predictAuxiliaryMinutes,
  type AuxMinModelBundle,
} from '@/lib/context-projection/min/predict';
import type { RidgeModel } from '@/lib/context-projection/ridge';
import type { B0MinPriorGame } from '@/lib/context-projection/min/baseline';
import type { AuxMinSourceContexts } from '@/lib/context-projection/min/features';
import {
  assertMinWindowId,
  assertNoHistoricalMinBackfill,
  classifyMinSnapshotStatus,
  intendedMinCutoffIso,
  isOnTimeMinPrediction,
  isPregameMinPrediction,
  minCanonicalSnapshotIdentity,
  type MinPregameEligibilityStatus,
} from '@/lib/context-projection/min/window';
import type { ProspectiveMinShadowRecord } from '@/lib/context-projection/min/store';

export function loadFrozenAuxMinBundle(root = process.cwd()): AuxMinModelBundle {
  const art = JSON.parse(
    readFileSync(join(root, 'lib/context-projection/artifacts/aux-min-model_artifact.json'), 'utf8')
  );
  if (art.model_artifact_sha !== FROZEN_AUX_MIN_MODEL_ARTIFACT_SHA) {
    throw new Error(
      `AUX_MIN_MODEL_ARTIFACT_FREEZE_GATE_FAIL: expected ${FROZEN_AUX_MIN_MODEL_ARTIFACT_SHA} got ${art.model_artifact_sha}`
    );
  }
  if (art.feature_manifest_sha !== FROZEN_AUX_MIN_FEATURE_MANIFEST_SHA) {
    throw new Error('AUX_MIN_FEATURE_MANIFEST_PARITY_FAIL');
  }
  if (art.training_manifest_sha !== FROZEN_AUX_MIN_TRAINING_MANIFEST_SHA) {
    throw new Error('AUX_MIN_TRAINING_MANIFEST_PARITY_FAIL');
  }
  const names: string[] = art.primary.feature_names;
  if (
    names.length !== AUX_MIN_JOINT_FEATURES.length ||
    names.some((n, i) => n !== AUX_MIN_JOINT_FEATURES[i])
  ) {
    throw new Error('AUX_MIN_FEATURE_MANIFEST_PARITY_FAIL');
  }
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
    availOnly: toModel(art.avail_only),
    featureManifestSha: art.feature_manifest_sha,
    trainingManifestSha: art.training_manifest_sha,
    modelArtifactSha: art.model_artifact_sha,
    contextModelVersion: AUX_MIN_MODEL_VERSION,
    contextIntegrationVersion: AUX_MIN_INTEGRATION_VERSION,
    trainingCutoff: art.training_cutoff,
  };
}

export interface ArmMinShadowCandidate {
  gameId: string;
  playerEntityId: string;
  teamId: string;
  season: string;
  gameStart: string;
  predictionCreatedAt: string;
  priors: B0MinPriorGame[];
  contexts: AuxMinSourceContexts;
  /** ISO when prospective window was armed; rejects historical backfill. */
  windowOpenedAt: string;
  windowId?: string;
}

export function eligibilityForMinShadow(opts: {
  branch: AuxMinBranch;
  b0Ok: boolean;
  late: boolean;
  versionMismatch: boolean;
  snapshotOk: boolean;
  pregame: boolean;
}): MinPregameEligibilityStatus {
  if (!opts.pregame || !opts.snapshotOk || !opts.b0Ok) return 'INVALID';
  if (opts.versionMismatch) return 'VERSION_MISMATCH';
  if (opts.late) return 'LATE';
  if (opts.branch === PRIMARY_AUX_MIN_BRANCH) return 'PRIMARY_ELIGIBLE';
  if (opts.branch === 'BASELINE') return 'NOT_COUNTED';
  return 'FALLBACK_NOT_PRIMARY';
}

/** Build an immutable prospective MIN shadow record (no DB write). */
export function buildProspectiveMinShadowRecord(
  candidate: ArmMinShadowCandidate,
  bundle?: AuxMinModelBundle
): ProspectiveMinShadowRecord {
  const windowId = candidate.windowId ?? AUX_MIN_PROSPECTIVE_WINDOW;
  if (!assertMinWindowId(windowId)) {
    throw new Error('PTS_PROSPECTIVE_WINDOW_ISOLATION_FAIL');
  }
  if (windowId === PTS_PROSPECTIVE_WINDOW_ID) {
    throw new Error('PTS_PROSPECTIVE_WINDOW_ISOLATION_FAIL');
  }
  assertNoHistoricalMinBackfill(candidate.predictionCreatedAt, candidate.windowOpenedAt);

  const models = bundle ?? loadFrozenAuxMinBundle();
  if (models.modelArtifactSha !== FROZEN_AUX_MIN_MODEL_ARTIFACT_SHA) {
    throw new Error('AUX_MIN_MODEL_ARTIFACT_FREEZE_GATE_FAIL');
  }

  const tip = candidate.gameStart;
  const created = candidate.predictionCreatedAt;
  const cutoff = intendedMinCutoffIso(tip);
  const late = !isOnTimeMinPrediction(created, cutoff);
  const pregame = isPregameMinPrediction(created, tip);
  if (!pregame) {
    throw new Error('POST_TIP_PREDICTION_REJECTED');
  }

  const pred = predictAuxiliaryMinutes({
    priors: candidate.priors,
    tipIso: tip,
    season: candidate.season,
    teamId: candidate.teamId,
    contexts: candidate.contexts,
    models,
  });

  if (pred.shadowMin == null || pred.baselineMin == null) {
    throw new Error('B0_MIN_UNAVAILABLE');
  }

  const snapshotStatus = classifyMinSnapshotStatus({
    predictionCreatedAt: created,
    gameStart: tip,
    intendedCutoffAt: cutoff,
  });
  const eligibility = eligibilityForMinShadow({
    branch: pred.branch,
    b0Ok: !pred.coldStart && pred.baselineMin != null,
    late,
    versionMismatch: false,
    snapshotOk: snapshotStatus === 'CANONICAL_T60',
    pregame,
  });

  const identity = minCanonicalSnapshotIdentity({
    prospectiveWindowId: windowId,
    playerEntityId: candidate.playerEntityId,
    gameId: candidate.gameId,
    modelId: AUX_MIN_MODEL_VERSION,
  });
  const idSeed = `${identity}|${created}`;
  const shadowPredictionId = createHash('sha256').update(idSeed).digest('hex').slice(0, 32);

  return {
    shadowPredictionId: shadowPredictionId || randomUUID(),
    prospectiveWindowId: windowId,
    gameId: candidate.gameId,
    playerEntityId: candidate.playerEntityId,
    teamId: candidate.teamId,
    gameStart: tip,
    predictionCreatedAt: created,
    b0Min: pred.baselineMin,
    contextAdjustment: pred.contextAdjustment,
    shadowMin: pred.shadowMin,
    branch: pred.branch,
    roleMinutesDelta: pred.roleMinutesDelta,
    injuryExpectedMissingMinutes: pred.expectedMissingMinutes,
    injuryRotationPlayersOutCount: pred.rotationPlayersOutCount,
    roleContextVersion: pred.roleContextVersion,
    availabilityContextVersion: pred.availabilityContextVersion,
    availabilityCompleteness: candidate.contexts.availCompleteness ?? null,
    modelId: AUX_MIN_MODEL_VERSION,
    modelArtifactSha: models.modelArtifactSha,
    featureManifestSha: models.featureManifestSha,
    trainingManifestSha: models.trainingManifestSha,
    contextIntegrationVersion: models.contextIntegrationVersion,
    pregameEligibilityStatus: eligibility,
    canonicalSnapshotIdentity: identity,
    canonicalSnapshotStatus: snapshotStatus,
    intendedCutoffAt: cutoff,
    late,
    provenance: {
      source: 'arm-prospective-aux-min-shadow',
      PLAYED_STATUS_USED_AS_MODEL_FEATURE: 'NO',
      PLAYED_STATUS_USED_FOR_TARGET_POPULATION_RESOLUTION: 'YES',
    },
  };
}

export { loadFrozenAuxMinBundle as loadFrozenBundle };
