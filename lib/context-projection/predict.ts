/**
 * PTS production-context shadow prediction (branch ladder).
 */

import { assemblePtsContextFeatures, featureVectorForBranch, type RoleFormSourceContexts } from '@/lib/context-projection/features';
import { computeProductionPtsBaseline, type ProductionPtsBaselineInput } from '@/lib/context-projection/baseline';
import { predictRidgeAdjustment, type RidgeModel } from '@/lib/context-projection/ridge';
import {
  FORM_CONTEXT_VERSION,
  PRIMARY_BRANCH,
  PRODUCTION_BASELINE_ID,
  PRODUCTION_BASELINE_VERSION,
  PROD_PTS_CONTEXT_MODEL_VERSION,
  ROLE_CONTEXT_VERSION,
  type EligibilityStatus,
  type ShadowBranch,
} from '@/lib/context-projection/protocol';

export interface ShadowModelBundle {
  joint: RidgeModel;
  roleOnly: RidgeModel;
  formOnly: RidgeModel;
  featureManifestSha: string;
  trainingManifestSha: string;
  modelArtifactSha: string;
  contextModelVersion: string;
  contextIntegrationVersion: string;
  productionBaselineId: string;
  productionBaselineVersion: string;
}

export interface ShadowPredictInput {
  baseline: ProductionPtsBaselineInput;
  contexts: RoleFormSourceContexts;
  models: ShadowModelBundle;
  /** If true, force BASELINE branch (e.g. version mismatch). */
  forceBaseline?: boolean;
}

export interface ShadowPredictResult {
  productionBaselinePts: number;
  contextAdjustment: number;
  shadowContextPts: number;
  branch: ShadowBranch;
  roleFgaDelta: number | null;
  formPointsDelta: number | null;
  roleContextVersion: string | null;
  formContextVersion: string | null;
  roleAvailable: boolean;
  formAvailable: boolean;
  primaryEligible: boolean;
  productionBaselineId: string;
  productionBaselineVersion: string;
}

function selectBranch(assembled: ReturnType<typeof assemblePtsContextFeatures>): ShadowBranch {
  if (assembled.roleAvailable && assembled.formAvailable) return 'ROLE_FORM_JOINT';
  if (assembled.roleAvailable) return 'ROLE_ONLY';
  if (assembled.formAvailable) return 'FORM_ONLY';
  return 'BASELINE';
}

export function predictPtsContextShadow(input: ShadowPredictInput): ShadowPredictResult {
  const base = computeProductionPtsBaseline(input.baseline);
  const assembled = assemblePtsContextFeatures(input.contexts);
  let branch = input.forceBaseline ? ('BASELINE' as ShadowBranch) : selectBranch(assembled);

  let adjustment = 0;
  if (branch === 'ROLE_FORM_JOINT') {
    const vec = featureVectorForBranch(assembled, 'ROLE_FORM_JOINT');
    if (!vec) branch = selectBranch(assembled);
    else adjustment = predictRidgeAdjustment(input.models.joint, vec.values);
  }
  if (branch === 'ROLE_ONLY') {
    const vec = featureVectorForBranch(assembled, 'ROLE_ONLY');
    if (!vec) branch = 'BASELINE';
    else adjustment = predictRidgeAdjustment(input.models.roleOnly, vec.values);
  }
  if (branch === 'FORM_ONLY') {
    const vec = featureVectorForBranch(assembled, 'FORM_ONLY');
    if (!vec) branch = 'BASELINE';
    else adjustment = predictRidgeAdjustment(input.models.formOnly, vec.values);
  }
  if (branch === 'BASELINE') {
    adjustment = 0;
  }

  const primaryEligible =
    branch === PRIMARY_BRANCH &&
    assembled.roleAvailable &&
    assembled.formAvailable &&
    !input.forceBaseline &&
    input.models.contextModelVersion === PROD_PTS_CONTEXT_MODEL_VERSION &&
    input.models.productionBaselineId === PRODUCTION_BASELINE_ID &&
    input.models.productionBaselineVersion === PRODUCTION_BASELINE_VERSION;

  return {
    productionBaselinePts: base.productionBaselinePts,
    contextAdjustment: adjustment,
    shadowContextPts: base.productionBaselinePts + adjustment,
    branch,
    roleFgaDelta: assembled['role.fga_delta'],
    formPointsDelta: assembled['form.points_delta'],
    roleContextVersion: assembled.roleAvailable ? ROLE_CONTEXT_VERSION : null,
    formContextVersion: assembled.formAvailable ? FORM_CONTEXT_VERSION : null,
    roleAvailable: assembled.roleAvailable,
    formAvailable: assembled.formAvailable,
    primaryEligible,
    productionBaselineId: base.productionBaselineId,
    productionBaselineVersion: base.productionBaselineVersion,
  };
}

export function eligibilityForShadow(opts: {
  primaryEligible: boolean;
  branch: ShadowBranch;
  late: boolean;
  versionMismatch: boolean;
  invalid?: boolean;
}): EligibilityStatus {
  if (opts.invalid) return 'INVALID';
  if (opts.versionMismatch) return 'VERSION_MISMATCH';
  if (opts.late) return 'LATE';
  if (opts.primaryEligible && opts.branch === PRIMARY_BRANCH) return 'PRIMARY_ELIGIBLE';
  if (opts.branch !== PRIMARY_BRANCH) return 'FALLBACK_NOT_PRIMARY';
  return 'NOT_COUNTED';
}
