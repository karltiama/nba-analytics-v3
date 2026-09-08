import { beforeEach, describe, expect, it, vi } from 'vitest';

const getStripeClient = vi.fn();
const getEntitlementBillingRow = vi.fn();
const upsertStripeCustomerId = vi.fn();

vi.mock('@/lib/billing/stripe-client', () => ({
  getStripeClient: (...args: unknown[]) => getStripeClient(...args),
}));

vi.mock('@/lib/billing/entitlement-store', () => ({
  getEntitlementBillingRow: (...args: unknown[]) => getEntitlementBillingRow(...args),
  upsertStripeCustomerId: (...args: unknown[]) => upsertStripeCustomerId(...args),
}));

import { getOrCreateStripeCustomer } from '../customers';

const USER_A = '11111111-1111-1111-1111-111111111111';

describe('getOrCreateStripeCustomer', () => {
  const retrieve = vi.fn();
  const create = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getStripeClient.mockReturnValue({
      customers: { retrieve, create },
    });
  });

  it('reuses a stored Stripe customer instead of creating another', async () => {
    getEntitlementBillingRow.mockResolvedValue({
      user_id: USER_A,
      provider_customer_id: 'cus_existing',
    });
    retrieve.mockResolvedValue({ id: 'cus_existing' });
    const result = await getOrCreateStripeCustomer({ userId: USER_A, email: 'a@example.com' });
    expect(result).toEqual({ ok: true, customerId: 'cus_existing' });
    expect(create).not.toHaveBeenCalled();
    expect(upsertStripeCustomerId).not.toHaveBeenCalled();
  });

  it('creates one customer with app user metadata when none is stored', async () => {
    getEntitlementBillingRow.mockResolvedValue(null);
    create.mockResolvedValue({ id: 'cus_new' });
    const result = await getOrCreateStripeCustomer({ userId: USER_A, email: 'a@example.com' });
    expect(result).toEqual({ ok: true, customerId: 'cus_new' });
    expect(create).toHaveBeenCalledWith({
      email: 'a@example.com',
      metadata: { app_user_id: USER_A },
    });
    expect(upsertStripeCustomerId).toHaveBeenCalledWith(USER_A, 'cus_new');
  });
});
