import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { resolveEntitlementFromRow } from '@/lib/entitlements/resolve';

const claimWebhookEvent = vi.fn();
const completeWebhookEvent = vi.fn();
const releaseWebhookEvent = vi.fn();
const applyMappedSubscription = vi.fn();
const findEntitlementByCustomerId = vi.fn();
const findEntitlementBySubscriptionId = vi.fn();
const getStripeClient = vi.fn();

vi.mock('@/lib/billing/webhook-store', () => ({
  claimWebhookEvent: (...args: unknown[]) => claimWebhookEvent(...args),
  completeWebhookEvent: (...args: unknown[]) => completeWebhookEvent(...args),
  releaseWebhookEvent: (...args: unknown[]) => releaseWebhookEvent(...args),
}));

const getEntitlementBillingRow = vi.fn();

vi.mock('@/lib/billing/entitlement-store', () => ({
  applyMappedSubscription: (...args: unknown[]) => applyMappedSubscription(...args),
  findEntitlementByCustomerId: (...args: unknown[]) => findEntitlementByCustomerId(...args),
  findEntitlementBySubscriptionId: (...args: unknown[]) => findEntitlementBySubscriptionId(...args),
  getEntitlementBillingRow: (...args: unknown[]) => getEntitlementBillingRow(...args),
}));

vi.mock('@/lib/billing/stripe-client', () => ({
  getStripeClient: (...args: unknown[]) => getStripeClient(...args),
}));

import { processStripeEvent } from '../process-event';

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const PRICE = 'price_founding_pro';
const FUTURE = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 20;
const NOW = new Date('2026-09-07T16:00:00.000Z');

function makeSub(input: {
  id?: string;
  status: Stripe.Subscription.Status;
  priceId?: string;
  userId?: string;
  customer?: string;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: number;
}): Stripe.Subscription {
  return {
    id: input.id ?? 'sub_A',
    customer: input.customer ?? 'cus_A',
    status: input.status,
    cancel_at_period_end: Boolean(input.cancelAtPeriodEnd),
    current_period_end: input.currentPeriodEnd ?? FUTURE,
    metadata: { app_user_id: input.userId ?? USER_A },
    items: { data: [{ price: { id: input.priceId ?? PRICE } }] },
  } as unknown as Stripe.Subscription;
}

function makeEvent(type: Stripe.Event.Type, object: unknown, id = `evt_${type}`): Stripe.Event {
  return {
    id,
    object: 'event',
    type,
    created: Math.floor(NOW.getTime() / 1000),
    data: { object },
  } as Stripe.Event;
}

function stubEnv() {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_abc');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_abc');
  vi.stubEnv('STRIPE_FOUNDING_PRO_PRICE_ID', PRICE);
  vi.stubEnv('APP_BASE_URL', 'http://localhost:3000');
}

