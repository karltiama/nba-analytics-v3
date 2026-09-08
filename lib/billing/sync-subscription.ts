import type Stripe from 'stripe';
import { getStripeBillingConfig } from './config';
import { getStripeClient } from './stripe-client';
import {
  mapStripeSubscriptionToEntitlement,
  terminalDeletedSubscription,
} from './map-stripe';
import {
  applyMappedSubscription,
  findEntitlementByCustomerId,
  findEntitlementBySubscriptionId,
  getEntitlementBillingRow,
} from './entitlement-store';
import { appUserIdFromStripeObject } from './customers';

export async function resolveUserIdForStripeSubscription(
  subscription: Stripe.Subscription
): Promise<string | null> {
  const fromSub = appUserIdFromStripeObject(subscription);
  if (fromSub) return fromSub;

  const customer = subscription.customer;
  const customerId = typeof customer === 'string' ? customer : customer?.id;
  if (customerId) {
    const byCustomer = await findEntitlementByCustomerId(customerId);
    if (byCustomer?.user_id) return byCustomer.user_id;
  }
  const bySub = await findEntitlementBySubscriptionId(subscription.id);
  return bySub?.user_id ?? null;
}

/**
 * Reconcile one Stripe subscription into user_entitlements.
 * Prefer the live Stripe object (caller retrieves it). Duplicates are handled by
 * provider_event_id. last_provider_event_at is audit metadata, not write authority.
 * A deleted event for a previous subscription id must not wipe a newer replacement.
 */
export async function syncStripeSubscriptionToEntitlement(input: {
  subscription: Stripe.Subscription;
  eventAt: Date;
  deleted?: boolean;
}): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const cfg = getStripeBillingConfig();
  if (!cfg.ok) return { ok: false, error: cfg.error };

  const userId = await resolveUserIdForStripeSubscription(input.subscription);
  if (!userId) return { ok: false, error: 'No app user mapped for Stripe subscription' };

  if (input.deleted) {
    const existing = await getEntitlementBillingRow(userId);
    const currentSubId = existing?.provider_subscription_id?.trim();
    if (currentSubId && currentSubId !== input.subscription.id) {
      return { ok: true, userId };
    }
  }

  const mapped = input.deleted
    ? terminalDeletedSubscription({
        subscriptionId: input.subscription.id,
        customerId:
          typeof input.subscription.customer === 'string'
            ? input.subscription.customer
            : input.subscription.customer?.id ?? null,
        currentPeriodEnd: new Date(input.eventAt),
      })
    : mapStripeSubscriptionToEntitlement(input.subscription, cfg.config.foundingProPriceId);

  const applied = await applyMappedSubscription({
    userId,
    mapped,
    eventAt: input.eventAt,
  });
  if (!applied) {
    return { ok: true, userId };
  }
  return { ok: true, userId };
}

export async function retrieveAndSyncSubscription(
  subscriptionId: string,
  eventAt: Date
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const stripe = getStripeClient();
  if (!stripe) return { ok: false, error: 'Billing is not configured' };
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return syncStripeSubscriptionToEntitlement({ subscription, eventAt });
}

export function unixEventDate(created: number | undefined): Date {
  if (typeof created === 'number' && Number.isFinite(created)) {
    return new Date(created * 1000);
  }
  return new Date();
}
