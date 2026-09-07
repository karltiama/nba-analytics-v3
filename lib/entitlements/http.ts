import { NextResponse } from 'next/server';
import { UPGRADE_COPY, type FeatureKey } from './types';

export const ENTITLEMENT_REQUIRED = 'ENTITLEMENT_REQUIRED' as const;

export function entitlementRequiredResponse(feature: FeatureKey, withAuthCookies?: (r: NextResponse) => NextResponse) {
  const copy = UPGRADE_COPY[feature];
  const response = NextResponse.json(
    {
      error: ENTITLEMENT_REQUIRED,
      feature,
      planRequired: 'founding_pro',
      message: copy.title,
      detail: copy.detail,
    },
    { status: 403 }
  );
  return withAuthCookies ? withAuthCookies(response) : response;
}
