import { NextRequest, NextResponse } from 'next/server';
import { requireBettingAuth } from '@/lib/auth/require-betting-auth';
import { getUserEntitlements } from '@/lib/entitlements/queries';
import { getBillingAvailability } from '@/lib/billing/availability';
import { getEntitlementBillingRow } from '@/lib/billing/entitlement-store';

export async function GET(request: NextRequest) {
  const gate = await requireBettingAuth(request);
  if (!gate.ok) return gate.response;

  // Query params such as Checkout session_id are ignored. Redirects are not billing authority.
  const entitlement = await getUserEntitlements(gate.auth.userId);
  const row = await getEntitlementBillingRow(gate.auth.userId);
  const availability = getBillingAvailability();
  return gate.withAuthCookies(
    NextResponse.json({
      plan: entitlement.plan,
      isPro: entitlement.isPro,
      status: entitlement.status,
      currentPeriodEnd: entitlement.currentPeriodEnd,
      provider: row?.provider === 'stripe' ? 'stripe' : null,
      canManageBilling: Boolean(
        availability.portalEnabled && row?.provider === 'stripe' && row.provider_customer_id
      ),
      billingMode: availability.mode,
      checkoutEnabled: availability.checkoutEnabled,
      portalEnabled: availability.portalEnabled,
      billingNotice: availability.notice,
      priceLabel: availability.priceLabel,
    })
  );
}
