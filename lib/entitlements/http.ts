import { NextResponse } from 'next/server';
import type { CapabilityDecision } from './capabilities';
import { UPGRADE_COPY, type FeatureKey } from './types';

export const ENTITLEMENT_REQUIRED = 'ENTITLEMENT_REQUIRED' as const;
export const FEATURE_NOT_AVAILABLE = 'FEATURE_NOT_AVAILABLE' as const;

export function entitlementRequiredResponse(
  feature: FeatureKey,
  withAuthCookies?: (r: NextResponse) => NextResponse,
  decision?: CapabilityDecision
) {
  const copy = UPGRADE_COPY[feature];
  const upgrade = decision == null ? true : decision.showUpgrade;
  const response = NextResponse.json(
    upgrade
      ? {
          error: ENTITLEMENT_REQUIRED,
          feature,
          planRequired: 'founding_pro',
          message: copy.title,
          detail: copy.detail,
        }
      : {
          error: FEATURE_NOT_AVAILABLE,
          feature,
          reason: decision?.reason ?? 'FEATURE_NOT_READY',
          message: copy.title,
          detail: copy.detail,
        },
    { status: 403 }
  );
  return withAuthCookies ? withAuthCookies(response) : response;
}
