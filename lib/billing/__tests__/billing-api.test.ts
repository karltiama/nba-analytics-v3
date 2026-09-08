import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireBettingAuth = vi.fn();
const createFoundingProCheckout = vi.fn();
const createBillingPortalSession = vi.fn();
const getUserEntitlements = vi.fn();
const getEntitlementBillingRow = vi.fn();
const verifyStripeWebhook = vi.fn();
const processStripeEvent = vi.fn();

vi.mock('@/lib/auth/require-betting-auth', () => ({
  requireBettingAuth: (...args: unknown[]) => requireBettingAuth(...args),
}));

vi.mock('@/lib/billing/checkout', () => ({
  createFoundingProCheckout: (...args: unknown[]) => createFoundingProCheckout(...args),
}));

vi.mock('@/lib/billing/portal', () => ({
  createBillingPortalSession: (...args: unknown[]) => createBillingPortalSession(...args),
}));

vi.mock('@/lib/entitlements/queries', () => ({
  getUserEntitlements: (...args: unknown[]) => getUserEntitlements(...args),
}));

vi.mock('@/lib/billing/entitlement-store', () => ({
  getEntitlementBillingRow: (...args: unknown[]) => getEntitlementBillingRow(...args),
}));

vi.mock('@/lib/billing/process-event', () => ({
  verifyStripeWebhook: (...args: unknown[]) => verifyStripeWebhook(...args),
  processStripeEvent: (...args: unknown[]) => processStripeEvent(...args),
}));

import { POST as checkoutPost } from '@/app/api/billing/checkout/route';
import { POST as portalPost } from '@/app/api/billing/portal/route';
import { GET as statusGet } from '@/app/api/billing/status/route';
import { POST as webhookPost } from '@/app/api/billing/webhook/route';
import { foundingProEntitlement, freeEntitlement } from '@/lib/entitlements/resolve';

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

function unauthorized() {
  return {
    ok: false as const,
    response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  };
}

function authed(userId: string) {
  return {
    ok: true as const,
    auth: { userId, email: `${userId}@example.com`, accessToken: 'token' },
    withAuthCookies: (r: NextResponse) => r,
  };
}

function stubBillingEnv() {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_abc');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_abc');
  vi.stubEnv('STRIPE_FOUNDING_PRO_PRICE_ID', 'price_founding_pro');
  vi.stubEnv('APP_BASE_URL', 'http://localhost:3000');
}