describe('processStripeEvent', () => {
  const retrieve = vi.fn();
  const claimed = new Set<string>();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubEnv();
    claimed.clear();
    claimWebhookEvent.mockImplementation(async ({ eventId }: { eventId: string }) => {
      if (claimed.has(eventId)) return 'duplicate';
      claimed.add(eventId);
      return 'claimed';
    });
    completeWebhookEvent.mockResolvedValue(undefined);
    releaseWebhookEvent.mockResolvedValue(undefined);
    applyMappedSubscription.mockResolvedValue({ user_id: USER_A });
    findEntitlementByCustomerId.mockResolvedValue(null);
    findEntitlementBySubscriptionId.mockResolvedValue(null);
    getEntitlementBillingRow.mockResolvedValue({
      user_id: USER_A,
      provider_subscription_id: 'sub_A',
    });
    getStripeClient.mockReturnValue({ subscriptions: { retrieve } });
    retrieve.mockImplementation(async (id: string) => makeSub({ id, status: 'active' }));
  });

  it('is idempotent for duplicate provider event IDs', async () => {
    const event = makeEvent('customer.subscription.updated', makeSub({ status: 'active' }), 'evt_dup');
    await expect(processStripeEvent(event)).resolves.toBe('processed');
    await expect(processStripeEvent(event)).resolves.toBe('duplicate');
    expect(applyMappedSubscription).toHaveBeenCalledTimes(1);
  });

  it('does not grant Pro for an unknown price', async () => {
    retrieve.mockResolvedValueOnce(makeSub({ status: 'active', priceId: 'price_other' }));
    await processStripeEvent(makeEvent('customer.subscription.updated', makeSub({ status: 'active' })));
    const mapped = applyMappedSubscription.mock.calls[0]?.[0].mapped;
    expect(mapped.plan).toBe('free');
    expect(
      resolveEntitlementFromRow(
        {
          user_id: USER_A,
          plan: mapped.plan,
          status: mapped.status,
          current_period_end: mapped.currentPeriodEnd,
          provider: 'stripe',
        },
        NOW
      ).isPro
    ).toBe(false);
  });

  it('maps active Founding Pro to Pro', async () => {
    await processStripeEvent(makeEvent('customer.subscription.created', makeSub({ status: 'active' })));
    const mapped = applyMappedSubscription.mock.calls[0]?.[0].mapped;
    expect(mapped.plan).toBe('founding_pro');
    expect(mapped.status).toBe('active');
    expect(
      resolveEntitlementFromRow(
        {
          user_id: USER_A,
          plan: mapped.plan,
          status: mapped.status,
          current_period_end: mapped.currentPeriodEnd,
          provider: 'stripe',
        },
        NOW
      ).isPro
    ).toBe(true);
  });

  it('maps trialing Founding Pro to Pro', async () => {
    retrieve.mockResolvedValueOnce(makeSub({ status: 'trialing' }));
    await processStripeEvent(makeEvent('customer.subscription.updated', makeSub({ status: 'trialing' })));
    const mapped = applyMappedSubscription.mock.calls[0]?.[0].mapped;
    expect(mapped.status).toBe('trialing');
    expect(
      resolveEntitlementFromRow(
        {
          user_id: USER_A,
          plan: mapped.plan,
          status: mapped.status,
          current_period_end: mapped.currentPeriodEnd,
          provider: 'stripe',
        },
        NOW
      ).isPro
    ).toBe(true);
  });

  it('keeps Pro when canceled with a future period end', async () => {
    retrieve.mockResolvedValueOnce(makeSub({ status: 'active', cancelAtPeriodEnd: true }));
    await processStripeEvent(makeEvent('customer.subscription.updated', makeSub({ status: 'active' })));
    const mapped = applyMappedSubscription.mock.calls[0]?.[0].mapped;
    expect(mapped.status).toBe('canceled');
    expect(
      resolveEntitlementFromRow(
        {
          user_id: USER_A,
          plan: mapped.plan,
          status: mapped.status,
          current_period_end: mapped.currentPeriodEnd,
          provider: 'stripe',
        },
        NOW
      ).isPro
    ).toBe(true);
  });

  it('keeps Pro when Stripe schedules cancel_at without cancel_at_period_end', async () => {
    retrieve.mockResolvedValueOnce({
      ...makeSub({ status: 'active', cancelAtPeriodEnd: false }),
      cancel_at: FUTURE,
    } as Stripe.Subscription);
    await processStripeEvent(makeEvent('customer.subscription.updated', makeSub({ status: 'active' })));
    const mapped = applyMappedSubscription.mock.calls[0]?.[0].mapped;
    expect(mapped.status).toBe('canceled');
    expect(
      resolveEntitlementFromRow(
        {
          user_id: USER_A,
          plan: mapped.plan,
          status: mapped.status,
          current_period_end: mapped.currentPeriodEnd,
          provider: 'stripe',
        },
        NOW
      ).isPro
    ).toBe(true);
  });

  it('maps deleted/ended subscriptions to Free', async () => {
    await processStripeEvent(makeEvent('customer.subscription.deleted', makeSub({ status: 'canceled' })));
    const mapped = applyMappedSubscription.mock.calls[0]?.[0].mapped;
    expect(mapped.plan).toBe('free');
    expect(mapped.status).toBe('expired');
    expect(
      resolveEntitlementFromRow(
        {
          user_id: USER_A,
          plan: mapped.plan,
          status: mapped.status,
          current_period_end: mapped.currentPeriodEnd,
          provider: 'stripe',
        },
        NOW
      ).isPro
    ).toBe(false);
  });

  it('maps payment failure / past_due to Free', async () => {
    retrieve.mockResolvedValueOnce(makeSub({ status: 'past_due' }));
    await processStripeEvent(
      makeEvent('invoice.payment_failed', { id: 'in_fail', subscription: 'sub_A' })
    );
    const mapped = applyMappedSubscription.mock.calls[0]?.[0].mapped;
    expect(mapped.status).toBe('past_due');
    expect(
      resolveEntitlementFromRow(
        {
          user_id: USER_A,
          plan: mapped.plan,
          status: mapped.status,
          current_period_end: mapped.currentPeriodEnd,
          provider: 'stripe',
        },
        NOW
      ).isPro
    ).toBe(false);
  });

  it('restores Pro after a later paid/active recovery', async () => {
    retrieve.mockResolvedValueOnce(makeSub({ status: 'active' }));
    await processStripeEvent(makeEvent('invoice.paid', { id: 'in_ok', subscription: 'sub_A' }));
    const mapped = applyMappedSubscription.mock.calls[0]?.[0].mapped;
    expect(mapped.status).toBe('active');
    expect(
      resolveEntitlementFromRow(
        {
          user_id: USER_A,
          plan: mapped.plan,
          status: mapped.status,
          current_period_end: mapped.currentPeriodEnd,
          provider: 'stripe',
        },
        NOW
      ).isPro
    ).toBe(true);
  });

  it('never applies user A subscription events to user B', async () => {
    await processStripeEvent(
      makeEvent('customer.subscription.updated', makeSub({ status: 'active', userId: USER_A }))
    );
    expect(applyMappedSubscription).toHaveBeenCalledTimes(1);
    expect(applyMappedSubscription.mock.calls[0]?.[0].userId).toBe(USER_A);
    expect(applyMappedSubscription.mock.calls[0]?.[0].userId).not.toBe(USER_B);
  });
});
