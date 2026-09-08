import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import {
  mapStripeSubscriptionToEntitlement,
  terminalDeletedSubscription,
} from '../map-stripe';

const PRICE = 'price_founding_pro';
const FUTURE = 1893456000;

function makeSub(input: {
  status: Stripe.Subscription.Status;
  priceId?: string;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: number;
}): Stripe.Subscription {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: input.status,
    cancel_at_period_end: Boolean(input.cancelAtPeriodEnd),
    current_period_end: input.currentPeriodEnd ?? FUTURE,
    items: {
      data: [{ price: { id: input.priceId ?? PRICE } }],
    },
  } as unknown as Stripe.Subscription;
}

describe('mapStripeSubscriptionToEntitlement', () => {
  it('maps active recognized price to founding_pro / active', () => {
    const mapped = mapStripeSubscriptionToEntitlement(makeSub({ status: 'active' }), PRICE);
    expect(mapped.plan).toBe('founding_pro');
    expect(mapped.status).toBe('active');
    expect(mapped.recognizedFoundingProPrice).toBe(true);
  });

  it('maps trialing recognized price to founding_pro / trialing', () => {
    const mapped = mapStripeSubscriptionToEntitlement(makeSub({ status: 'trialing' }), PRICE);
    expect(mapped.plan).toBe('founding_pro');
    expect(mapped.status).toBe('trialing');
  });

  it('maps active cancel_at_period_end to internal canceled', () => {
    const mapped = mapStripeSubscriptionToEntitlement(
      makeSub({ status: 'active', cancelAtPeriodEnd: true }),
      PRICE
    );
    expect(mapped.plan).toBe('founding_pro');
    expect(mapped.status).toBe('canceled');
  });

  it('maps active + cancel_at to internal canceled when cancel_at_period_end is false', () => {
    const mapped = mapStripeSubscriptionToEntitlement(
      {
        ...makeSub({ status: 'active', cancelAtPeriodEnd: false }),
        cancel_at: FUTURE,
      } as Stripe.Subscription,
      PRICE
    );
    expect(mapped.plan).toBe('founding_pro');
    expect(mapped.status).toBe('canceled');
  });

  it('does not grant Pro for an unknown price', () => {
    const mapped = mapStripeSubscriptionToEntitlement(
      makeSub({ status: 'active', priceId: 'price_other' }),
      PRICE
    );
    expect(mapped.plan).toBe('free');
    expect(mapped.recognizedFoundingProPrice).toBe(false);
  });

  it('maps past_due and unpaid to fail-closed statuses', () => {
    expect(mapStripeSubscriptionToEntitlement(makeSub({ status: 'past_due' }), PRICE).status).toBe(
      'past_due'
    );
    expect(mapStripeSubscriptionToEntitlement(makeSub({ status: 'unpaid' }), PRICE).status).toBe(
      'unpaid'
    );
    expect(mapStripeSubscriptionToEntitlement(makeSub({ status: 'paused' }), PRICE).status).toBe(
      'unpaid'
    );
    expect(mapStripeSubscriptionToEntitlement(makeSub({ status: 'incomplete' }), PRICE).status).toBe(
      'none'
    );
    expect(
      mapStripeSubscriptionToEntitlement(makeSub({ status: 'incomplete_expired' }), PRICE).status
    ).toBe('expired');
  });

  it('maps deleted subscriptions to free / expired', () => {
    const mapped = terminalDeletedSubscription({
      subscriptionId: 'sub_1',
      customerId: 'cus_1',
    });
    expect(mapped.plan).toBe('free');
    expect(mapped.status).toBe('expired');
  });
});
