/**
 * Auxiliary MIN features from certified Role + Availability only.
 */

import {
  AVAIL_CONTEXT_VERSION,
  AVAIL_MIN_VALIDATED_COMPLETENESS_POLICY,
  AUX_MIN_JOINT_FEATURES,
  AUX_MIN_UNAUTHORIZED_FEATURES,
  H3_ROLE_MIN_FEATURES,
  H5_AVAIL_MIN_FEATURES,
  ROLE_CONTEXT_VERSION,
} from '@/lib/context-projection/min/protocol';

export interface AuxMinSourceContexts {
  roleContextVersion?: string | null;
  availContextVersion?: string | null;
  roleRecentMinutes?: number | null;
  roleSeasonMinutes?: number | null;
  expectedMissingMinutes?: number | null;
  rotationPlayersOutCount?: number | null;
  /** Must be COMPLETE for Availability branch (primary H5 contract). */
  availCompleteness?: string | null;
}

export interface AssembledAuxMinFeatures {
  'role.minutes_delta': number | null;
  'injury.expected_missing_minutes': number | null;
  'injury.rotation_players_out_count': number | null;
  roleAvailable: boolean;
  availAvailable: boolean;
  roleContextVersion: string | null;
  availContextVersion: string | null;
}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function assembleAuxMinFeatures(src: AuxMinSourceContexts): AssembledAuxMinFeatures {
  const roleOk =
    finite(src.roleRecentMinutes) &&
    finite(src.roleSeasonMinutes) &&
    (src.roleContextVersion == null || src.roleContextVersion === ROLE_CONTEXT_VERSION);

  const completeOk =
    AVAIL_MIN_VALIDATED_COMPLETENESS_POLICY === 'COMPLETE_ONLY_PRIMARY'
      ? src.availCompleteness === 'COMPLETE'
      : true;
  const availOk =
    completeOk &&
    finite(src.expectedMissingMinutes) &&
    finite(src.rotationPlayersOutCount) &&
    (src.availContextVersion == null || src.availContextVersion === AVAIL_CONTEXT_VERSION);

  return {
    'role.minutes_delta': roleOk
      ? (src.roleRecentMinutes as number) - (src.roleSeasonMinutes as number)
      : null,
    'injury.expected_missing_minutes': availOk ? (src.expectedMissingMinutes as number) : null,
    'injury.rotation_players_out_count': availOk ? (src.rotationPlayersOutCount as number) : null,
    roleAvailable: roleOk,
    availAvailable: availOk,
    roleContextVersion: roleOk ? ROLE_CONTEXT_VERSION : null,
    availContextVersion: availOk ? AVAIL_CONTEXT_VERSION : null,
  };
}

export function featureVectorForMinBranch(
  assembled: AssembledAuxMinFeatures,
  branch: 'ROLE_AVAIL_JOINT' | 'ROLE_ONLY' | 'AVAIL_ONLY'
): { names: string[]; values: number[] } | null {
  if (branch === 'ROLE_AVAIL_JOINT') {
    if (!assembled.roleAvailable || !assembled.availAvailable) return null;
    return {
      names: [...AUX_MIN_JOINT_FEATURES],
      values: [
        assembled['role.minutes_delta']!,
        assembled['injury.expected_missing_minutes']!,
        assembled['injury.rotation_players_out_count']!,
      ],
    };
  }
  if (branch === 'ROLE_ONLY') {
    if (!assembled.roleAvailable) return null;
    return {
      names: [...H3_ROLE_MIN_FEATURES],
      values: [assembled['role.minutes_delta']!],
    };
  }
  if (!assembled.availAvailable) return null;
  return {
    names: [...H5_AVAIL_MIN_FEATURES],
    values: [
      assembled['injury.expected_missing_minutes']!,
      assembled['injury.rotation_players_out_count']!,
    ],
  };
}

export function rejectUnauthorizedMinFeatures(candidate: Record<string, unknown>): string[] {
  const rejected: string[] = [];
  const allowed = new Set<string>(AUX_MIN_JOINT_FEATURES);
  for (const k of Object.keys(candidate)) {
    if ((AUX_MIN_UNAUTHORIZED_FEATURES as readonly string[]).includes(k)) rejected.push(k);
    if (
      k.startsWith('schedule.') ||
      k.startsWith('opponent.') ||
      k.startsWith('form.') ||
      k.startsWith('matchup.') ||
      k.startsWith('interpretation.')
    ) {
      if (!allowed.has(k) && !rejected.includes(k)) rejected.push(k);
    }
    if (k.includes('pts') || k.includes('PTS') || k === 'shadow_context_pts') {
      if (!rejected.includes(k)) rejected.push(k);
    }
  }
  return rejected;
}

export function assertJointFeatureParity(actual: string[]): boolean {
  const expected = [...AUX_MIN_JOINT_FEATURES].sort();
  const got = [...actual].sort();
  return expected.length === got.length && expected.every((x, i) => x === got[i]);
}

export const AUX_MIN_CONTEXT_RAW_FALLBACK_COUNT = 0 as const;
