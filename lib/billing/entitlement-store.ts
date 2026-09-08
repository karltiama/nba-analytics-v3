import { query, queryOne } from '@/lib/db';
import type { MappedStripeSubscription } from './map-stripe';
import { STRIPE_PROVIDER } from './config';

export type EntitlementBillingRow = {
  user_id: string;
  plan: string;
  status: string;
  current_period_end: string | Date | null;
  provider: string | null;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  last_provider_event_at: string | Date | null;
};

export const ENTITLEMENT_BILLING_SELECT_SQL = `
SELECT user_id, plan, status, current_period_end, provider,
       provider_customer_id, provider_subscription_id, last_provider_event_at
FROM public.user_entitlements
WHERE user_id = $1::uuid
`;

export const ENTITLEMENT_BY_CUSTOMER_SQL = `
SELECT user_id, plan, status, current_period_end, provider,
       provider_customer_id, provider_subscription_id, last_provider_event_at
FROM public.user_entitlements
WHERE provider_customer_id = $1
`;

export const ENTITLEMENT_BY_SUBSCRIPTION_SQL = `
SELECT user_id, plan, status, current_period_end, provider,
       provider_customer_id, provider_subscription_id, last_provider_event_at
FROM public.user_entitlements
WHERE provider_subscription_id = $1
`;

export async function getEntitlementBillingRow(userId: string): Promise<EntitlementBillingRow | null> {
  return queryOne<EntitlementBillingRow>(ENTITLEMENT_BILLING_SELECT_SQL, [userId]);
}

export async function findEntitlementByCustomerId(
  customerId: string
): Promise<EntitlementBillingRow | null> {
  return queryOne<EntitlementBillingRow>(ENTITLEMENT_BY_CUSTOMER_SQL, [customerId]);
}

export async function findEntitlementBySubscriptionId(
  subscriptionId: string
): Promise<EntitlementBillingRow | null> {
  return queryOne<EntitlementBillingRow>(ENTITLEMENT_BY_SUBSCRIPTION_SQL, [subscriptionId]);
}

export const UPSERT_CUSTOMER_SQL = `
INSERT INTO public.user_entitlements (
  user_id, plan, status, provider, provider_customer_id
) VALUES (
  $1::uuid, 'free', 'none', $2, $3
)
ON CONFLICT (user_id) DO UPDATE SET
  provider_customer_id = EXCLUDED.provider_customer_id,
  provider = COALESCE(public.user_entitlements.provider, EXCLUDED.provider),
  updated_at = now()
RETURNING user_id, plan, status, current_period_end, provider,
          provider_customer_id, provider_subscription_id, last_provider_event_at
`;

export const UPSERT_SUBSCRIPTION_SQL = `
INSERT INTO public.user_entitlements (
  user_id, plan, status, current_period_end, provider,
  provider_customer_id, provider_subscription_id, last_provider_event_at
) VALUES (
  $1::uuid, $2, $3, $4, $5, $6, $7, $8
)
ON CONFLICT (user_id) DO UPDATE SET
  plan = EXCLUDED.plan,
  status = EXCLUDED.status,
  current_period_end = EXCLUDED.current_period_end,
  provider = EXCLUDED.provider,
  provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, public.user_entitlements.provider_customer_id),
  provider_subscription_id = EXCLUDED.provider_subscription_id,
  last_provider_event_at = GREATEST(
    public.user_entitlements.last_provider_event_at,
    EXCLUDED.last_provider_event_at
  ),
  updated_at = now()
RETURNING user_id, plan, status, current_period_end, provider,
          provider_customer_id, provider_subscription_id, last_provider_event_at
`;

export async function upsertStripeCustomerId(
  userId: string,
  customerId: string
): Promise<EntitlementBillingRow | null> {
  return queryOne<EntitlementBillingRow>(UPSERT_CUSTOMER_SQL, [userId, STRIPE_PROVIDER, customerId]);
}

export async function applyMappedSubscription(input: {
  userId: string;
  mapped: MappedStripeSubscription;
  eventAt: Date;
}): Promise<EntitlementBillingRow | null> {
  return queryOne<EntitlementBillingRow>(UPSERT_SUBSCRIPTION_SQL, [
    input.userId,
    input.mapped.plan,
    input.mapped.status,
    input.mapped.currentPeriodEnd,
    STRIPE_PROVIDER,
    input.mapped.customerId,
    input.mapped.subscriptionId,
    input.eventAt,
  ]);
}
