/**
 * Injury-conditioned WOWY eligibility policy v1 (Phase 5C).
 *
 * Pure: status + health_relation + identity → availability_fact + eligibility.
 * Does NOT query Postgres/S3/NBA.com/BDL. Does NOT create WOWY pairs.
 *
 * Version: injury-wowy-eligibility-v1
 */

import {
  OFFICIAL_INJURY_REASON_POLICY_VERSION,
  classifyOfficialInjuryReason,
  type HealthRelation,
  type ReasonCategory,
  type ReasonClassification,
} from './reason-policy';

export const INJURY_WOWY_ELIGIBILITY_POLICY_VERSION =
  'injury-wowy-eligibility-v1' as const;

export type AvailabilityFact =
  | 'ALL_CAUSE_EXPLICIT_OUT'
  | 'ALL_CAUSE_EXPLICIT_AVAILABLE'
  | 'NON_BINARY_EXPLICIT';

export type ReasonSideEligibility =
  | 'WITHOUT_CANDIDATE'
  | 'WITH_CANDIDATE'
  | 'NON_BINARY_UNKNOWN'
  | 'NON_HEALTH_EXCLUDED'
  | 'UNCLASSIFIED_EXCLUDED';

export type InjuryWowyEligibility =
  | ReasonSideEligibility
  | 'INELIGIBLE_IDENTITY';

export type IdentityBucket =
  | 'RESOLVED_CANONICAL_ENTITY'
  | 'RESOLVED_ENTITY_NO_SERVING_PLAYER'
  | 'IDENTITY_QUARANTINED'
  | string;

export type EligibilityInput = {
  status_raw: string | null | undefined;
  reason_raw: string | null | undefined;
  identity_bucket: IdentityBucket | null | undefined;
  /** Optional precomputed reason classification (must match classifier). */
  reason?: ReasonClassification;
};

export type EligibilityResult = {
  reason_policy_version: typeof OFFICIAL_INJURY_REASON_POLICY_VERSION;
  eligibility_policy_version: typeof INJURY_WOWY_ELIGIBILITY_POLICY_VERSION;
  status_raw: string | null;
  reason_raw: string | null;
  reason_category: ReasonCategory;
  health_relation: HealthRelation;
  classification_rule: ReasonClassification['classification_rule'];
  reason_analysis_key: string;
  availability_fact: AvailabilityFact;
  reason_side_eligibility: ReasonSideEligibility;
  identity_status: string | null;
  canonical_identity_resolved: boolean;
  canonical_model_eligible: boolean;
  injury_wowy_eligibility: InjuryWowyEligibility;
};

export function isCanonicalIdentityResolved(
  identityBucket: string | null | undefined
): boolean {
  return (
    identityBucket === 'RESOLVED_CANONICAL_ENTITY' ||
    identityBucket === 'RESOLVED_ENTITY_NO_SERVING_PLAYER'
  );
}

export function deriveAvailabilityFact(
  statusRaw: string | null | undefined
): AvailabilityFact {
  if (statusRaw === 'Out') return 'ALL_CAUSE_EXPLICIT_OUT';
  if (statusRaw === 'Available') return 'ALL_CAUSE_EXPLICIT_AVAILABLE';
  return 'NON_BINARY_EXPLICIT';
}

export function deriveReasonSideEligibility(
  statusRaw: string | null | undefined,
  healthRelation: HealthRelation
): ReasonSideEligibility {
  if (
    statusRaw === 'Questionable' ||
    statusRaw === 'Doubtful' ||
    statusRaw === 'Probable'
  ) {
    return 'NON_BINARY_UNKNOWN';
  }
  if (healthRelation === 'UNCLASSIFIED') return 'UNCLASSIFIED_EXCLUDED';
  if (healthRelation === 'NON_HEALTH_RELATED') return 'NON_HEALTH_EXCLUDED';
  if (statusRaw === 'Out' && healthRelation === 'HEALTH_RELATED') {
    return 'WITHOUT_CANDIDATE';
  }
  if (statusRaw === 'Available' && healthRelation === 'HEALTH_RELATED') {
    return 'WITH_CANDIDATE';
  }
  return 'UNCLASSIFIED_EXCLUDED';
}

/**
 * Apply approved injury-WOWY eligibility policy to a selected T−60 player row.
 */
export function evaluateInjuryWowyEligibility(
  input: EligibilityInput
): EligibilityResult {
  const statusRaw = input.status_raw == null ? null : String(input.status_raw);
  const reasonRaw = input.reason_raw == null ? null : String(input.reason_raw);
  const reason = input.reason ?? classifyOfficialInjuryReason(reasonRaw);
  const identityStatus = input.identity_bucket == null ? null : String(input.identity_bucket);
  const canon = isCanonicalIdentityResolved(identityStatus);
  const reasonSide = deriveReasonSideEligibility(statusRaw, reason.health_relation);

  let injuryElig: InjuryWowyEligibility = reasonSide;
  let modelEligible = false;
  if (reasonSide === 'WITHOUT_CANDIDATE' || reasonSide === 'WITH_CANDIDATE') {
    if (canon) {
      modelEligible = true;
      injuryElig = reasonSide;
    } else {
      modelEligible = false;
      injuryElig = 'INELIGIBLE_IDENTITY';
    }
  }

  return {
    reason_policy_version: OFFICIAL_INJURY_REASON_POLICY_VERSION,
    eligibility_policy_version: INJURY_WOWY_ELIGIBILITY_POLICY_VERSION,
    status_raw: statusRaw,
    reason_raw: reasonRaw,
    reason_category: reason.reason_category,
    health_relation: reason.health_relation,
    classification_rule: reason.classification_rule,
    reason_analysis_key: reason.reason_analysis_key,
    availability_fact: deriveAvailabilityFact(statusRaw),
    reason_side_eligibility: reasonSide,
    identity_status: identityStatus,
    canonical_identity_resolved: canon,
    canonical_model_eligible: modelEligible,
    injury_wowy_eligibility: injuryElig,
  };
}
