import type Stripe from 'stripe';
import type { PlanId, SubscriptionStatus } from '@/lib/entitlements/types';

export type MappedStripeSubscription = {
  plan: PlanId;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  customerId: string | null;
  subscriptionId: string;
  recognizedFoundingProPrice: boolean;
};

function unixToDate(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const d = new Date(value * 1000);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function subscriptionPriceIds(subscription: Stripe.Subscription): string[] {
  const items = subscription.items?.data ?? [];
  return items
    .map((item) => {
      const price = item.price;
      if (!price) return null;
      return typeof price === 'string' ? price : price.id;
    })
    .filter((id): id is string => Boolean(id));
}

export function subscriptionCurrentPeriodEnd(subscription: Stripe.Subscription): Date | null {
  const root = unixToDate((subscription as { current_period_end?: unknown }).current_period_end);
  if (root) return root;
  const item = subscription.items?.data?.[0] as { current_period_end?: unknown } | undefined;
  return unixToDate(item?.current_period_end);
}

export function subscriptionCustomerId(subscription: Stripe.Subscription): string | null {
  const c = subscription.customer;
  if (!c) return null;
  return typeof c === 'string' ? c : c.id;
}

/**
 * Stripe's newer Billing API can schedule cancellation with `cancel_at`
 * while leaving `cancel_at_period_end` false. Treat either as cancel-at-period-end.
 */
export function subscriptionCancelScheduled(subscription: Stripe.Subscription): boolean {
  if (Boolean(subscription.cancel_at_period_end)) return true;
  const cancelAt = unixToDate((subscription as { cancel_at?: unknown }).cancel_at);
  if (!cancelAt) return false;
  const stripeStatus = (subscription.status ?? '').toLowerCase();
  return stripeStatus === 'active' || stripeStatus === 'trialing';
}

/**
 * Map Stripe subscription → WP6.2 plan/status.
 * Unknown/unrecognized prices never become founding_pro.
 * Stripe active + scheduled cancellation → internal canceled (Pro until period end).
 */
export function mapStripeSubscriptionToEntitlement(
  subscription: Stripe.Subscription,
  foundingProPriceId: string
): MappedStripeSubscription {
  const priceIds = subscriptionPriceIds(subscription);
  const recognizedFoundingProPrice = priceIds.includes(foundingProPriceId);
  const subscriptionId = subscription.id;
  const customerId = subscriptionCustomerId(subscription);
  const currentPeriodEnd = subscriptionCurrentPeriodEnd(subscription);
  const stripeStatus = (subscription.status ?? '').toLowerCase();
  const cancelAtPeriodEnd = subscriptionCancelScheduled(subscription);

  let status: SubscriptionStatus = 'none';
  if (stripeStatus === 'active' && cancelAtPeriodEnd) status = 'canceled';
  else if (stripeStatus === 'active') status = 'active';
  else if (stripeStatus === 'trialing') status = 'trialing';
  else if (stripeStatus === 'canceled') status = 'canceled';
  else if (stripeStatus === 'past_due') status = 'past_due';
  else if (stripeStatus === 'unpaid') status = 'unpaid';
  else if (stripeStatus === 'incomplete_expired') status = 'expired';
  else if (stripeStatus === 'paused') status = 'unpaid';
  else if (stripeStatus === 'incomplete') status = 'none';
  else status = 'none';

  const plan: PlanId = recognizedFoundingProPrice ? 'founding_pro' : 'free';

  return {
    plan,
    status,
    currentPeriodEnd,
    customerId,
    subscriptionId,
    recognizedFoundingProPrice,
  };
}

export function terminalDeletedSubscription(input: {
  subscriptionId: string;
  customerId: string | null;
  currentPeriodEnd?: Date | null;
}): MappedStripeSubscription {
  return {
    plan: 'free',
    status: 'expired',
    currentPeriodEnd: input.currentPeriodEnd ?? new Date(),
    customerId: input.customerId,
    subscriptionId: input.subscriptionId,
    recognizedFoundingProPrice: false,
  };
}
