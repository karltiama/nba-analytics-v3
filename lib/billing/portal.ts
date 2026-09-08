import { getStripeBillingConfig } from './config';
import { getStripeClient } from './stripe-client';
import { getEntitlementBillingRow } from './entitlement-store';

export type PortalCreateResult =
  | { ok: true; url: string }
  | { ok: false; status: number; error: string; code?: string };

export async function createBillingPortalSession(userId: string): Promise<PortalCreateResult> {
  const cfg = getStripeBillingConfig();
  if (!cfg.ok) return { ok: false, status: 503, error: cfg.error, code: 'BILLING_UNCONFIGURED' };

  const row = await getEntitlementBillingRow(userId);
  const customerId = row?.provider_customer_id?.trim();
  if (!customerId) {
    return {
      ok: false,
      status: 404,
      error: 'No Stripe billing customer is on file for this account.',
      code: 'NO_BILLING_CUSTOMER',
    };
  }

  const stripe = getStripeClient();
  if (!stripe) return { ok: false, status: 503, error: 'Billing is not configured', code: 'BILLING_UNCONFIGURED' };

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${cfg.config.appBaseUrl}/billing`,
  });
  if (!session.url) {
    return { ok: false, status: 500, error: 'Portal session missing URL', code: 'PORTAL_FAILED' };
  }
  return { ok: true, url: session.url };
}
