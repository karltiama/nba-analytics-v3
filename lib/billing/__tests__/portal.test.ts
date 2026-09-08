import { beforeEach, describe, expect, it, vi } from 'vitest';

const getEntitlementBillingRow = vi.fn();
const getStripeClient = vi.fn();

vi.mock('../entitlement-store', () => ({
  getEntitlementBillingRow: (...args: unknown[]) => getEntitlementBillingRow(...args),
}));

vi.mock('../stripe-client', () => ({
  getStripeClient: (...args: unknown[]) => getStripeClient(...args),
}));

import { createBillingPortalSession } from '../portal';

const USER_A = '11111111-1111-1111-1111-111111111111';

function stubEnv() {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_abc');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_abc');
  vi.stubEnv('STRIPE_FOUNDING_PRO_PRICE_ID', 'price_founding_pro');
  vi.stubEnv('APP_BASE_URL', 'http://localhost:3000');
}

describe('createBillingPortalSession', () => {
  const portalCreate = vi.fn();

  beforeEach(() => {
    vi.unstubAllEnvs();
    stubEnv();
    getEntitlementBillingRow.mockReset();
    getStripeClient.mockReset();
    portalCreate.mockReset();
    getStripeClient.mockReturnValue({
      billingPortal: { sessions: { create: portalCreate } },
    });
  });

  it('opens a portal for the stored Stripe customer only', async () => {
    getEntitlementBillingRow.mockResolvedValue({
      user_id: USER_A,
      provider: 'stripe',
      provider_customer_id: 'cus_A',
    });
    portalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/test' });

    const result = await createBillingPortalSession(USER_A);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url).toContain('billing.stripe.com');
    expect(portalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_A',
        return_url: 'http://localhost:3000/billing',
      })
    );
  });

  it('returns a truthful error when no Stripe customer is on file', async () => {
    getEntitlementBillingRow.mockResolvedValue({
      user_id: USER_A,
      provider: null,
      provider_customer_id: null,
    });

    const result = await createBillingPortalSession(USER_A);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
    expect(result.code).toBe('NO_BILLING_CUSTOMER');
    expect(portalCreate).not.toHaveBeenCalled();
  });
});
