import type Stripe from 'stripe';
import { getStripeClient } from './stripe-client';
import { getEntitlementBillingRow, upsertStripeCustomerId } from './entitlement-store';

const APP_USER_METADATA = 'app_user_id';

export async function getOrCreateStripeCustomer(input: {
  userId: string;
  email?: string | null;
}): Promise<{ ok: true; customerId: string } | { ok: false; error: string }> {
  const stripe = getStripeClient();
  if (!stripe) return { ok: false, error: 'Billing is not configured' };

  const existing = await getEntitlementBillingRow(input.userId);
  const storedId = existing?.provider_customer_id?.trim();
  if (storedId) {
    try {
      const customer = await stripe.customers.retrieve(storedId);
      if (customer && !('deleted' in customer && customer.deleted)) {
        return { ok: true, customerId: customer.id };
      }
    } catch {
      // stored id is stale; create a replacement
    }
  }

  const customer = await stripe.customers.create({
    email: input.email || undefined,
    metadata: { [APP_USER_METADATA]: input.userId },
  });
  await upsertStripeCustomerId(input.userId, customer.id);
  return { ok: true, customerId: customer.id };
}

export function appUserIdFromStripeObject(obj: {
  metadata?: Stripe.Metadata | null;
  client_reference_id?: string | null;
} | null | undefined): string | null {
  const fromMeta = obj?.metadata?.[APP_USER_METADATA]?.trim();
  if (fromMeta) return fromMeta;
  const fromRef = obj?.client_reference_id?.trim();
  return fromRef || null;
}
