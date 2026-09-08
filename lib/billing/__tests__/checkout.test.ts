import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUserEntitlements = vi.fn();
const getStripeClient = vi.fn();
const getOrCreateStripeCustomer = vi.fn();

vi.mock('@/lib/entitlements/queries', () => ({
  getUserEntitlements: (...args: unknown[]) => getUserEntitlements(...args),
}));

vi.mock('@/lib/billing/stripe-client', () => ({
  getStripeClient: (...args: unknown[]) => getStripeClient(...args),
}));

vi.mock('@/lib/billing/customers', () => ({
  getOrCreateStripeCustomer: (...args: unknown[]) => getOrCreateStripeCustomer(...args),
}));

import { createFoundingProCheckout } from '../checkout';
import { foundingProEntitlement, freeEntitlement } from '@/lib/entitlements/resolve';

const USER_A = '11111111-1111-1111-1111-111111111111';
const PRICE = 'price_founding_pro';

function stubBillingEnv() {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_abc');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_abc');
  vi.stubEnv('STRIPE_FOUNDING_PRO_PRICE_ID', PRICE);
  vi.stubEnv('APP_BASE_URL', 'http://localhost:3000');
}

describe('createFoundingProCheckout', () => {
  const sessionsCreate = vi.fn();
  const subscriptionsList = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubBillingEnv();
    getStripeClient.mockReturnValue({
      subscriptions: { list: subscriptionsList },
      checkout: { sessions: { create: sessionsCreate } },
    });
    getOrCreateStripeCustomer.mockResolvedValue({ ok: true, customerId: 'cus_A' });
    subscriptionsList.mockResolvedValue({ data: [] });
    sessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.test/cs_test' });
  });

  it('creates Checkout for a Free user using the configured Founding Pro price', async () => {
    getUserEntitlements.mockResolvedValue(freeEntitlement());
    const result = await createFoundingProCheckout({ userId: USER_A, email: 'a@example.com' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url).toContain('checkout.stripe.test');
    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        customer: 'cus_A',
        client_reference_id: USER_A,
        line_items: [{ price: PRICE, quantity: 1 }],
        managed_payments: { enabled: false },
      })
    );
  });

  it('does not create a second subscription for an active Pro user', async () => {
    getUserEntitlements.mockResolvedValue(
      foundingProEntitlement({
        status: 'active',
        currentPeriodEnd: '2026-10-01T00:00:00.000Z',
        source: 'row',
      })
    );
    const result = await createFoundingProCheckout({ userId: USER_A });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.code).toBe('ALREADY_PRO');
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it('blocks checkout when Stripe already has an active Founding Pro subscription', async () => {
    getUserEntitlements.mockResolvedValue(freeEntitlement());
    subscriptionsList.mockResolvedValue({
      data: [
        {
          status: 'active',
          cancel_at_period_end: false,
          items: { data: [{ price: { id: PRICE } }] },
        },
      ],
    });
    const result = await createFoundingProCheckout({ userId: USER_A });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('ALREADY_PRO');
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it('refuses Checkout on Vercel Production even with test keys', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    getUserEntitlements.mockResolvedValue(freeEntitlement());
    const result = await createFoundingProCheckout({ userId: USER_A });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('BILLING_NOT_PUBLIC');
    expect(sessionsCreate).not.toHaveBeenCalled();
  });
});
