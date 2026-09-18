/**
 * PTS production-context features from certified Role/Form only.
 * No raw PGL fallback. No unauthorized signals.
 */

import {
  FORM_CONTEXT_VERSION,
  PRODUCTION_PTS_CONTEXT_FEATURES,
  ROLE_CONTEXT_VERSION,
  UNAUTHORIZED_PTS_CONTEXT_FEATURES,
  type ProductionPtsContextFeature,
} from '@/lib/context-projection/protocol';

export interface RoleFormSourceContexts {
  roleContextVersion?: string | null;
  formContextVersion?: string | null;
  /** Certified role.recent_fga / role.season_fga (null if unavailable). */
  roleRecentFga?: number | null;
  roleSeasonFga?: number | null;
  /** Certified form.recent_points / form.season_points (null if unavailable). */
  formRecentPoints?: number | null;
  formSeasonPoints?: number | null;
}

export interface AssembledPtsContextFeatures {
  'role.fga_delta': number | null;
  'form.points_delta': number | null;
  roleAvailable: boolean;
  formAvailable: boolean;
  roleContextVersion: string | null;
  formContextVersion: string | null;
  roleRecentFga: number | null;
  roleSeasonFga: number | null;
  formRecentPoints: number | null;
  formSeasonPoints: number | null;
}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * role.fga_delta = role.recent_fga - role.season_fga
 * form.points_delta = form.recent_points - form.season_points
 */
export function assemblePtsContextFeatures(
  src: RoleFormSourceContexts
): AssembledPtsContextFeatures {
  const roleOk =
    finite(src.roleRecentFga) &&
    finite(src.roleSeasonFga) &&
    (src.roleContextVersion == null || src.roleContextVersion === ROLE_CONTEXT_VERSION);
  const formOk =
    finite(src.formRecentPoints) &&
    finite(src.formSeasonPoints) &&
    (src.formContextVersion == null || src.formContextVersion === FORM_CONTEXT_VERSION);

  const roleDelta = roleOk ? (src.roleRecentFga as number) - (src.roleSeasonFga as number) : null;
  const formDelta = formOk
    ? (src.formRecentPoints as number) - (src.formSeasonPoints as number)
    : null;

  return {
    'role.fga_delta': roleDelta,
    'form.points_delta': formDelta,
    roleAvailable: roleDelta != null,
    formAvailable: formDelta != null,
    roleContextVersion: roleOk ? ROLE_CONTEXT_VERSION : null,
    formContextVersion: formOk ? FORM_CONTEXT_VERSION : null,
    roleRecentFga: roleOk ? (src.roleRecentFga as number) : null,
    roleSeasonFga: roleOk ? (src.roleSeasonFga as number) : null,
    formRecentPoints: formOk ? (src.formRecentPoints as number) : null,
    formSeasonPoints: formOk ? (src.formSeasonPoints as number) : null,
  };
}

/** Reject unauthorized feature names in a candidate assembly map. */
export function assertAuthorizedFeatureKeys(keys: string[]): void {
  const allowed = new Set<string>(PRODUCTION_PTS_CONTEXT_FEATURES);
  for (const k of keys) {
    if (!allowed.has(k)) {
      throw new Error(`UNAUTHORIZED_PTS_CONTEXT_FEATURE: ${k}`);
    }
  }
}

export function rejectUnauthorizedInjection(candidate: Record<string, unknown>): string[] {
  const rejected: string[] = [];
  for (const k of Object.keys(candidate)) {
    if ((UNAUTHORIZED_PTS_CONTEXT_FEATURES as readonly string[]).includes(k)) {
      rejected.push(k);
    }
    if (
      k.startsWith('interpretation.') ||
      k.startsWith('opponent.') ||
      k.startsWith('schedule.') ||
      k.startsWith('matchup.') ||
      k.startsWith('injury.')
    ) {
      if (!(PRODUCTION_PTS_CONTEXT_FEATURES as readonly string[]).includes(k)) {
        if (!rejected.includes(k)) rejected.push(k);
      }
    }
  }
  return rejected;
}

export function featureVectorForBranch(
  assembled: AssembledPtsContextFeatures,
  branch: 'ROLE_FORM_JOINT' | 'ROLE_ONLY' | 'FORM_ONLY'
): { names: ProductionPtsContextFeature[]; values: number[] } | null {
  if (branch === 'ROLE_FORM_JOINT') {
    if (!assembled.roleAvailable || !assembled.formAvailable) return null;
    return {
      names: ['role.fga_delta', 'form.points_delta'],
      values: [assembled['role.fga_delta']!, assembled['form.points_delta']!],
    };
  }
  if (branch === 'ROLE_ONLY') {
    if (!assembled.roleAvailable) return null;
    return { names: ['role.fga_delta'], values: [assembled['role.fga_delta']!] };
  }
  if (!assembled.formAvailable) return null;
  return { names: ['form.points_delta'], values: [assembled['form.points_delta']!] };
}

/** CONTEXT_RAW_FALLBACK_COUNT must remain 0 — this API accepts only certified context fields. */
export const CONTEXT_RAW_FALLBACK_COUNT = 0 as const;
