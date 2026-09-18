/**
 * Auxiliary MIN shadow prediction — joint Role∪Avail residual on B0.
 */

import {
  assembleAuxMinFeatures,
  featureVectorForMinBranch,
  type AuxMinSourceContexts,
} from '@/lib/context-projection/min/features';
import { computeB0Min, type B0MinPriorGame } from '@/lib/context-projection/min/baseline';
import { predictRidgeAdjustment, type RidgeModel } from '@/lib/context-projection/ridge';
import {
  AUX_MIN_INTEGRATION_VERSION,
  AUX_MIN_MODEL_VERSION,
  AVAIL_CONTEXT_VERSION,
  PRIMARY_AUX_MIN_BRANCH,
  ROLE_CONTEXT_VERSION,
  type AuxMinBranch,
} from '@/lib/context-projection/min/protocol';

export interface AuxMinModelBundle {
  joint: RidgeModel;
  roleOnly: RidgeModel;
  availOnly: RidgeModel;
  featureManifestSha: string;
  trainingManifestSha: string;
  modelArtifactSha: string;
  contextModelVersion: string;
  contextIntegrationVersion: string;
  trainingCutoff: string;
}

export interface AuxMinPredictInput {
  priors: B0MinPriorGame[];
  tipIso: string;
  season: string;
  teamId: string;
  contexts: AuxMinSourceContexts;
  models: AuxMinModelBundle;
}

export interface AuxMinPredictResult {
  baselineMin: number | null;
  contextAdjustment: number;
  shadowMin: number | null;
  branch: AuxMinBranch;
  historyN: number;
  roleMinutesDelta: number | null;
  expectedMissingMinutes: number | null;
  rotationPlayersOutCount: number | null;
  roleContextVersion: string | null;
  availabilityContextVersion: string | null;
  roleAvailable: boolean;
  availAvailable: boolean;
  modelVersion: string;
  integrationVersion: string;
  status: 'SHADOW';
  coldStart: boolean;
}

function selectBranch(a: ReturnType<typeof assembleAuxMinFeatures>): AuxMinBranch {
  if (a.roleAvailable && a.availAvailable) return 'ROLE_AVAIL_JOINT';
  if (a.roleAvailable) return 'ROLE_ONLY';
  if (a.availAvailable) return 'AVAIL_ONLY';
  return 'BASELINE';
}

export function predictAuxiliaryMinutes(input: AuxMinPredictInput): AuxMinPredictResult {
  const b0 = computeB0Min(input.priors, input.tipIso, input.season, input.teamId);
  const assembled = assembleAuxMinFeatures(input.contexts);
  let branch = selectBranch(assembled);
  let adjustment = 0;

  if (b0.b0Min == null) {
    return {
      baselineMin: null,
      contextAdjustment: 0,
      shadowMin: null,
      branch: 'BASELINE',
      historyN: 0,
      roleMinutesDelta: assembled['role.minutes_delta'],
      expectedMissingMinutes: assembled['injury.expected_missing_minutes'],
      rotationPlayersOutCount: assembled['injury.rotation_players_out_count'],
      roleContextVersion: assembled.roleContextVersion,
      availabilityContextVersion: assembled.availContextVersion,
      roleAvailable: assembled.roleAvailable,
      availAvailable: assembled.availAvailable,
      modelVersion: input.models.contextModelVersion,
      integrationVersion: input.models.contextIntegrationVersion,
      status: 'SHADOW',
      coldStart: true,
    };
  }

  if (branch === 'ROLE_AVAIL_JOINT') {
    const vec = featureVectorForMinBranch(assembled, 'ROLE_AVAIL_JOINT');
    if (!vec) branch = selectBranch(assembled);
    else adjustment = predictRidgeAdjustment(input.models.joint, vec.values);
  }
  if (branch === 'ROLE_ONLY') {
    const vec = featureVectorForMinBranch(assembled, 'ROLE_ONLY');
    if (!vec) branch = 'BASELINE';
    else adjustment = predictRidgeAdjustment(input.models.roleOnly, vec.values);
  }
  if (branch === 'AVAIL_ONLY') {
    const vec = featureVectorForMinBranch(assembled, 'AVAIL_ONLY');
    if (!vec) branch = 'BASELINE';
    else adjustment = predictRidgeAdjustment(input.models.availOnly, vec.values);
  }
  if (branch === 'BASELINE') adjustment = 0;

  return {
    baselineMin: b0.b0Min,
    contextAdjustment: adjustment,
    shadowMin: b0.b0Min + adjustment,
    branch,
    historyN: b0.historyN,
    roleMinutesDelta: assembled['role.minutes_delta'],
    expectedMissingMinutes: assembled['injury.expected_missing_minutes'],
    rotationPlayersOutCount: assembled['injury.rotation_players_out_count'],
    roleContextVersion: assembled.roleAvailable ? ROLE_CONTEXT_VERSION : null,
    availabilityContextVersion: assembled.availAvailable ? AVAIL_CONTEXT_VERSION : null,
    roleAvailable: assembled.roleAvailable,
    availAvailable: assembled.availAvailable,
    modelVersion: input.models.contextModelVersion || AUX_MIN_MODEL_VERSION,
    integrationVersion: input.models.contextIntegrationVersion || AUX_MIN_INTEGRATION_VERSION,
    status: 'SHADOW',
    coldStart: false,
  };
}

export function isPrimaryAuxMinBranch(branch: AuxMinBranch): boolean {
  return branch === PRIMARY_AUX_MIN_BRANCH;
}