describe('billing API auth and IDOR', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubBillingEnv();
    requireBettingAuth.mockReset();
    createFoundingProCheckout.mockReset();
    createBillingPortalSession.mockReset();
    getUserEntitlements.mockReset();
    getEntitlementBillingRow.mockReset();
    verifyStripeWebhook.mockReset();
    processStripeEvent.mockReset();
  });

  it('checkout unauthenticated → 401', async () => {
    requireBettingAuth.mockResolvedValue(unauthorized());
    const res = await checkoutPost(new NextRequest('http://localhost/api/billing/checkout', { method: 'POST' }));
    expect(res.status).toBe(401);
    expect(createFoundingProCheckout).not.toHaveBeenCalled();
  });

  it('portal unauthenticated → 401', async () => {
    requireBettingAuth.mockResolvedValue(unauthorized());
    const res = await portalPost(new NextRequest('http://localhost/api/billing/portal', { method: 'POST' }));
    expect(res.status).toBe(401);
    expect(createBillingPortalSession).not.toHaveBeenCalled();
  });

  it('status unauthenticated → 401', async () => {
    requireBettingAuth.mockResolvedValue(unauthorized());
    const res = await statusGet(new NextRequest('http://localhost/api/billing/status'));
    expect(res.status).toBe(401);
  });

  it('checkout ignores client price/user/customer IDs and uses the session user', async () => {
    requireBettingAuth.mockResolvedValue(authed(USER_A));
    createFoundingProCheckout.mockResolvedValue({ ok: true, url: 'https://checkout.stripe.com/c/test' });

    const res = await checkoutPost(
      new NextRequest('http://localhost/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priceId: 'price_attacker',
          userId: USER_B,
          customerId: 'cus_B',
          subscriptionId: 'sub_B',
          planId: 'enterprise',
        }),
      })
    );
    expect(res.status).toBe(200);
    expect(createFoundingProCheckout).toHaveBeenCalledWith({
      userId: USER_A,
      email: `${USER_A}@example.com`,
    });
    const body = await res.json();
    expect(body.url).toContain('checkout.stripe.com');
  });

  it('portal ignores a client-supplied customer id and uses the session user', async () => {
    requireBettingAuth.mockResolvedValue(authed(USER_A));
    createBillingPortalSession.mockResolvedValue({ ok: true, url: 'https://billing.stripe.com/p/session/a' });

    const res = await portalPost(
      new NextRequest('http://localhost/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: 'cus_B', userId: USER_B }),
      })
    );
    expect(res.status).toBe(200);
    expect(createBillingPortalSession).toHaveBeenCalledWith(USER_A);
    expect(createBillingPortalSession).not.toHaveBeenCalledWith(USER_B);
  });

  it('status does not return Stripe IDs', async () => {
    requireBettingAuth.mockResolvedValue(authed(USER_A));
    getUserEntitlements.mockResolvedValue(freeEntitlement());
    getEntitlementBillingRow.mockResolvedValue({
      provider: 'stripe',
      provider_customer_id: 'cus_secret',
      provider_subscription_id: 'sub_secret',
    });
    const res = await statusGet(new NextRequest('http://localhost/api/billing/status'));
    const body = await res.json();
    expect(body.plan).toBe('free');
    expect(JSON.stringify(body)).not.toContain('cus_secret');
    expect(JSON.stringify(body)).not.toContain('sub_secret');
    expect(JSON.stringify(body)).not.toContain('price_');
  });

  it('does not unlock Pro from a Checkout success session_id query param', async () => {
    requireBettingAuth.mockResolvedValue(authed(USER_A));
    getUserEntitlements.mockResolvedValue(freeEntitlement());
    getEntitlementBillingRow.mockResolvedValue(null);
    const res = await statusGet(
      new NextRequest('http://localhost/api/billing/status?session_id=cs_test_paid')
    );
    const body = await res.json();
    expect(body.isPro).toBe(false);
    expect(body.plan).toBe('free');
  });

  it('manual Pro without Stripe customer stays Pro and cannot open portal management', async () => {
    requireBettingAuth.mockResolvedValue(authed(USER_A));
    getUserEntitlements.mockResolvedValue(
      foundingProEntitlement({ status: 'active', currentPeriodEnd: null, source: 'row' })
    );
    getEntitlementBillingRow.mockResolvedValue({
      provider: 'manual',
      provider_customer_id: null,
      provider_subscription_id: null,
    });
    const res = await statusGet(new NextRequest('http://localhost/api/billing/status'));
    const body = await res.json();
    expect(body.isPro).toBe(true);
    expect(body.canManageBilling).toBe(false);
    expect(body.provider).toBeNull();
  });
});

describe('billing webhook signature authority', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubBillingEnv();
    requireBettingAuth.mockReset();
    verifyStripeWebhook.mockReset();
    processStripeEvent.mockReset();
  });

  it('rejects invalid signatures and does not process', async () => {
    verifyStripeWebhook.mockImplementation(() => {
      throw new Error('bad sig');
    });
    const res = await webhookPost(
      new NextRequest('http://localhost/api/billing/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 't=1,v1=nope' },
        body: '{"id":"evt_1"}',
      })
    );
    expect(res.status).toBe(400);
    expect(processStripeEvent).not.toHaveBeenCalled();
  });

  it('returns 200 for duplicate provider events without re-throwing', async () => {
    verifyStripeWebhook.mockReturnValue({ id: 'evt_1', type: 'invoice.paid', data: { object: {} } });
    processStripeEvent.mockResolvedValue('duplicate');
    const res = await webhookPost(
      new NextRequest('http://localhost/api/billing/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 't=1,v1=ok' },
        body: '{"id":"evt_1"}',
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe('duplicate');
  });

  it('does not require a user session', async () => {
    verifyStripeWebhook.mockReturnValue({ id: 'evt_2', type: 'invoice.paid', data: { object: {} } });
    processStripeEvent.mockResolvedValue('processed');
    const res = await webhookPost(
      new NextRequest('http://localhost/api/billing/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 't=1,v1=ok' },
        body: '{"id":"evt_2"}',
      })
    );
    expect(res.status).toBe(200);
    expect(requireBettingAuth).not.toHaveBeenCalled();
  });
});
