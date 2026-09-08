import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { resolveEntitlementFromRow } from '@/lib/entitlements/resolve';

const applyMappedSubscription = vi.fn();
const findEntitlementByCustomerId = vi.fn();
const findEntitlementBySubscriptionId = vi.fn();
const getEntitlementBillingRow = vi.fn();

vi.mock('../entitlement-store', () => ({
  applyMappedSubscription: (...args: unknown[]) => applyMappedSubscription(...args),
  findEntitlementByCustomerId: (...args: unknown[]) => findEntitlementByCustomerId(...args),
  findEntitlementBySubscriptionId: (...args: unknown[]) => findEntitlementBySubscriptionId(...args),
  getEntitlementBillingRow: (...args: unknown[]) => getEntitlementBillingRow(...args),
}));

vi.mock('../stripe-client', () => ({
  getStripeClient: () => null,
}));

import { syncStripeSubscriptionToEntitlement } from '../sync-subscription';

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const PRICE = 'price_founding_pro';
const NOW = new Date('2026-09-07T16:00:00.000Z');
const FUTURE = Math.floor(new Date('2026-10-07T16:00:00.000Z').getTime() / 1000);

function stubEnv() {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_abc');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_abc');
  vi.stubEnv('STRIPE_FOUNDING_PRO_PRICE_ID', PRICE);
  vi.stubEnv('APP_BASE_URL', 'http://localhost:3000');
}

function makeSub(input: {
  status: Stripe.Subscription.Status;
  priceId?: string;
  userId?: string;
  cancelAtPeriodEnd?: boolean;
  id?: string;
}): Stripe.Subscription {
  return {
    id: input.id ?? 'sub_A',
    customer: 'cus_A',
    status: input.status,
    cancel_at_period_end: Boolean(input.cancelAtPeriodEnd),
    current_period_end: FUTURE,
    metadata: { app_user_id: input.userId ?? USER_A },
    items: { data: [{ price: { id: input.priceId ?? PRICE } }] },
  } as unknown as Stripe.Subscription;
}

describe('syncStripeSubscriptionToEntitlement', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubEnv();
    applyMappedSubscription.mockReset();
    findEntitlementByCustomerId.mockReset();
    findEntitlementBySubscriptionId.mockReset();
    getEntitlementBillingRow.mockReset();
    applyMappedSubscription.mockResolvedValue({ user_id: USER_A });
  });

  it('grants founding_pro for an active recognized subscription', async () => {
    const result = await syncStripeSubscriptionToEntitlement({
      subscription: makeSub({ status: 'active' }),
      eventAt: NOW,
    });
    expect(result.ok).toBe(true);
    const mapped = applyMappedSubscription.mock.calls[0]?.[0] as {
      userId: string;
      mapped: { plan: string; status: string };
    };
    expect(mapped.userId).toBe(USER_A);
    expect(mapped.mapped.plan).toBe('founding_pro');
    expect(mapped.mapped.status).toBe('active');
    expect(
      resolveEntitlementFromRow(
        {
          user_id: USER_A,
          plan: mapped.mapped.plan,
          status: mapped.mapped.status,
          current_period_end: '2026-10-07T16:00:00.000Z',
          provider: 'stripe',
        },
        NOW
      ).isPro
    ).toBe(true);
  });

  it('does not grant Pro for an unknown price', async () => {
    await syncStripeSubscriptionToEntitlement({
      subscription: makeSub({ status: 'active', priceId: 'price_other' }),
      eventAt: NOW,
    });
    const mapped = applyMappedSubscription.mock.calls[0]?.[0] as { mapped: { plan: string } };
    expect(mapped.mapped.plan).toBe('free');
  });

  it('keeps canceled Founding Pro until period end', async () => {
    await syncStripeSubscriptionToEntitlement({
      subscription: makeSub({ status: 'active', cancelAtPeriodEnd: true }),
      eventAt: NOW,
    });
    const mapped = applyMappedSubscription.mock.calls[0]?.[0] as {
      mapped: { plan: string; status: string; currentPeriodEnd: Date | null };
    };
    expect(mapped.mapped.plan).toBe('founding_pro');
    expect(mapped.mapped.status).toBe('canceled');
    expect(
      resolveEntitlementFromRow(
        {
          user_id: USER_A,
          plan: 'founding_pro',
          status: 'canceled',
          current_period_end: mapped.mapped.currentPeriodEnd,
          provider: 'stripe',
        },
        NOW
      ).isPro
    ).toBe(true);
  });

  it('maps past_due to Free and later active recovery to Pro', async () => {
    await syncStripeSubscriptionToEntitlement({
      subscription: makeSub({ status: 'past_due' }),
      eventAt: NOW,
    });
    const failed = applyMappedSubscription.mock.calls[0]?.[0] as { mapped: { status: string } };
    expect(failed.mapped.status).toBe('past_due');
    expect(
      resolveEntitlementFromRow(
        {
          user_id: USER_A,
          plan: 'founding_pro',
          status: 'past_due',
          current_period_end: '2026-10-07T16:00:00.000Z',
          provider: 'stripe',
        },
        NOW
      ).isPro
    ).toBe(false);

    await syncStripeSubscriptionToEntitlement({
      subscription: makeSub({ status: 'active' }),
      eventAt: new Date('2026-09-07T17:00:00.000Z'),
    });
    const recovered = applyMappedSubscription.mock.calls[1]?.[0] as { mapped: { status: string } };
    expect(recovered.mapped.status).toBe('active');
  });

  it('expires access when the subscription is deleted', async () => {
    getEntitlementBillingRow.mockResolvedValue({
      user_id: USER_A,
      provider_subscription_id: 'sub_A',
    });
    await syncStripeSubscriptionToEntitlement({
      subscription: makeSub({ status: 'canceled' }),
      eventAt: NOW,
      deleted: true,
    });
    const mapped = applyMappedSubscription.mock.calls[0]?.[0] as {
      mapped: { plan: string; status: string };
    };
    expect(mapped.mapped.plan).toBe('free');
    expect(mapped.mapped.status).toBe('expired');
  });

  it('does not apply a stale deleted event for a previous subscription onto a newer one', async () => {
    getEntitlementBillingRow.mockResolvedValue({
      user_id: USER_A,
      provider_subscription_id: 'sub_NEW',
    });
    await syncStripeSubscriptionToEntitlement({
      subscription: makeSub({ status: 'canceled', id: 'sub_OLD' }),
      eventAt: NOW,
      deleted: true,
    });
    expect(applyMappedSubscription).not.toHaveBeenCalled();
  });

  it('never writes user B from a user A subscription', async () => {
    await syncStripeSubscriptionToEntitlement({
      subscription: makeSub({ status: 'active', userId: USER_A }),
      eventAt: NOW,
    });
    const mapped = applyMappedSubscription.mock.calls[0]?.[0] as { userId: string };
    expect(mapped.userId).toBe(USER_A);
    expect(mapped.userId).not.toBe(USER_B);
  });
});
